import {extractText, getDocumentProxy} from "unpdf";
import type TelegramBot from "node-telegram-bot-api";
import {bot, BUTTONS, state} from "../utils/constants.js";
import {safeSend, sendCancelKeyboard, sendGuardMenu, sendKeyboard, sendLongMessage} from "../utils/tools.js";
import * as store from "../utils/store.js";
import {currentMonthKey, formatMonth} from "../utils/hours.js";
import {formatPay, formatRates, PAY_NOTE} from "../utils/pay.js";
import {MANUAL_RATES_HELP, parseManualRates, parsePayslip} from "../utils/payslip.js";
import type {PayRates, StepState} from "../utils/types.js";
import {requireGuard} from "./guard.js";

const MAX_PDF_BYTES = 5 * 1024 * 1024;

// Fewer characters than this means a scanned image without a text layer
const MIN_TEXT_LENGTH = 20;

// pdf.js PasswordException codes
const NEED_PASSWORD = 1;
const INCORRECT_PASSWORD = 2;

function passwordErrorCode(e: unknown): number | undefined {
    return e instanceof Error && e.name === "PasswordException"
        ? (e as Error & { code?: number }).code
        : undefined;
}

// The payslip is only held in memory: it contains ת.ז., bank account and address, so it is never written to disk
async function downloadFile(fileId: string): Promise<Uint8Array> {
    const response = await fetch(await bot.getFileLink(fileId));

    // The URL contains the bot token, so it is not included in the error
    if (!response.ok) throw new Error(`File download failed: HTTP ${response.status}`);

    return new Uint8Array(await response.arrayBuffer());
}

const isPdf = (doc: TelegramBot.Document) =>
    doc.mime_type === "application/pdf" || /\.pdf$/i.test(doc.file_name ?? "");

async function sendRatesSaved(chatId: number, rates: PayRates) {
    const entries = store.userEntriesInMonth(chatId, currentMonthKey());

    const pay = entries.length > 0
        ? `\n\n📋 ${formatMonth(currentMonthKey())}\n${formatPay(entries, rates)}\n\n${PAY_NOTE}`
        : "";

    await sendLongMessage(chatId, `✅ Ставки сохранены:\n${formatRates(rates)}${pay}`);
    return sendGuardMenu(chatId);
}

function saveRates(chatId: number, rates: PayRates) {
    if (!store.setUserRates(chatId, rates)) {
        return sendGuardMenu(chatId, "Сначала зарегистрируйся");
    }

    return sendRatesSaved(chatId, rates);
}

async function askManualRates(chatId: number, reason = "") {
    state.set(chatId, { step: "ratesManual" });

    return sendCancelKeyboard(chatId, `${reason}${MANUAL_RATES_HELP}`);
}

async function readPayslip(chatId: number, fileId: string, password?: string) {
    let text: string;

    try {
        const data = await downloadFile(fileId);
        const pdf = await getDocumentProxy(data, password === undefined ? {} : { password });

        try {
            text = (await extractText(pdf, { mergePages: true })).text;
        } finally {
            await pdf.loadingTask.destroy();
        }
    } catch (e) {
        const code = passwordErrorCode(e);

        if (code === NEED_PASSWORD || code === INCORRECT_PASSWORD) {
            state.set(chatId, { step: "payslipPassword", fileId });

            return sendCancelKeyboard(chatId, code === INCORRECT_PASSWORD
                ? "❌ Неверный пароль, попробуй ещё раз:"
                : "🔒 Тлюш защищён паролем (обычно это номер ת.ז.). Отправь пароль — " +
                  "я использую его только чтобы открыть файл, нигде не сохраню и сразу удалю сообщение.");
        }

        console.error("Payslip reading failed:", e instanceof Error ? e.message : e);
        return askManualRates(chatId, "Не получилось открыть этот PDF.\n\n");
    }

    if (text.trim().length < MIN_TEXT_LENGTH) {
        return askManualRates(chatId, "В этом PDF нет текста (похоже на скан).\n\n");
    }

    const parsed = parsePayslip(text);

    if (parsed.hourlyRate === undefined) {
        return askManualRates(chatId, "Не нашёл в тлюше ставку за час.\n\n");
    }

    const rates: PayRates = {
        hourlyRate: parsed.hourlyRate,
        seniorityPerHour: parsed.seniorityPerHour ?? 0,
        recoveryPerHour: parsed.recoveryPerHour ?? 0,
        source: "payslip",
        updatedAt: new Date().toISOString(),
        ...(parsed.payslipMonth ? { payslipMonth: parsed.payslipMonth } : {}),
    };

    state.set(chatId, { step: "confirmRates", rates });

    const month = rates.payslipMonth ? ` за ${formatMonth(rates.payslipMonth)}` : "";

    return sendKeyboard(
        chatId,
        `📄 Нашёл в тлюше${month}:\n${formatRates(rates)}\n\n` +
        "Сверь с листком. 0 — значит такой строки в тлюше не нашёл.",
        [[BUTTONS.CONFIRM_RATES, BUTTONS.MANUAL_RATES], [BUTTONS.CANCEL]]
    );
}

