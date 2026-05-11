import { numberToAmount } from "@/ledger/bill";
import { BillCategories } from "@/ledger/category";
import type {
    BillCategory,
    BillFilter,
    BillFilterView,
    BillTag,
    BillType,
} from "@/ledger/type";
import { resolveBook } from "../runtime/book.ts";
import { createGithubEndpoint } from "../runtime/context.ts";
import {
    type MetaCollectionDescriptor,
    commonAdd,
    commonDelete,
    commonUpdate,
    loadList,
    requireBook,
    requireYes,
    resolveItemId,
} from "../runtime/meta-collection.ts";
import { printJson, printTable } from "../runtime/output.ts";

const desc: MetaCollectionDescriptor<BillFilterView> = {
    name: "filter-view",
    scope: "global",
    pluralPath: "customFilters",
    nameField: "name",
};

const categoryDesc: MetaCollectionDescriptor<BillCategory> = {
    name: "category",
    scope: "global",
    pluralPath: "categories",
    nameField: "name",
    defaults: BillCategories,
};

const tagDesc: MetaCollectionDescriptor<BillTag> = {
    name: "tag",
    scope: "global",
    pluralPath: "tags",
    nameField: "name",
};

const splitCsv = (input: string | undefined): string[] => {
    if (!input) return [];
    return input.split(",").map((s) => s.trim()).filter(Boolean);
};

const parseIso = (s: string, label: string): number => {
    const t = Date.parse(s);
    if (Number.isNaN(t)) throw new Error(`${label} must be ISO-8601 (got "${s}")`);
    return t;
};

const parseFiniteNumber = (s: string | number, label: string): number => {
    const n = Number(s);
    if (!Number.isFinite(n)) throw new Error(`${label} must be a number (got "${s}")`);
    return n;
};

const parseRecent = (s: string): { value: number; unit: "year" | "month" | "week" | "day" } => {
    // accepts "7d", "3w", "12m", "1y" (also full unit names: 7day / 3week / 12month / 1year)
    const m = /^(\d+)\s*(d|w|m|y|day|week|month|year)$/i.exec(s.trim());
    if (!m) {
        throw new Error(
            `--recent must look like "7d" / "3w" / "12m" / "1y" (got "${s}")`,
        );
    }
    const value = Number(m[1]);
    const u = m[2].toLowerCase();
    const unit =
        u.startsWith("d") ? "day" : u.startsWith("w") ? "week" : u.startsWith("m") ? "month" : "year";
    return { value, unit };
};

const parseModules = (raw: string | undefined): BillFilterView["modules"] | undefined => {
    if (raw === undefined) return undefined;
    const allowed = new Set([
        "base-analysis",
        "top-words",
        "map",
        "analysis",
        "top-expense",
        "top-income",
    ]);
    return splitCsv(raw).map((m) => {
        if (m.startsWith("widget-")) return m as `widget-${string}`;
        if (!allowed.has(m)) {
            throw new Error(
                `--modules item "${m}" not recognized (allowed: ${[...allowed].join(",")} or widget-<id>)`,
            );
        }
        return m as Exclude<NonNullable<BillFilterView["modules"]>[number], `widget-${string}`>;
    });
};

const parseJoiners = (raw: string | undefined): (string | number)[] | undefined => {
    if (raw === undefined) return undefined;
    return splitCsv(raw).map((s) =>
        Number.isFinite(Number(s)) && /^-?\d+$/.test(s) ? Number(s) : s,
    );
};

