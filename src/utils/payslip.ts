import type {PayRates} from "./types.js";

// Pure parsing of the text extracted from a payslip PDF (תלוש). Employers use different layouts,
// so values are found by typical Hebrew labels; the guard always confirms or corrects the result.

export type RateField = "hourlyRate" | "seniorityPerHour" | "recoveryPerHour";

export type ParsedPayslip = Partial<Pick<PayRates, RateField | "payslipMonth">>;

// Longer, more specific labels first
const LABELS: Record<RateField, readonly string[]> = {
    hourlyRate: ["ערך שעה", "תעריף שעה", "שכר שעה", "שכר שעתי", "שעות רגילות", "תעריף"],
    seniorityPerHour: ["תוספת ותק", "ותק"],
    recoveryPerHour: ["הבראה"],
};

// Plausible per-hour values, to tell a rate from hours worked, years of seniority or a total
const RANGES: Record<RateField, readonly [number, number]> = {
    hourlyRate: [30, 200],
    seniorityPerHour: [0.1, 30],
    recoveryPerHour: [0.1, 20],
};

const HEBREW_MONTHS = [
    "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
    "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
];

// pdf.js sometimes returns Hebrew in visual (reversed) order, so every label is searched both ways
const reverse = (s: string) => [...s].reverse().join("");
const containsLabel = (line: string, label: string) => line.includes(label) || line.includes(reverse(label));

const DATE_RE = /\d{1,2}[./]\d{1,2}[./]\d{2,4}|\d{1,2}\/\d{4}/g;
const NUMBER_RE = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;

function normalizeLines(text: string): string[] {
    return text
        .replace(/[‎‏‪-‮]/g, "") // bidi control marks
        .split("\n")
        .map((line) => line.replace(/\s+/g, " ").trim())
        .filter((line) => line !== "");
}

function numbersIn(line: string): number[] {
    return (line.replace(DATE_RE, " ").match(NUMBER_RE) ?? []).map((n) => Number(n.replace(/,/g, "")));
}

const inRange = (n: number, [min, max]: readonly [number, number]) => n >= min && n <= max;

// The search below is cubic in the count of numbers, so a crafted PDF with long rows could freeze the bot.
// A real payslip row has a handful of numbers; a payslip is a few thousand characters.
const MAX_NUMBERS_PER_ROW = 30;
const MAX_TEXT_LENGTH = 50_000;

// Pairs x, y from the row with x × y ≈ some other number of the row ("quantity · rate · amount")
function factorPairs(numbers: readonly number[]): [number, number][] {
    const pairs: [number, number][] = [];

    if (numbers.length > MAX_NUMBERS_PER_ROW) return pairs;

    for (const a of numbers) {
        for (let i = 0; i < numbers.length; i++) {
            for (let j = i + 1; j < numbers.length; j++) {
                const x = numbers[i]!, y = numbers[j]!;
                if (x === a || y === a || Math.abs(x * y - a) > Math.max(a * 0.01, 0.05)) continue;

                pairs.push([x, y]);
            }
        }
    }

    return pairs;
}

// What is known about each number across the whole payslip, to tell the hours from the rate in a row
type Stats = {
    counts: Map<number, number>;      // occurrences anywhere
    factorLines: Map<number, number>; // lines where it is a factor of q × r = a
};

function collectStats(lines: readonly string[]): Stats {
    const counts = new Map<number, number>();
    const factorLines = new Map<number, number>();

    for (const line of lines) {
        const numbers = numbersIn(line);
        for (const n of numbers) counts.set(n, (counts.get(n) ?? 0) + 1);

        for (const n of new Set(factorPairs(numbers).flat())) {
            factorLines.set(n, (factorLines.get(n) ?? 0) + 1);
        }
    }

    return { counts, factorLines };
}

function rateFromRow(numbers: readonly number[], range: readonly [number, number], stats: Stats) {
    const candidates = factorPairs(numbers).flat().filter((r) => inRange(r, range));

    // Hours and rate can both be in range. The hours multiply several rows (regular, ותק, הבראה),
    // a rate belongs to one row; then prefer a value repeated elsewhere (e.g. "ערך שעה"), then the smaller
    candidates.sort((a, b) =>
        (stats.factorLines.get(a) ?? 0) - (stats.factorLines.get(b) ?? 0)
        || (stats.counts.get(b) ?? 0) - (stats.counts.get(a) ?? 0)
        || a - b
    );

    return candidates[0];
}

