// Level-backed replacement for `@/database/storage`'s `BillIndexedDBStorage`.
//
// Aliased into the bundle via tsup so any `import { BillIndexedDBStorage }
// from "@/database/storage"` in the reused Cent Web sources resolves here.
//
// One LevelDB per dbName, persisted at `~/.cent-cli/cache/<sanitized-dbName>/`.
// Sublevels match the original IndexedDB object stores:
//   __stashes  — append-only ops (key = action.id, sorted by `timestamp` desc)
//   __items    — full bills    (key = bill.id,    sorted by `time`      desc)
//   __meta     — single value at "metaKey"
//   __config   — single value at "metaKey"  (holds the remote StoreStructure
//                that powers tidal's incremental diffStructure)

import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Level } from "level";
import { StashBucket } from "@/database/stash";
import type {
    Arrayable,
    ArrayableStorageFactory,
    BaseItem,
    StashStorage,
    StorageFactory,
} from "@/database/stash";
import { cliConfigDir } from "./globals";

const CACHE_ROOT = join(cliConfigDir, "cache");

const ensureRoot = () => {
    if (!existsSync(CACHE_ROOT)) mkdirSync(CACHE_ROOT, { recursive: true });
};

// LevelDB does not allow `/` in the path on its own — and Cent Web names books
// `book-<owner>/<repo>`. Sanitize so each book lives in a single flat directory.
const sanitize = (dbName: string) => dbName.replace(/[\\/]/g, "__");

type SubDB = ReturnType<Level<string, any>["sublevel"]>;

const STASH = StashBucket.STASH_NAME;
const ITEM = StashBucket.ITEM_NAME;
const META = StashBucket.META_NAME;
const CONFIG = StashBucket.CONFIG_NAME;

type AnyName = typeof STASH | typeof ITEM | typeof META | typeof CONFIG;

// Track open DBs so `dangerousClearAll` can safely delete the directory tree.
const openDBs = new Map<string, Level<string, any>>();

export class BillIndexedDBStorage implements StashStorage {
    public readonly dbName: string;
    private dbPromise?: Promise<Level<string, any>>;

    constructor(dbName: string) {
        this.dbName = dbName;
    }

    private getDB(): Promise<Level<string, any>> {
        if (this.dbPromise) return this.dbPromise;
        ensureRoot();
        const path = join(CACHE_ROOT, sanitize(this.dbName));
        const db = new Level<string, any>(path, { valueEncoding: "json" });
        this.dbPromise = db.open().then(() => {
            openDBs.set(path, db);
            return db;
        });
        return this.dbPromise;
    }

    private async sub<V = any>(name: AnyName): Promise<SubDB> {
        const db = await this.getDB();
        return db.sublevel<string, V>(name, { valueEncoding: "json" });
    }

    private async closeDB() {
        if (!this.dbPromise) return;
        const db = await this.dbPromise;
        await db.close();
        const path = join(CACHE_ROOT, sanitize(this.dbName));
        openDBs.delete(path);
        this.dbPromise = undefined;
    }

    createArrayableStorage: ArrayableStorageFactory = <T extends BaseItem>(
        name: typeof STASH | typeof ITEM,
    ): Arrayable<T> => {
        const indexField = name === STASH ? "timestamp" : "time";
        return {
            put: async (...v: T[]) => {
                if (v.length === 0) return;
                const sub = await this.sub<T>(name);
                await sub.batch(
                    v.map((item) => ({
                        type: "put" as const,
                        key: String(item.id),
                        value: item,
                    })),
                );
            },
            delete: async (...ids: T["id"][]) => {
                if (ids.length === 0) return;
                const sub = await this.sub<T>(name);
                await sub.batch(
                    ids.map((id) => ({
                        type: "del" as const,
                        key: String(id),
                    })),
                );
            },
            clear: async () => {
                const sub = await this.sub<T>(name);
                await sub.clear();
            },
            toArray: async (limit?: number) => {
                const sub = await this.sub<T>(name);
                const all: T[] = [];
                for await (const value of sub.values()) {
                    all.push(value as T);
                }
                // descending by index field to mirror the IDB cursor("prev")
                all.sort((a: any, b: any) => {
                    const av = a[indexField];
                    const bv = b[indexField];
                    if (av === bv) return 0;
                    return av < bv ? 1 : -1;
                });
                return limit !== undefined ? all.slice(0, limit) : all;
            },
        };
    };

    createStorage: StorageFactory = (name: typeof META | typeof CONFIG) => {
        return {
            setValue: async (v: any) => {
                const sub = await this.sub(name);
                await sub.put("metaKey", { id: "metaKey", value: v });
            },
            getValue: async () => {
                const sub = await this.sub(name);
                try {
                    const v = (await sub.get("metaKey")) as
                        | { value: any }
                        | undefined;
                    return v?.value;
                } catch (err: any) {
                    if (
                        err?.code === "LEVEL_NOT_FOUND" ||
                        err?.notFound === true
                    ) {
                        return undefined;
                    }
                    throw err;
                }
            },
        };
    };

    clearStorages = async () => {
        await this.closeDB();
        const path = join(CACHE_ROOT, sanitize(this.dbName));
        if (existsSync(path)) rmSync(path, { recursive: true, force: true });
    };

    dangerousClearAll = async () => {
        await Promise.all(
            Array.from(openDBs.values()).map((db) => db.close()),
        );
        openDBs.clear();
        if (existsSync(CACHE_ROOT)) {
            rmSync(CACHE_ROOT, { recursive: true, force: true });
        }
    };

    static async getArrableStorageNames(): Promise<string[]> {
        if (!existsSync(CACHE_ROOT)) return [];
        return readdirSync(CACHE_ROOT);
    }
}