const buildBillFilter = async (
    opts: FilterViewBaseOpts,
    endpoint: Awaited<ReturnType<typeof createGithubEndpoint>>,
    bookId: string,
    base: BillFilter = {},
): Promise<BillFilter> => {
    const out: BillFilter = { ...base };

    if (opts.comment !== undefined) {
        if (opts.comment === "") delete out.comment;
        else out.comment = opts.comment;
    }
    if (opts.recent !== undefined) {
        if (opts.recent === "") delete out.recent;
        else out.recent = parseRecent(opts.recent);
    }
    if (opts.start !== undefined) {
        if (opts.start === "") delete out.start;
        else out.start = parseIso(opts.start, "--start");
    }
    if (opts.end !== undefined) {
        if (opts.end === "") delete out.end;
        else out.end = parseIso(opts.end, "--end");
    }
    if (opts.filterType !== undefined) {
        if (opts.filterType === "") delete out.type;
        else if (opts.filterType !== "expense" && opts.filterType !== "income") {
            throw new Error(`--filter-type must be expense|income (got "${opts.filterType}")`);
        } else out.type = opts.filterType as BillType;
    }
    if (opts.creators !== undefined) {
        const j = parseJoiners(opts.creators);
        if (j && j.length > 0) out.creators = j;
        else delete out.creators;
    }
    if (opts.categories !== undefined) {
        if (opts.categories === "") delete out.categories;
        else {
            const cats = await loadList(endpoint, bookId, categoryDesc);
            out.categories = splitCsv(opts.categories).map((n) =>
                resolveItemId(cats, categoryDesc, n),
            );
        }
    }
    if (opts.minAmount !== undefined) {
        if (opts.minAmount === "") delete out.minAmountNumber;
        else
            out.minAmountNumber = numberToAmount(parseFiniteNumber(opts.minAmount, "--min-amount"));
    }
    if (opts.maxAmount !== undefined) {
        if (opts.maxAmount === "") delete out.maxAmountNumber;
        else
            out.maxAmountNumber = numberToAmount(parseFiniteNumber(opts.maxAmount, "--max-amount"));
    }
    if (opts.assets !== undefined) out.assets = opts.assets;
    if (opts.scheduled !== undefined) out.scheduled = opts.scheduled;
    if (opts.tags !== undefined) {
        if (opts.tags === "") delete out.tags;
        else {
            const tags = await loadList(endpoint, bookId, tagDesc);
            out.tags = splitCsv(opts.tags).map((n) => resolveItemId(tags, tagDesc, n));
        }
    }
    if (opts.excludeTags !== undefined) {
        if (opts.excludeTags === "") delete out.excludeTags;
        else {
            const tags = await loadList(endpoint, bookId, tagDesc);
            out.excludeTags = splitCsv(opts.excludeTags).map((n) =>
                resolveItemId(tags, tagDesc, n),
            );
        }
    }
    if (opts.baseCurrency !== undefined) {
        if (opts.baseCurrency === "") delete out.baseCurrency;
        else out.baseCurrency = opts.baseCurrency;
    }
    if (opts.currencies !== undefined) {
        if (opts.currencies === "") delete out.currencies;
        else out.currencies = splitCsv(opts.currencies);
    }

    return out;
};

export type FilterViewBaseOpts = {
    book?: string;
    name?: string;
    displayCurrency?: string;
    modules?: string;
    // BillFilter mirrors:
    comment?: string;
    recent?: string;
    start?: string;
    end?: string;
    filterType?: string;
    creators?: string;
    categories?: string;
    minAmount?: string | number;
    maxAmount?: string | number;
    assets?: boolean;
    scheduled?: boolean;
    tags?: string;
    excludeTags?: string;
    baseCurrency?: string;
    currencies?: string;
    json?: boolean;
};

export type FilterViewListOpts = { book?: string; json?: boolean };
export type FilterViewGetOpts = { book?: string; id?: string; json?: boolean };
export type FilterViewAddOpts = FilterViewBaseOpts;
export type FilterViewUpdateOpts = FilterViewBaseOpts & { id?: string };
export type FilterViewDeleteOpts = {
    book?: string;
    id?: string;
    yes?: boolean;
    json?: boolean;
};

