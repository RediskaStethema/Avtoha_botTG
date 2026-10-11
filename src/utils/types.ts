
export type UserRole = "guard" | "boss";

// Personal pay rates from the guard's payslip (or typed in by hand); guards work for different employers
export type PayRates = {
    hourlyRate: number;        // ₪ per regular hour
    seniorityPerHour: number;  // תוספת ותק, ₪/h (0 if none)
    recoveryPerHour: number;   // הבראה, ₪/h (0 if not paid per hour)
    source: "payslip" | "manual";
    payslipMonth?: string;     // "2026-09", if found on the payslip
    updatedAt: string;         // ISO timestamp
}

export type User= {
    id: number;
    name: string;
    role: UserRole;
    rates?: PayRates;
}

export type WorkHours= {
    userId: number;
    name: string;
    date: string; // YYYY-MM-DD
    hours: string; // H:MM-H:MM, end <= start means the shift crosses midnight
}

// Legacy: entries moved out by the removed "New Month" button; merged back into hours.json on startup
export type ArchivedWorkHours = WorkHours & {
    archivedAt: string;
}

export type State =
    | { step: "name" }
    | { step: "hours" }
    | { step: "bossMonth" }
    | { step: "confirmDuplicate"; entry: WorkHours; existing: WorkHours[] }
    | { step: "delete"; entries: WorkHours[] }
    | { step: "payslip" }
    | { step: "payslipPassword"; fileId: string }
    | { step: "confirmRates"; rates: PayRates }
    | { step: "ratesManual" };

export type StepState<K extends State["step"]> = Extract<State, { step: K }>;
