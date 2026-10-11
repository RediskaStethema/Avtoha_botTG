import type {User, WorkHours} from "./types.js";

// Any shift the guard actually worked: "8:00-16:00", "8-20", "7.30-19.30", "20:00-8:00" (overnight), "8:00-8:00" (24h).
// An optional date prefix "05.07" / "05.07.2026" (followed by a space) logs a past day instead of today.
const TIME = String.raw`(\d{1,2})(?:[:.](\d{2}))?`;
const ENTRY_RE = new RegExp(String.raw`^(?:(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?\s+)?${TIME}\s*[-–—]\s*${TIME}$`);
const RU_DATE_RE = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;
const RANGE_RE = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/;

export const ENTRY_FORMAT_HELP =
    "Напиши время начала и конца своей смены, например:\n" +
    "• 8:00-16:00\n" +
    "• 7:30-19:30\n" +
    "• 8-20 (можно без минут)\n" +
    "• 20:00-8:00 — смена через полночь\n" +
    "• 8:00-8:00 — сутки (24ч)\n" +
    "За прошедший день — добавь дату впереди: 05.07 8:00-16:00";

export type ParseResult =
    | { ok: true; date: string; hours: string }
    | { ok: false; error: string };

const pad = (n: number) => String(n).padStart(2, "0");

// Local calendar date as YYYY-MM-DD (toISOString would shift it to UTC)
export function toIsoDate(d: Date): string {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Returns null for non-existent dates like 31.02
function buildIsoDate(year: number, month: number, day: number): string | null {
    const d = new Date(year, month - 1, day);

    if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) {
        return null;
    }

    return toIsoDate(d);
}

export function parseEntry(text: string, now: Date = new Date()): ParseResult {
    const match = ENTRY_RE.exec(text.trim());

    if (!match) {
        return { ok: false, error: `Не понял время 🤔\n${ENTRY_FORMAT_HELP}` };
    }

    const [, dd, mm, yyyy, h1, m1, h2, m2] = match;
    // Minutes are optional ("8-20")
    const startH = Number(h1), startM = Number(m1 ?? 0), endH = Number(h2), endM = Number(m2 ?? 0);

    if (startH > 23 || endH > 23 || startM > 59 || endM > 59) {
        return { ok: false, error: "Неверное время: часы 0–23, минуты 0–59" };
    }

    // Equal start and end is a 24-hour shift (see durationMinutes)

    const today = toIsoDate(now);
    let date = today;

    if (dd && mm) {
        const explicitYear = yyyy !== undefined;
        let year = explicitYear ? Number(yyyy) : now.getFullYear();
        let iso = buildIsoDate(year, Number(mm), Number(dd));

        if (!iso) {
            return { ok: false, error: `Даты ${dd}.${mm} не существует` };
        }

        // "31.12" typed on January 1st means last year
        if (!explicitYear && iso > today) {
            year -= 1;
            iso = buildIsoDate(year, Number(mm), Number(dd));
            if (!iso) return { ok: false, error: `Даты ${dd}.${mm}.${year} не существует` };
        }

        if (iso > today) {
            return { ok: false, error: "Нельзя указать часы на будущую дату" };
        }

        date = iso;
    }

    return {
        ok: true,
        date,
        hours: `${startH}:${pad(startM)}-${endH}:${pad(endM)}`,
    };
}

// "8:00-16:30" -> start and end in minutes from midnight; null if malformed
export function parseRange(hours: string): { start: number; end: number } | null {
    const match = RANGE_RE.exec(hours);
    if (!match) return null;

    const [, h1, m1, h2, m2] = match;
    return { start: Number(h1) * 60 + Number(m1), end: Number(h2) * 60 + Number(m2) };
}

// Shift length in minutes; end before start = crosses midnight, end equal to start = 24-hour shift
export function durationMinutes(hours: string): number {
    const range = parseRange(hours);
    if (!range) return 0;

    const diff = range.end - range.start;

    return diff > 0 ? diff : diff + 24 * 60;
}