export const list = async (opts: FilterViewListOpts) => {
    const endpoint = await createGithubEndpoint();
    const book = await resolveBook(endpoint, requireBook(opts.book));
    const items = await loadList(endpoint, book.id, desc);
    if (opts.json) {
        printJson(items);
        return;
    }
    printTable(
        items.map((v) => ({
            id: v.id,
            name: v.name,
            displayCurrency: v.displayCurrency ?? "",
            modules: (v.modules ?? []).join(","),
            filterKeys: Object.keys(v.filter ?? {}).join(","),
        })),
        ["id", "name", "displayCurrency", "modules", "filterKeys"],
    );
};

export const get = async (opts: FilterViewGetOpts) => {
    if (!opts.id) throw new Error("<name|id> is required");
    const endpoint = await createGithubEndpoint();
    const book = await resolveBook(endpoint, requireBook(opts.book));
    const items = await loadList(endpoint, book.id, desc);
    const id = resolveItemId(items, desc, opts.id);
    const found = items.find((v) => v.id === id);
    if (!found) throw new Error(`filter-view "${opts.id}" not found`);
    if (opts.json) printJson(found);
    else process.stdout.write(`${JSON.stringify(found, null, 2)}\n`);
};

export const add = async (opts: FilterViewAddOpts) => {
    if (!opts.name) throw new Error("--name <s> is required");
    const endpoint = await createGithubEndpoint();
    const book = await resolveBook(endpoint, requireBook(opts.book));
    const filter = await buildBillFilter(opts, endpoint, book.id);
    const modules = parseModules(opts.modules);

    const item = await commonAdd(endpoint, book.id, desc, () => ({
        name: opts.name as string,
        filter,
        ...(opts.displayCurrency ? { displayCurrency: opts.displayCurrency } : {}),
        ...(modules ? { modules } : {}),
    }));

    if (opts.json) printJson({ ok: true, filterView: item });
    else process.stdout.write(`added filter-view ${item.id}\n`);
    process.exit(0);
};

export const update = async (opts: FilterViewUpdateOpts) => {
    if (!opts.id) throw new Error("<name|id> is required");
    const endpoint = await createGithubEndpoint();
    const book = await resolveBook(endpoint, requireBook(opts.book));
    const items = await loadList(endpoint, book.id, desc);
    const targetId = resolveItemId(items, desc, opts.id);

    // Build the new BillFilter ahead of the (sync) mutator. Resolution of
    // category/tag names needs to load other meta lists asynchronously, so we
    // can't do it inside commonUpdate's mutator callback.
    const existing = items.find((v) => v.id === targetId);
    if (!existing) throw new Error(`filter-view "${opts.id}" not found`);
    const filter = await buildBillFilter(opts, endpoint, book.id, existing.filter);
    const modules = parseModules(opts.modules);

    const finalNext = await commonUpdate(endpoint, book.id, desc, targetId, (cur) => {
        const out: BillFilterView = {
            ...cur,
            ...(opts.name !== undefined ? { name: opts.name } : {}),
            filter,
        };
        if (opts.displayCurrency !== undefined) {
            if (opts.displayCurrency === "") delete out.displayCurrency;
            else out.displayCurrency = opts.displayCurrency;
        }
        if (modules !== undefined) {
            if (modules.length > 0) out.modules = modules;
            else delete out.modules;
        }
        return out;
    });

    if (opts.json) printJson({ ok: true, filterView: finalNext });
    else process.stdout.write(`updated filter-view ${finalNext.id}\n`);
    process.exit(0);
};

export const remove = async (opts: FilterViewDeleteOpts) => {
    if (!opts.id) throw new Error("<name|id> is required");
    requireYes(opts.yes, "filter-view");
    const endpoint = await createGithubEndpoint();
    const book = await resolveBook(endpoint, requireBook(opts.book));
    const items = await loadList(endpoint, book.id, desc);
    const targetId = resolveItemId(items, desc, opts.id);
    await commonDelete(endpoint, book.id, desc, targetId);

    if (opts.json) printJson({ ok: true, deleted: targetId });
    else process.stdout.write(`deleted filter-view ${targetId}\n`);
    process.exit(0);
};
