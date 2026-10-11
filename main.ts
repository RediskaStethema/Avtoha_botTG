import {bot, BUTTONS, state} from "./src/utils/constants.js";
import {safeSend, sendMainMenu, sendStartMenu} from "./src/utils/tools.js";
import {loadData} from "./src/utils/store.js";
import * as guard from "./src/handlers/guard.js";
import * as boss from "./src/handlers/boss.js";
import * as payslip from "./src/handlers/payslip.js";
import {scheduleReminders} from "./src/handlers/reminder.js";
import type TelegramBot from "node-telegram-bot-api";

loadData();
scheduleReminders();

bot.on("polling_error", (e) => {
    console.error("Polling error:", e.message);
});

process.on("unhandledRejection", (e) => {
    console.error("Unhandled rejection:", e);
});

// Menu buttons; pressing any of them cancels whatever multi-step flow was in progress
const buttonHandlers: Record<string, (chatId: number) => Promise<unknown>> = {
    [BUTTONS.RESTART]: (chatId) => sendStartMenu(chatId),
    [BUTTONS.GUARD]: guard.startRegistration,
    [BUTTONS.SET_HOURS]: guard.askHours,
    [BUTTONS.MY_HOURS]: guard.showMyHours,
    [BUTTONS.DELETE_ENTRY]: guard.askDeleteEntry,
    [BUTTONS.UPLOAD_PAYSLIP]: payslip.askPayslip,
    [BUTTONS.BOSS]: boss.openBossPanel,
    [BUTTONS.THIS_MONTH]: boss.showThisMonth,
    [BUTTONS.PREV_MONTH]: boss.showPreviousMonth,
    [BUTTONS.OTHER_MONTH]: boss.askOtherMonth,
};

bot.on("message", (msg) => {
    handleMessage(msg).catch(async (e) => {
        console.error("Failed to handle message:", e);
        await safeSend(msg.chat.id, "⚠️ Произошла ошибка, попробуй ещё раз");
    });
});

async function handleMessage(msg: TelegramBot.Message) {
    // Users are identified by chat ID: in a group every member would act as the same guard
    // and see everyone's hours, so groups and channels are ignored
    if (msg.chat.type !== "private") return;

    const chatId = msg.chat.id;
    const text = msg.text;

    // A PDF from a guard is a payslip, whether or not they pressed the button first
    if (msg.document) {
        return payslip.handlePayslipDocument(chatId, msg.document);
    }

    if (msg.photo && state.get(chatId)?.step === "payslip") {
        return safeSend(chatId, "Нужен PDF-файл, а не фото: 📎 → Файл");
    }

    if (!text) return;

    if (text === "/start" || text.startsWith("/start ")) {
        state.delete(chatId);
        return sendMainMenu(chatId);
    }

    const buttonHandler = buttonHandlers[text];

    if (buttonHandler) {
        state.delete(chatId);
        return buttonHandler(chatId);
    }

    const userState = state.get(chatId);

    switch (userState?.step) {
        case "name":
            return guard.handleNameStep(chatId, text);
        case "hours":
            return guard.handleHoursStep(chatId, text);
        case "confirmDuplicate":
            return guard.handleDuplicateStep(chatId, text, userState);
        case "delete":
            return guard.handleDeleteStep(chatId, text, userState);
        case "bossMonth":
            return boss.handleMonthStep(chatId, text);
        case "payslip":
            return payslip.handlePayslipStep(chatId, text);
        case "payslipPassword":
            return payslip.handlePasswordStep(chatId, text, userState, msg.message_id);
        case "confirmRates":
            return payslip.handleConfirmRatesStep(chatId, text, userState);
        case "ratesManual":
            return payslip.handleManualRatesStep(chatId, text);
        case undefined:
            // Unknown text, or a button from an old keyboard: show the current menu
            return sendMainMenu(chatId, "Не понял 🤔 Выбери действие на клавиатуре");
    }
}
