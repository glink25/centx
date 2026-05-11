// Helpers to resolve user-facing names ("food" / "餐饮" / "Food") to internal
// ids, using the book's GlobalMeta merged with built-in defaults.
//
// Three-way matching, modeled on filter-query's resolveIds (src/ledger/
// filter-query/index.ts:199-211) but extended with locale lookup so that
// CLI users / AI agents can pass the localized display name they see in
// the web UI.

import { BillCategories } from "@/ledger/category";
import { t } from "@/locale";
import type { BillCategory, BillTag, GlobalMeta } from "@/ledger/type";

export type ResolveCategoryInput = {
    name?: string;
    type?: "income" | "expense";
};

const localizedCategoryName = (c: BillCategory): string =>
    c.customName ? c.name : t(c.name);

const localizedTagName = (tag: BillTag): string => {
    // Tags don't have customName; their `name` is always user-supplied.
    // Still allow t() lookup as a no-op fallback (returns key when missing).
    return tag.name;
};

const matchCategory = (c: BillCategory, input: string): boolean => {
    return (
        c.id === input ||
        c.name === input ||
        localizedCategoryName(c) === input
    );
};

const matchTag = (tag: BillTag, input: string): boolean => {
    return (
        tag.id === input ||
        tag.name === input ||
        localizedTagName(tag) === input
    );
};

export const resolveCategoryId = (
    meta: GlobalMeta | undefined,
    input: ResolveCategoryInput,
): string => {
    const { name, type } = input;
    if (!name) {
        throw new Error("--category is required");
    }
    const all: BillCategory[] = [
        ...(meta?.categories ?? []),
        ...BillCategories,
    ];

    const matched = all.filter(
        (c) => matchCategory(c, name) && (type ? c.type === type : true),
    );

    if (matched.length === 1) return matched[0].id;
    if (matched.length > 1) {
        throw new Error(
            `category "${name}" is ambiguous: ${matched
                .map((c) => `${c.id}(${c.type}, "${localizedCategoryName(c)}")`)
                .join(", ")}; pass --type or --category <id>`,
        );
    }
    throw new Error(
        `category "${name}" not found in book meta or built-in defaults`,
    );
};

export const resolveTagId = (
    meta: GlobalMeta | undefined,
    input: string,
): string => {
    const tags: BillTag[] = meta?.tags ?? [];
    const matched = tags.filter((tag) => matchTag(tag, input));
    if (matched.length === 1) return matched[0].id;
    if (matched.length > 1) {
        throw new Error(
            `tag "${input}" is ambiguous: ${matched.map((tag) => tag.id).join(", ")}; pass --tag <id>`,
        );
    }
    throw new Error(
        `tag "${input}" not found — create it in the web app first`,
    );
};