export function formatDuration(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;

    return m ? `${h}ч ${pad(m)}м` : `${h}ч`;
}

export function formatDate(iso: string): string {
    const [y, m, d] = iso.split("-");
    return y && m && d ? `${d}.${m}.${y}` : iso;
}

// Converts legacy "DD.MM.YYYY" dates to "YYYY-MM-DD"; other values are returned unchanged
export function normalizeDate(date: string): string {
    const match = RU_DATE_RE.exec(date);
    if (!match) return date;

    const [, d, m, y] = match;
    return buildIsoDate(Number(y), Number(m), Number(d)) ?? date;
}

export function sortEntries(entries: readonly WorkHours[]): WorkHours[] {
    return [...entries].sort((a, b) =>
        a.date === b.date
            ? startMinutes(a.hours) - startMinutes(b.hours)
            : a.date.localeCompare(b.date)
    );
}

const startMinutes = (hours: string) => parseRange(hours)?.start ?? 0;

export function formatEntry(entry: WorkHours): string {
    return `📅 ${formatDate(entry.date)} ⏰ ${entry.hours} (${formatDuration(durationMinutes(entry.hours))})`;
}

export function formatTotal(entries: readonly WorkHours[]): string {
    const total = entries.reduce((sum, e) => sum + durationMinutes(e.hours), 0);
    return `Итого: ${formatDuration(total)} (смен: ${entries.length})`;
}

// Groups by userId (not name, which can repeat) and uses the user's current name;
// `footer` adds extra lines under each guard's total (e.g. pay)
export function formatGuardsReport(
    hours: readonly WorkHours[],
    users: readonly User[],
    footer?: (entries: readonly WorkHours[], userId: number) => string
): string {
    const grouped = new Map<number, WorkHours[]>();

    for (const h of hours) {
        const list = grouped.get(h.userId) ?? [];
        list.push(h);
        grouped.set(h.userId, list);
    }

    const blocks: string[] = [];

    for (const [userId, entries] of grouped) {
        const name = users.find((u) => u.id === userId)?.name ?? entries[0]?.name ?? String(userId);
        const lines = sortEntries(entries).map(formatEntry);

        const extra = footer ? `\n${footer(entries, userId)}` : "";

        blocks.push(`👤 ${name}\n${lines.join("\n")}\n${formatTotal(entries)}${extra}`);
    }

    return blocks.join("\n\n");
}

// --- Months ---

const MONTH_NAMES = [
    "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
    "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

// "2026-07-05" -> "2026-07"
export const monthKey = (isoDate: string) => isoDate.slice(0, 7);

export const currentMonthKey = (now: Date = new Date()) => monthKey(toIsoDate(now));

export function previousMonthKey(now: Date = new Date()): string {
    return monthKey(toIsoDate(new Date(now.getFullYear(), now.getMonth() - 1, 1)));
}

// "2026-07" -> "Июль 2026"
export function formatMonth(key: string): string {
    const [y, m] = key.split("-");
    const name = MONTH_NAMES[Number(m) - 1];
    return name && y ? `${name} ${y}` : key;
}

// "07.2026" / "7.2026" -> "2026-07"; null if invalid
export function parseMonth(text: string): string | null {
    const match = /^(\d{1,2})\.(\d{4})$/.exec(text.trim());
    if (!match) return null;

    const month = Number(match[1]);
    if (month < 1 || month > 12) return null;

    return `${match[2]}-${pad(month)}`;
}

export const inMonth = (entries: readonly WorkHours[], key: string) =>
    entries.filter((e) => monthKey(e.date) === key);

// True on the second-to-last day of the month (the day-after-tomorrow is the 1st)
export function isDayBeforeMonthEnd(now: Date = new Date()): boolean {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2).getDate() === 1;
}
