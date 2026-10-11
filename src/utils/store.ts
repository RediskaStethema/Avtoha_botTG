import fs from "node:fs";
import {HOURS_ARCHIVE_FILE, HOURS_FILE, USERS_FILE} from "./constants.js";
import {inMonth, normalizeDate, sortEntries} from "./hours.js";
import type {ArchivedWorkHours, PayRates, User, WorkHours} from "./types.js";

// In-memory data is the source of truth while the bot runs; every change is written to disk right away
let users: User[] = [];
let hours: WorkHours[] = [];

// Write to a temp file first, then rename, so a crash mid-write never leaves a broken JSON
function writeJsonAtomic(file: string, data: unknown) {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
    fs.renameSync(tmp, file);
}

function readJsonArray<T>(file: string): T[] {
    if (!fs.existsSync(file)) return [];

    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf-8"));

    if (!Array.isArray(parsed)) {
        throw new Error(`${file} does not contain a JSON array`);
    }

    return parsed as T[];
}

const saveUsers = () => writeJsonAtomic(USERS_FILE, users);
const saveHours = () => writeJsonAtomic(HOURS_FILE, hours);

function migrateDates(entries: WorkHours[]): boolean {
    let changed = false;

    for (const entry of entries) {
        const iso = normalizeDate(entry.date);

        if (iso !== entry.date) {
            entry.date = iso;
            changed = true;
        }
    }

    return changed;
}

// Entries archived by the removed "New Month" button are merged back (hours are now split by month instead).
// The archive file is kept as a backup under a new name.
function mergeLegacyArchive() {
    if (!fs.existsSync(HOURS_ARCHIVE_FILE)) return;

    const archive = readJsonArray<ArchivedWorkHours>(HOURS_ARCHIVE_FILE);
    migrateDates(archive);

    for (const { archivedAt: _, ...entry } of archive) {
        const duplicate = hours.some((h) =>
            h.userId === entry.userId && h.date === entry.date && h.hours === entry.hours
        );

        if (!duplicate) hours.push(entry);
    }

    // Save before renaming, so a crash in between can't hide the merged entries
    saveHours();
    fs.renameSync(HOURS_ARCHIVE_FILE, `${HOURS_ARCHIVE_FILE}.merged`);
    console.log(`Merged ${archive.length} archived entries back into hours`);
}

export function loadData() {
    try {
        users = readJsonArray<User>(USERS_FILE);
        hours = readJsonArray<WorkHours>(HOURS_FILE);

        // One-time migrations: legacy "DD.MM.YYYY" dates to ISO, then the old archive back into hours
        if (migrateDates(hours)) saveHours();
        mergeLegacyArchive();
    } catch (e) {
        throw new Error(`Failed to load data: ${e}`);
    }
}

export const getUsers = (): readonly User[] => users;
export const getHours = (): readonly WorkHours[] => hours;

export const findUser = (id: number) => users.find((u) => u.id === id);

export function addUser(user: User) {
    users.push(user);
    saveUsers();
}

// Returns false if the user is not registered
export function setUserRates(id: number, rates: PayRates): boolean {
    const user = findUser(id);
    if (!user) return false;

    user.rates = rates;
    saveUsers();

    return true;
}

export const userEntriesOn =(userId: number, date: string) =>
    hours.filter((h) => h.userId === userId && h.date === date);

// Removes `replaced` (matched by reference) and adds `entry` in a single write
export function addEntry(entry: WorkHours, replaced: readonly WorkHours[] = []) {
    hours = hours.filter((h) => !replaced.includes(h));
    hours.push(entry);
    saveHours();
}

// Returns false if the entry is already gone (e.g. archived in the meantime)
export function removeEntry(entry: WorkHours): boolean {
    if (!hours.includes(entry)) return false;

    hours = hours.filter((h) => h !== entry);
    saveHours();

    return true;
}

export const getGuards = () => users.filter((u) => u.role === "guard");

export const userEntriesInMonth = (userId: number, month: string) =>
    sortEntries(inMonth(hours, month).filter((h) => h.userId === userId));

export const entriesInMonth = (month: string) => inMonth(hours, month);
