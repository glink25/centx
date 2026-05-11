// Generic CRUD for id-keyed collections that live inside Cent's
// `GlobalMeta` (e.g. `categories`, `tags`, `budgets`, `customFilters`)
// or `PersonalMeta` (e.g. `tagGroups`, `scheduleds`).
//
// All meta writes share the same path: read → mutate copy → write back via
// `endpoint.batch(repo, [{ type: "meta", metaValue: newMeta }])`. Each
// entity command file only declares a `MetaCollectionDescriptor` plus its
// own field-builder; the heavy lifting (resolution, mutation, exit-after-
// write) lives here.

import { randomUUID } from "node:crypto";
import type { GlobalMeta, PersonalMeta } from "@/ledger/type";
import { getCurrentUser } from "./config.ts";

export type MetaScope = "global" | "personal";

export type MetaCollectionDescriptor<T extends { id: string }> = {
    /** Human label for error messages, e.g. "category". */
    name: string;
    /** Where the array lives. */
    scope: MetaScope;
    /**
     * Key inside `GlobalMeta` (when scope=global) or
     * `PersonalMeta` (when scope=personal). String-typed because keys span
     * both shapes; the runtime cast is unavoidable.
     */
    pluralPath: string;
    /** Property used to resolve a user-provided name to an id. */
    nameField?: keyof T;
    /**
     * Built-in entries merged in only for resolution (so users can refer to
     * default categories by name). Defaults are NOT written back into meta.
     */
    defaults?: T[];
    /**
     * Optional locale-aware name (e.g. categories with `customName=false`
     * compare against `t(name)`).
     */
    localizeName?: (item: T) => string;
    /** Invariant check after each mutation. Throw to abort. */
    validate?: (next: T[], action: "add" | "update" | "delete") => void;
};

type MetaEndpoint = {
    initBook: (id: string) => Promise<void>;
    getMeta: (id: string) => Promise<GlobalMeta>;
    batch: (id: string, ops: { type: string; metaValue?: GlobalMeta }[]) => Promise<void>;
};

const requireCurrentUser = () => {
    const user = getCurrentUser();
    if (!user) {
        throw new Error(
            "no logged-in user — run `cent-cli login <github|gitee|webdav> ...` first",
        );
    }
    return user;
};

const readListFromMeta = <T extends { id: string }>(
    meta: GlobalMeta | undefined,
    desc: MetaCollectionDescriptor<T>,
): T[] => {
    if (!meta) return [];
    if (desc.scope === "global") {
        const obj = meta as unknown as Record<string, T[] | undefined>;
        return obj[desc.pluralPath] ?? [];
    }
    const user = requireCurrentUser();
    const personal = meta.personal?.[user.id] as PersonalMeta | undefined;
    const obj = (personal ?? {}) as unknown as Record<string, T[] | undefined>;
    return obj[desc.pluralPath] ?? [];
};

const writeListToMeta = <T extends { id: string }>(
    meta: GlobalMeta,
    desc: MetaCollectionDescriptor<T>,
    next: T[],
): GlobalMeta => {
    if (desc.scope === "global") {
        return { ...meta, [desc.pluralPath]: next } as GlobalMeta;
    }
    const user = requireCurrentUser();
    const personalAll = { ...(meta.personal ?? {}) };
    const prev = (personalAll[user.id] ?? {}) as PersonalMeta;
    personalAll[user.id] = {
        ...prev,
        [desc.pluralPath]: next,
    } as PersonalMeta;
    return { ...meta, personal: personalAll };
};

export const loadList = async <T extends { id: string }>(
    endpoint: MetaEndpoint,
    bookId: string,
    desc: MetaCollectionDescriptor<T>,
): Promise<T[]> => {
    await endpoint.initBook(bookId);
    const meta = await endpoint.getMeta(bookId);
    return readListFromMeta(meta, desc);
};

const matchItem = <T extends { id: string }>(
    it: T,
    desc: MetaCollectionDescriptor<T>,
    input: string,
): boolean => {
    if (it.id === input) return true;
    if (desc.nameField) {
        const raw = it[desc.nameField];
        if (typeof raw === "string" && raw === input) return true;
        if (desc.localizeName && desc.localizeName(it) === input) return true;
    }
    return false;
};

/** Resolve user input (id | name | localized name) to a single id. */
export const resolveItemId = <T extends { id: string }>(
    list: T[],
    desc: MetaCollectionDescriptor<T>,
    input: string,
): string => {
    const all = [...list, ...(desc.defaults ?? [])];
    const matches = all.filter((it) => matchItem(it, desc, input));
    if (matches.length === 1) return matches[0].id;
    if (matches.length > 1) {
        throw new Error(
            `${desc.name} "${input}" is ambiguous: ${matches
                .map((m) => m.id)
                .join(", ")} — pass the id explicitly`,
        );
    }
    throw new Error(`${desc.name} "${input}" not found`);
};

const mutateMeta = async <T extends { id: string }>(
    endpoint: MetaEndpoint,
    bookId: string,
    desc: MetaCollectionDescriptor<T>,
    mutator: (prev: T[]) => T[],
): Promise<T[]> => {
    await endpoint.initBook(bookId);
    const meta = ((await endpoint.getMeta(bookId)) ?? {}) as GlobalMeta;
    const prev = readListFromMeta(meta, desc);
    const next = mutator([...prev]);
    const newMeta = writeListToMeta(meta, desc, next);
    await endpoint.batch(bookId, [{ type: "meta", metaValue: newMeta }]);
    return next;
};

export const commonAdd = async <T extends { id: string }>(
    endpoint: MetaEndpoint,
    bookId: string,
    desc: MetaCollectionDescriptor<T>,
    builder: () => Omit<T, "id">,
): Promise<T> => {
    const item = { ...builder(), id: randomUUID() } as T;
    await mutateMeta(endpoint, bookId, desc, (prev) => {
        const next = [...prev, item];
        desc.validate?.(next, "add");
        return next;
    });
    return item;
};

export const commonUpdate = async <T extends { id: string }>(
    endpoint: MetaEndpoint,
    bookId: string,
    desc: MetaCollectionDescriptor<T>,
    targetId: string,
    patch: (existing: T) => T,
): Promise<T> => {
    let updated: T | undefined;
    await mutateMeta(endpoint, bookId, desc, (prev) => {
        const idx = prev.findIndex((it) => it.id === targetId);
        if (idx === -1) {
            throw new Error(`${desc.name} "${targetId}" not found`);
        }
        const out = patch(prev[idx]);
        updated = { ...out, id: targetId };
        const next = [...prev];
        next[idx] = updated;
        desc.validate?.(next, "update");
        return next;
    });
    return updated as T;
};

export const commonDelete = async <T extends { id: string }>(
    endpoint: MetaEndpoint,
    bookId: string,
    desc: MetaCollectionDescriptor<T>,
    targetId: string,
): Promise<void> => {
    await mutateMeta(endpoint, bookId, desc, (prev) => {
        const next = prev.filter((it) => it.id !== targetId);
        if (next.length === prev.length) {
            throw new Error(`${desc.name} "${targetId}" not found`);
        }
        desc.validate?.(next, "delete");
        return next;
    });
};

export const requireBook = (book: string | undefined): string => {
    if (!book) throw new Error("--book <name|id> is required");
    return book;
};

export const requireYes = (yes: boolean | undefined, label: string) => {
    if (!yes) {
        throw new Error(
            `destructive — pass --yes to confirm ${label} deletion (CLI is non-interactive)`,
        );
    }
};
