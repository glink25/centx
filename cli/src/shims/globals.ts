// Browser-API shims for Node. Imported FIRST in bin/cent-cli.ts before any
// reused src/ code is evaluated. Keep side-effect-only.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import dayjs from "dayjs";
import isSameOrAfter from "dayjs/plugin/isSameOrAfter.js";
import isSameOrBefore from "dayjs/plugin/isSameOrBefore.js";

// Reused src/ledger/filter-query relies on these plugins; the web app extends
// them in src/ledger/utils.ts but the CLI does not necessarily import that
// module first. Extend here, idempotently.
dayjs.extend(isSameOrAfter);
dayjs.extend(isSameOrBefore);

const CONFIG_DIR = process.env.CENT_CLI_HOME ?? join(homedir(), ".cent-cli");
const STORAGE_FILE = join(CONFIG_DIR, "local-storage.json");

const ensureDir = (p: string) => {
    if (!existsSync(p)) mkdirSync(p, { recursive: true });
};

const loadStore = (): Record<string, string> => {
    if (!existsSync(STORAGE_FILE)) return {};
    try {
        return JSON.parse(readFileSync(STORAGE_FILE, "utf8"));
    } catch {
        return {};
    }
};

let store = loadStore();

const persist = () => {
    ensureDir(dirname(STORAGE_FILE));
    writeFileSync(STORAGE_FILE, JSON.stringify(store, null, 2));
};

const localStorageShim: Storage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => {
        store[k] = String(v);
        persist();
    },
    removeItem: (k) => {
        delete store[k];
        persist();
    },
    clear: () => {
        store = {};
        persist();
    },
    get length() {
        return Object.keys(store).length;
    },
    key: (i) => Object.keys(store)[i] ?? null,
};

const g = globalThis as any;
if (!g.localStorage) g.localStorage = localStorageShim;
if (!g.window) g.window = { open: () => {}, origin: "" };
if (!g.location) g.location = { reload: () => {}, origin: "" };

export const cliConfigDir = CONFIG_DIR;