// --- Menu button ---

export async function askPayslip(chatId: number) {
    const user = await requireGuard(chatId);
    if (!user) return;

    state.set(chatId, { step: "payslip" });

    const current = user.rates
        ? `Сейчас ставки${user.rates.payslipMonth ? ` (тлюш за ${formatMonth(user.rates.payslipMonth)})` : ""}:\n` +
          `${formatRates(user.rates)}\n\n`
        : "";

    return sendKeyboard(
        chatId,
        `${current}Отправь свой тлюш PDF-файлом (📎 → Файл). Я возьму из него ставку за час, ותק и הבראה — ` +
        "по ним буду считать зарплату. Сам файл не сохраняется.",
        [[BUTTONS.MANUAL_RATES], [BUTTONS.CANCEL]]
    );
}

// --- Incoming PDF (accepted at any time from a registered guard) ---

export async function handlePayslipDocument(chatId: number, doc: TelegramBot.Document) {
    if (!await requireGuard(chatId)) return;

    if (!isPdf(doc)) {
        return safeSend(chatId, "Нужен PDF-файл тлюша");
    }

    if ((doc.file_size ?? 0) > MAX_PDF_BYTES) {
        return safeSend(chatId, "Файл слишком большой (больше 5 МБ) — это точно тлюш?");
    }

    state.delete(chatId);
    await safeSend(chatId, "📄 Читаю тлюш…");

    return readPayslip(chatId, doc.file_id);
}

// --- Conversation steps ---

export async function handlePayslipStep(chatId: number, text: string) {
    if (text === BUTTONS.CANCEL) {
        state.delete(chatId);
        return sendGuardMenu(chatId);
    }

    if (text === BUTTONS.MANUAL_RATES) {
        return askManualRates(chatId);
    }

    return safeSend(chatId, "Жду PDF-файл тлюша (📎 → Файл) или нажми «✏️ Ввести вручную»");
}

export async function handlePasswordStep(
    chatId: number,
    text: string,
    userState: StepState<"payslipPassword">,
    messageId: number
) {
    state.delete(chatId);

    if (text === BUTTONS.CANCEL) {
        return sendGuardMenu(chatId);
    }

    // The password is personal data: remove it from the chat
    try {
        await bot.deleteMessage(chatId, messageId);
    } catch (e) {
        console.error("Failed to delete the password message:", e instanceof Error ? e.message : e);
    }

    return readPayslip(chatId, userState.fileId, text.trim());
}

export async function handleConfirmRatesStep(chatId: number, text: string, userState: StepState<"confirmRates">) {
    state.delete(chatId);

    if (text === BUTTONS.CONFIRM_RATES) {
        return saveRates(chatId, userState.rates);
    }

    if (text === BUTTONS.MANUAL_RATES) {
        return askManualRates(chatId);
    }

    return sendGuardMenu(chatId, "Отменено, ставки не изменены");
}

export async function handleManualRatesStep(chatId: number, text: string) {
    if (text === BUTTONS.CANCEL) {
        state.delete(chatId);
        return sendGuardMenu(chatId);
    }

    const parsed = parseManualRates(text);

    if (!parsed.ok) {
        return safeSend(chatId, parsed.error);
    }

    state.delete(chatId);

    return saveRates(chatId, { ...parsed.rates, source: "manual", updatedAt: new Date().toISOString() });
}