function findRate(lines: readonly string[], field: RateField, stats: Stats): number | undefined {
    const range = RANGES[field];
    let fallback: number | undefined;

    for (const label of LABELS[field]) {
        for (let i = 0; i < lines.length; i++) {
            if (!containsLabel(lines[i]!, label)) continue;

            // Some PDFs put every table cell on its own line, so look at the next lines too
            let numbers = numbersIn(lines[i]!);
            if (numbers.length < 3) numbers = numbersIn(lines.slice(i, i + 4).join(" "));

            const fromRow = rateFromRow(numbers, range, stats);
            if (fromRow !== undefined) return fromRow;

            fallback ??= numbers.find((n) => inRange(n, range));
        }
    }

    return fallback;
}

const pad = (n: number) => String(n).padStart(2, "0");

function findMonth(lines: readonly string[]): string | undefined {
    const valid = (m: number, y: number) => m >= 1 && m <= 12 && y >= 2000 && y <= 2100;

    // "09/2026" next to "חודש" (also matches "לחודש"), then a Hebrew month name with a year
    for (const line of lines) {
        if (!containsLabel(line, "חודש")) continue;

        const match = /(\d{1,2})\s*[/.]\s*(\d{4})/.exec(line);
        if (match && valid(Number(match[1]), Number(match[2]))) {
            return `${match[2]}-${pad(Number(match[1]))}`;
        }
    }

    for (const line of lines) {
        const year = /\b(20\d{2})\b/.exec(line)?.[1];
        if (!year) continue;

        const month = HEBREW_MONTHS.findIndex((name) => containsLabel(line, name));
        if (month >= 0) return `${year}-${pad(month + 1)}`;
    }

    return undefined;
}

export function parsePayslip(text: string): ParsedPayslip {
    const lines = normalizeLines(text.slice(0, MAX_TEXT_LENGTH));

    const stats = collectStats(lines);
    const result: ParsedPayslip = {};

    for (const field of Object.keys(LABELS) as RateField[]) {
        const value = findRate(lines, field, stats);
        if (value !== undefined) result[field] = value;
    }

    const month = findMonth(lines);
    if (month) result.payslipMonth = month;

    return result;
}

export const MANUAL_RATES_HELP =
    "Напиши через пробел ставки с тлюша:\n" +
    "ставка за час, ותק за час, הבראה за час\n" +
    "Например: 49.50 3 2.11\n" +
    "Если надбавки нет — можно только ставку: 49.50";

// "49.50 3 2.11" / "49,5" -> rates; missing seniority and recovery are 0
export function parseManualRates(text: string):
    | { ok: true; rates: Pick<PayRates, RateField> }
    | { ok: false; error: string } {
    const tokens = text.trim().split(/[\s;]+/).filter((t) => t !== "");

    if (tokens.length < 1 || tokens.length > 3) {
        return { ok: false, error: `Не понял 🤔\n${MANUAL_RATES_HELP}` };
    }

    const values = tokens.map((t) => (/^\d+(?:[.,]\d+)?$/.test(t) ? Number(t.replace(",", ".")) : NaN));

    if (values.some(Number.isNaN)) {
        return { ok: false, error: `Нужны только числа.\n${MANUAL_RATES_HELP}` };
    }

    const [hourlyRate = 0, seniorityPerHour = 0, recoveryPerHour = 0] = values;

    if (hourlyRate < 20 || hourlyRate > 500) {
        return { ok: false, error: "Ставка за час должна быть от 20 до 500 ₪" };
    }

    if (seniorityPerHour > 100 || recoveryPerHour > 100) {
        return { ok: false, error: "ותק и הבראה — это ₪ за час, обычно несколько шекелей" };
    }

    return { ok: true, rates: { hourlyRate, seniorityPerHour, recoveryPerHour } };
}
