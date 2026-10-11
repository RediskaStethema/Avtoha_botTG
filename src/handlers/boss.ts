import {BOSS_IDS, BUTTONS, state} from "../utils/constants.js";
import {safeSend, sendBossMenu, sendCancelKeyboard, sendLongMessage} from "../utils/tools.js";
import * as store from "../utils/store.js";
import {
    currentMonthKey,
    formatGuardsReport,
    formatMonth,
    parseMonth,
    previousMonthKey
} from "../utils/hours.js";
import {formatPayShort, PAY_NOTE} from "../utils/pay.js";

const isBoss = (chatId: number) => BOSS_IDS.has(chatId);

function denyAccess(chatId: number) {
    return safeSend(chatId, `⛔ Нет доступа. Твой Telegram ID: ${chatId}`);
}

async function sendMonthReport(chatId: number, month: string) {
    const report = formatGuardsReport(store.entriesInMonth(month), store.getUsers(), (entries, userId) => {
        const rates = store.findUser(userId)?.rates;
        return rates ? formatPayShort(entries, rates) : "💰 ставки не указаны";
    });

    if (!report) {
        return sendBossMenu(chatId, `📊 ${formatMonth(month)}: записей нет`);
    }

    await sendLongMessage(chatId, `📊 ${formatMonth(month)}\n\n${report}\n\n${PAY_NOTE}`);
    return sendBossMenu(chatId, "Выбери другой отчёт или вернись позже");
}

export async function openBossPanel(chatId: number) {
    if (!isBoss(chatId)) return denyAccess(chatId);

    return sendBossMenu(chatId);
}

export async function showThisMonth(chatId: number) {
    if (!isBoss(chatId)) return denyAccess(chatId);

    return sendMonthReport(chatId, currentMonthKey());
}

export async function showPreviousMonth(chatId: number) {
    if (!isBoss(chatId)) return denyAccess(chatId);

    return sendMonthReport(chatId, previousMonthKey());
}

export async function askOtherMonth(chatId: number) {
    if (!isBoss(chatId)) return denyAccess(chatId);

    state.set(chatId, { step: "bossMonth" });

    return sendCancelKeyboard(chatId, "Введи месяц в формате ММ.ГГГГ, например 06.2026");
}

export async function handleMonthStep(chatId: number, text: string) {
    if (text === BUTTONS.CANCEL || !isBoss(chatId)) {
        state.delete(chatId);
        return isBoss(chatId) ? sendBossMenu(chatId) : denyAccess(chatId);
    }

    const month = parseMonth(text);

    if (!month) {
        return safeSend(chatId, "Не понял месяц 🤔 Пример: 06.2026");
    }

    state.delete(chatId);
    return sendMonthReport(chatId, month);
}
