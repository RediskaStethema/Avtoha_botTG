import {BUTTONS, state} from "../utils/constants.js";
import {
    safeSend,
    sendCancelKeyboard,
    sendGuardMenu,
    sendKeyboard,
    sendLongMessage,
    sendStartMenu
} from "../utils/tools.js";
import * as store from "../utils/store.js";
import {
    currentMonthKey,
    ENTRY_FORMAT_HELP,
    formatEntry,
    formatMonth,
    formatTotal,
    parseEntry,
    previousMonthKey
} from "../utils/hours.js";
import {formatPay, formatPayShort, PAY_NOTE} from "../utils/pay.js";
import type {StepState, User, WorkHours} from "../utils/types.js";

const NAME_MIN = 2;
const NAME_MAX = 40;
const BUTTON_TEXTS: readonly string[] = Object.values(BUTTONS);

// Returns the cleaned name or an error message
function validateName(raw: string): { ok: true; name: string } | { ok: false; error: string } {
    const name = raw.trim().replace(/\s+/g, " ");

    if (name.startsWith("/") || BUTTON_TEXTS.includes(name)) {
        return { ok: false, error: "Это не похоже на имя. Введи своё имя:" };
    }

    if (name.length < NAME_MIN || name.length > NAME_MAX) {
        return { ok: false, error: `Имя должно быть от ${NAME_MIN} до ${NAME_MAX} символов. Введи имя:` };
    }

    if (!/\p{L}/u.test(name)) {
        return { ok: false, error: "Имя должно содержать буквы. Введи имя:" };
    }

    return { ok: true, name };
}

export async function requireGuard(chatId: number): Promise<User | undefined> {
    const user = store.findUser(chatId);

    if (user?.role === "guard") return user;

    await sendStartMenu(chatId, `Сначала зарегистрируйся: нажми «${BUTTONS.GUARD}»`);
    return undefined;
}

async function saveEntry(chatId: number, entry: WorkHours, replaced: readonly WorkHours[] = []) {
    store.addEntry(entry, replaced);
    return sendGuardMenu(chatId, `✅ Записано: ${formatEntry(entry)}`);
}

// --- Menu buttons ---

export async function startRegistration(chatId: number) {
    const user = store.findUser(chatId);

    if (user) {
        return sendGuardMenu(chatId, `Ты уже зарегистрирован как ${user.name}`);
    }

    state.set(chatId, { step: "name" });

    return sendCancelKeyboard(chatId, "Введи имя:");
}

export async function askHours(chatId: number) {
    if (!await requireGuard(chatId)) return;

    state.set(chatId, { step: "hours" });

    return sendCancelKeyboard(chatId, ENTRY_FORMAT_HELP);
}

export async function askDeleteEntry(chatId: number) {
    if (!await requireGuard(chatId)) return;

    // Only this and last month, so the numbered list stays short
    const entries = [
        ...store.userEntriesInMonth(chatId, previousMonthKey()),
        ...store.userEntriesInMonth(chatId, currentMonthKey()),
    ];

    if (entries.length === 0) {
        return sendGuardMenu(chatId, "У тебя нет записей за этот и прошлый месяц");
    }

    state.set(chatId, { step: "delete", entries });

    const list = entries.map((e, i) => `${i + 1}. ${formatEntry(e)}`).join("\n");

    await sendLongMessage(chatId, `${list}\n\n${formatTotal(entries)}`);
    return sendCancelKeyboard(
        chatId,
        "Отправь номер записи для удаления.\nЧтобы исправить запись — просто введи часы за этот день заново и выбери «Заменить»."
    );
}

export async function showMyHours(chatId: number) {
    const user = await requireGuard(chatId);
    if (!user) return;

    const month = currentMonthKey();
    const prevMonth = previousMonthKey();
    const entries = store.userEntriesInMonth(chatId, month);
    const prevEntries = store.userEntriesInMonth(chatId, prevMonth);

    const parts = [
        entries.length > 0
            ? `📋 ${formatMonth(month)}\n${entries.map(formatEntry).join("\n")}\n${formatTotal(entries)}\n\n${formatPay(entries, user.rates)}`
            : `📋 ${formatMonth(month)}: записей пока нет`,
    ];

    if (prevEntries.length > 0) {
        parts.push(`${formatMonth(prevMonth)} — ${formatTotal(prevEntries)}\n${formatPayShort(prevEntries, user.rates)}`);
    }

    if (user.rates && (entries.length > 0 || prevEntries.length > 0)) {
        parts.push(PAY_NOTE);
    }

    await sendLongMessage(chatId, parts.join("\n\n"));
    return sendGuardMenu(chatId, "Если что-то не так — исправь через «⏰ Указать часы» или «🗑 Удалить запись»");
}

// --- Conversation steps ---

export async function handleNameStep(chatId: number, text: string) {
    if (text === BUTTONS.CANCEL) {
        state.delete(chatId);
        return sendStartMenu(chatId);
    }

    const result = validateName(text);

    if (!result.ok) {
        return safeSend(chatId, result.error);
    }

    state.delete(chatId);
    store.addUser({ id: chatId, name: result.name, role: "guard" });

    return sendGuardMenu(chatId, `✅ Ты зарегистрирован как ${result.name}`);
}

export async function handleHoursStep(chatId: number, text: string) {
    if (text === BUTTONS.CANCEL) {
        state.delete(chatId);
        return sendGuardMenu(chatId);
    }

    const user = store.findUser(chatId);

    if (!user) {
        state.delete(chatId);
        return sendStartMenu(chatId);
    }

    const parsed = parseEntry(text);

    if (!parsed.ok) {
        return safeSend(chatId, parsed.error);
    }

    const entry: WorkHours = {
        userId: chatId,
        name: user.name,
        date: parsed.date,
        hours: parsed.hours,
    };

    const existing = store.userEntriesOn(chatId, entry.date);

    if (existing.length > 0) {
        state.set(chatId, { step: "confirmDuplicate", entry, existing });

        const lines = existing.map(formatEntry).join("\n");

        return sendKeyboard(chatId, `За этот день уже есть запись:\n${lines}\n\nЧто сделать?`, [
            [BUTTONS.REPLACE, BUTTONS.ADD_SHIFT],
            [BUTTONS.CANCEL],
        ]);
    }

    state.delete(chatId);
    return saveEntry(chatId, entry);
}

export async function handleDuplicateStep(chatId: number, text: string, userState: StepState<"confirmDuplicate">) {
    state.delete(chatId);

    if (text === BUTTONS.REPLACE) {
        return saveEntry(chatId, userState.entry, userState.existing);
    }

    if (text === BUTTONS.ADD_SHIFT) {
        return saveEntry(chatId, userState.entry);
    }

    return sendGuardMenu(chatId, "Отменено");
}

export async function handleDeleteStep(chatId: number, text: string, userState: StepState<"delete">) {
    if (text === BUTTONS.CANCEL) {
        state.delete(chatId);
        return sendGuardMenu(chatId);
    }

    const index = Number(text.trim()) - 1;
    const target = Number.isInteger(index) ? userState.entries[index] : undefined;

    if (!target) {
        return safeSend(chatId, `Отправь номер от 1 до ${userState.entries.length}`);
    }

    state.delete(chatId);

    // The same entry may have been deleted from another device in the meantime
    if (!store.removeEntry(target)) {
        return sendGuardMenu(chatId, "Эта запись уже удалена");
    }

    return sendGuardMenu(chatId, `🗑 Удалено: ${formatEntry(target)}`);
}
