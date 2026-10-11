import * as path from "node:path";
import fs from "node:fs";
import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";
import type {State} from "./types.js";
dotenv.config({ path: path.resolve(process.cwd(), ".env") });


const token = process.env.TELEGRAM_TOKEN;

if (!token) {
    throw new Error("❌ TELEGRAM_TOKEN is missing in .env");
}

// Resolved from the working directory (not this file), so ts-node and the compiled dist/ use the same data
export const DATA_DIR = path.resolve(process.cwd(), process.env.DATA_DIR ?? "src/data");
fs.mkdirSync(DATA_DIR, { recursive: true });

export const USERS_FILE = path.join(DATA_DIR, "users.json");
export const HOURS_FILE = path.join(DATA_DIR, "hours.json");
export const HOURS_ARCHIVE_FILE = path.join(DATA_DIR, "hours_archive.json");

// Telegram chat IDs allowed into the boss panel, e.g. BOSS_IDS=123456,789012
export const BOSS_IDS = new Set(
    (process.env.BOSS_IDS ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s !== "")
        .map(Number)
        .filter(Number.isInteger)
);

if (BOSS_IDS.size === 0) {
    console.warn("⚠️ BOSS_IDS is empty in .env — nobody can open the boss panel");
}

// The bot reacts to exact button text, so every keyboard and comparison must use these
export const BUTTONS = {
    GUARD: "👮 Охранник",
    BOSS: "👑 Начальник",
    RESTART: "🔄 Перезапуск",

    SET_HOURS: "⏰ Указать часы",
    MY_HOURS: "📋 Мои часы",
    DELETE_ENTRY: "🗑 Удалить запись",
    UPLOAD_PAYSLIP: "📄 Загрузить тлюш",

    CONFIRM_RATES: "✅ Всё верно",
    MANUAL_RATES: "✏️ Ввести вручную",

    THIS_MONTH: "📊 Этот месяц",
    PREV_MONTH: "📊 Прошлый месяц",
    OTHER_MONTH: "🗓 Другой месяц",

    REPLACE: "🔁 Заменить",
    ADD_SHIFT: "➕ Добавить ещё смену",
    CANCEL: "❌ Отмена",
} as const;

export const state = new Map<number, State>();

export const bot = new TelegramBot(token, {
    polling: true,
});
