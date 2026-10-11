import {bot, BUTTONS} from "./constants.js";
import type TelegramBot from "node-telegram-bot-api";
import {findUser} from "./store.js";

// Telegram limit is 4096 characters; keep a margin
const MAX_MESSAGE_LENGTH = 4000;

// Never rejects: a failed send (e.g. user blocked the bot) is logged instead of crashing the process
export async function safeSend(
    chatId: number,
    text: string,
    options?: TelegramBot.SendMessageOptions
) {
    try {
        return await bot.sendMessage(chatId, text, options);
    } catch (e) {
        console.error(`sendMessage to ${chatId} failed:`, e instanceof Error ? e.message : e);
        return undefined;
    }
}

// Splits text by lines into chunks that fit Telegram's message limit
export async function sendLongMessage(chatId: number, text: string) {
    const chunks: string[] = [];
    let current = "";

    for (const line of text.split("\n")) {
        if (current.length + line.length + 1 > MAX_MESSAGE_LENGTH && current) {
            chunks.push(current);
            current = "";
        }

        // A single line longer than the limit is cut into pieces
        let rest = line;
        while (rest.length > MAX_MESSAGE_LENGTH) {
            chunks.push(rest.slice(0, MAX_MESSAGE_LENGTH));
            rest = rest.slice(MAX_MESSAGE_LENGTH);
        }

        current += (current ? "\n" : "") + rest;
    }

    if (current.trim()) chunks.push(current);

    for (const chunk of chunks) {
        await safeSend(chatId, chunk);
    }
}

export function sendKeyboard(chatId: number, text: string, rows: string[][]) {
    return safeSend(chatId, text, {
        reply_markup: {
            keyboard: rows.map((row) => row.map((button) => ({ text: button }))),
            resize_keyboard: true,
        },
    });
}

export function sendStartMenu(chatId: number, text = "Кто ты?") {
    return sendKeyboard(chatId, text, [
        [BUTTONS.GUARD, BUTTONS.BOSS],
        [BUTTONS.RESTART],
    ]);
}

export function sendGuardMenu(chatId: number, text = "Меню охранника 👮") {
    return sendKeyboard(chatId, text, [
        [BUTTONS.SET_HOURS],
        [BUTTONS.MY_HOURS, BUTTONS.DELETE_ENTRY],
        [BUTTONS.UPLOAD_PAYSLIP],
        [BUTTONS.RESTART],
    ]);
}

export function sendBossMenu(chatId: number, text = "Панель начальника 👑") {
    return sendKeyboard(chatId, text, [
        [BUTTONS.THIS_MONTH, BUTTONS.PREV_MONTH],
        [BUTTONS.OTHER_MONTH],
        [BUTTONS.RESTART],
    ]);
}

export function sendCancelKeyboard(chatId: number, text: string) {
    return sendKeyboard(chatId, text, [[BUTTONS.CANCEL]]);
}

// Guard menu for registered guards, role choice for everyone else
export function sendMainMenu(chatId: number, text?: string) {
    return findUser(chatId)?.role === "guard"
        ? sendGuardMenu(chatId, text)
        : sendStartMenu(chatId, text);
}
