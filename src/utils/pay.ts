import type {PayRates, WorkHours} from "./types.js";
import {durationMinutes, formatDuration, parseRange, sortEntries} from "./hours.js";

// Rules shared by all guards; the money rates are personal (PayRates, from each guard's payslip).
// Seniority is paid at the same percent as the hour it is added to, הבראה on non-overtime hours only.
// Shabbat window and the daily norm are not printed on payslips, so they are assumptions.
export const PAY_RULES = {
    regularMinutesPerDay: 8 * 60,
    overtime125MinutesPerDay: 2 * 60, // after these, overtime is 150% (175%/200% on Shabbat)
    shabbatStartFriday: 16 * 60,      // Friday 16:00
    shabbatEndSaturday: 19 * 60,      // Saturday 19:00
};

const CATEGORIES = ["regular", "ot125", "ot150", "shabbat", "shabbat175", "shabbat200"] as const;
type PayCategory = typeof CATEGORIES[number];

const PERCENT: Record<PayCategory, number> = {
    regular: 100, ot125: 125, ot150: 150, shabbat: 150, shabbat175: 175, shabbat200: 200,
};

const LABELS: Record<PayCategory, string> = {
    regular: "Обычные 100%",
    ot125: "Сверхурочные 125%",
    ot150: "Сверхурочные 150%",
    shabbat: "Шабат 150%",
    shabbat175: "Шабат сверхурочные 175%",
    shabbat200: "Шабат сверхурочные 200%",
};

export type Pay = {
    minutes: Record<PayCategory, number>;
    byCategory: Record<PayCategory, number>;
    seniority: number;
    recovery: number;
    total: number;
};

const emptyByCategory = () =>
    Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<PayCategory, number>;

function isShabbat(t: Date): boolean {
    const minutes = t.getHours() * 60 + t.getMinutes();
    const day = t.getDay();

    return (day === 5 && minutes >= PAY_RULES.shabbatStartFriday)
        || (day === 6 && minutes < PAY_RULES.shabbatEndSaturday);
}

// `worked` = minutes already worked that day; overtime is counted per calendar day of the shift start
function categorize(worked: number, shabbat: boolean): PayCategory {
    const { regularMinutesPerDay: regular, overtime125MinutesPerDay: ot125 } = PAY_RULES;

    if (worked < regular) return shabbat ? "shabbat" : "regular";
    if (worked < regular + ot125) return shabbat ? "shabbat175" : "ot125";
    return shabbat ? "shabbat200" : "ot150";
}

// Gross pay estimate: no taxes, travel, bonuses or holidays
export function calculatePay(entries: readonly WorkHours[], rates: PayRates): Pay {
    const minutes = emptyByCategory();
    const workedByDate = new Map<string, number>();

    for (const entry of sortEntries(entries)) {
        const range = parseRange(entry.hours);
        if (!range) continue;

        const [y, m, d] = entry.date.split("-").map(Number);
        let worked = workedByDate.get(entry.date) ?? 0;

        // Minute by minute, so a shift crossing into Shabbat or past the daily norm is split exactly
        for (let i = 0; i < durationMinutes(entry.hours); i++) {
            const t = new Date(y ?? 0, (m ?? 1) - 1, d ?? 1, 0, range.start + i);
            minutes[categorize(worked, isShabbat(t))]++;
            worked++;
        }

        workedByDate.set(entry.date, worked);
    }

    const byCategory = emptyByCategory();
    let seniority = 0;

    for (const c of CATEGORIES) {
        const hours = minutes[c] / 60;
        const factor = PERCENT[c] / 100;

        byCategory[c] = hours * rates.hourlyRate * factor;
        seniority += hours * rates.seniorityPerHour * factor;
    }

    const recovery = (minutes.regular + minutes.shabbat) / 60 * rates.recoveryPerHour;
    const total = CATEGORIES.reduce((sum, c) => sum + byCategory[c], 0) + seniority + recovery;

    return { minutes, byCategory, seniority, recovery, total };
}

export const money = (amount: number) => `${amount.toFixed(2)} ₪`;

export const PAY_NOTE = "Оценка брутто — без налогов, проезда, премий и праздников. Сверяй с листком.";

export const NO_RATES_HINT = "💰 Загрузи тлюш («📄 Загрузить тлюш»), чтобы видеть зарплату";

export function formatRates(rates: Pick<PayRates, "hourlyRate" | "seniorityPerHour" | "recoveryPerHour">): string {
    return `• Ставка: ${money(rates.hourlyRate)}/ч\n` +
        `• Надбавка за стаж (ותק): ${money(rates.seniorityPerHour)}/ч\n` +
        `• Хавраа (הבראה): ${money(rates.recoveryPerHour)}/ч`;
}

export function formatPay(entries: readonly WorkHours[], rates: PayRates | undefined): string {
    if (!rates) return NO_RATES_HINT;

    const pay = calculatePay(entries, rates);

    const lines = CATEGORIES
        .filter((c) => pay.minutes[c] > 0)
        .map((c) => `• ${LABELS[c]}: ${formatDuration(pay.minutes[c])} — ${money(pay.byCategory[c])}`);

    lines.push(
        `• Надбавка за стаж: ${money(pay.seniority)}`,
        `• Хавраа: ${money(pay.recovery)}`,
    );

    return `💰 Брутто ≈ ${money(pay.total)}\n${lines.join("\n")}`;
}

export const formatPayShort = (entries: readonly WorkHours[], rates: PayRates | undefined) =>
    rates ? `💰 Брутто ≈ ${money(calculatePay(entries, rates).total)}` : NO_RATES_HINT;
