import cron from "node-cron";
import * as store from "../utils/store.js";
import {sendLongMessage} from "../utils/tools.js";
import {
    currentMonthKey,
    formatEntry,
    formatMonth,
    formatTotal,
    isDayBeforeMonthEnd
} from "../utils/hours.js";
import {formatPayShort} from "../utils/pay.js";

// Every day at 18:00 (server time, or TZ from .env); only acts on the second-to-last day of the month
const REMINDER_SCHEDULE = "0 18 * * *";

export async function sendMonthEndReminders() {
    const month = currentMonthKey();

    for (const guard of store.getGuards()) {
        const entries = store.userEntriesInMonth(guard.id, month);

        const body = entries.length > 0
            ? `${entries.map(formatEntry).join("\n")}\n${formatTotal(entries)}\n${formatPayShort(entries, guard.rates)}`
            : "Записей пока нет.";

        await sendLongMessage(
            guard.id,
            `⏰ Завтра последний день месяца. Проверь свои часы за ${formatMonth(month)}:\n\n${body}\n\n` +
            "Если что-то забыл — внеси через «⏰ Указать часы»."
        );
    }
}

export function scheduleReminders() {
    cron.schedule(REMINDER_SCHEDULE, async () => {
        if (!isDayBeforeMonthEnd()) return;

        try {
            await sendMonthEndReminders();
        } catch (e) {
            console.error("Month-end reminder failed:", e);
        }
    });
}
