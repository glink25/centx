import { numberToAmount } from "@/ledger/bill";
import { BillCategories } from "@/ledger/category";
import type { BillCategory, BillTag, Budget } from "@/ledger/type";
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

const desc: MetaCollectionDescriptor<Budget> = {
    name: "budget",
    scope: "global",
    pluralPath: "budgets",
    nameField: "title",
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

type RepeatUnit = "day" | "week" | "month" | "year";
const isRepeatUnit = (s: string): s is RepeatUnit =>
    s === "day" || s === "week" || s === "month" || s === "year";

const splitCsv = (input: string | undefined): string[] => {
    if (!input) return [];
    return input
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
};

const parseIso = (input: string, label: string): number => {
    const t = Date.parse(input);
    if (Number.isNaN(t)) {
        throw new Error(`${label} must be ISO-8601 (got "${input}")`);
    }
    return t;
};

const parseFiniteNumber = (input: string | number, label: string): number => {
    const n = Number(input);
    if (!Number.isFinite(n)) {
        throw new Error(`${label} must be a finite number (got "${input}")`);
    }
    return n;
};

const parseCategoriesBudget = async (
    raw: string | undefined,
    endpoint: Awaited<ReturnType<typeof createGithubEndpoint>>,
    bookId: string,
): Promise<{ id: string; budget: number }[] | undefined> => {
    if (raw === undefined) return undefined;
    if (raw === "") return [];
    const cats = await loadList(endpoint, bookId, categoryDesc);
    return raw
        .split(",")
        .map((pair) => pair.trim())
        .filter(Boolean)
        .map((pair) => {
            const eq = pair.indexOf("=");
            if (eq === -1) {
                throw new Error(
                    `--category-budget entry "${pair}" must be of form name=amount`,
                );
            }
            const name = pair.slice(0, eq).trim();
            const amount = pair.slice(eq + 1).trim();
            return {
                id: resolveItemId(cats, categoryDesc, name),
                budget: numberToAmount(parseFiniteNumber(amount, "category budget amount")),
            };
        });
};

const resolveTagIds = async (
    endpoint: Awaited<ReturnType<typeof createGithubEndpoint>>,
    bookId: string,
    raw: string | undefined,
): Promise<string[] | undefined> => {
    if (raw === undefined) return undefined;
    if (raw === "") return [];
    const names = splitCsv(raw);
    if (names.length === 0) return [];
    const tags = await loadList(endpoint, bookId, tagDesc);
    return names.map((n) => resolveItemId(tags, tagDesc, n));
};

const parseJoiners = (raw: string | undefined): (string | number)[] | undefined => {
    if (raw === undefined) return undefined;
    return splitCsv(raw).map((s) => {
        const n = Number(s);
        return Number.isFinite(n) && /^-?\d+$/.test(s) ? n : s;
    });
};

export type BudgetListOpts = { book?: string; json?: boolean };
export type BudgetGetOpts = { book?: string; id?: string; json?: boolean };
export type BudgetAddOpts = {
    book?: string;
    title?: string;
    total?: string | number;
    start?: string;
    end?: string;
    repeatUnit?: string;
    repeatValue?: string | number;
    joiners?: string;
    categoryBudget?: string;
    onlyTags?: string;
    excludeTags?: string;
    json?: boolean;
};
export type BudgetUpdateOpts = BudgetAddOpts & { id?: string };
export type BudgetDeleteOpts = {
    book?: string;
    id?: string;
    yes?: boolean;
    json?: boolean;
};

export const list = async (opts: BudgetListOpts) => {
    const endpoint = await createGithubEndpoint();
    const book = await resolveBook(endpoint, requireBook(opts.book));
    const items = await loadList(endpoint, book.id, desc);
    if (opts.json) {
        printJson(items);
        return;
    }
    printTable(
        items.map((b) => ({
            id: b.id,
            title: b.title,
            total: b.totalBudget / 10000,
            repeat: `${b.repeat.value} ${b.repeat.unit}`,
            start: new Date(b.start).toISOString(),
            end: b.end ? new Date(b.end).toISOString() : "",
            joiners: b.joiners.length,
        })),
        ["id", "title", "total", "repeat", "start", "end", "joiners"],
    );
};

export const get = async (opts: BudgetGetOpts) => {
    if (!opts.id) throw new Error("<title|id> is required");
    const endpoint = await createGithubEndpoint();
    const book = await resolveBook(endpoint, requireBook(opts.book));
    const items = await loadList(endpoint, book.id, desc);
    const id = resolveItemId(items, desc, opts.id);
    const found = items.find((b) => b.id === id);
    if (!found) throw new Error(`budget "${opts.id}" not found`);
    if (opts.json) printJson(found);
    else process.stdout.write(`${JSON.stringify(found, null, 2)}\n`);
};

export const add = async (opts: BudgetAddOpts) => {
    if (!opts.title) throw new Error("--title <s> is required");
    if (opts.total === undefined || opts.total === "")
        throw new Error("--total <amount> is required (main unit)");
    if (!opts.start) throw new Error("--start <iso> is required");
    if (!opts.repeatUnit)
        throw new Error("--repeat-unit day|week|month|year is required");
    if (!isRepeatUnit(opts.repeatUnit)) {
        throw new Error(
            `--repeat-unit must be day|week|month|year (got "${opts.repeatUnit}")`,
        );
    }
    if (opts.repeatValue === undefined || opts.repeatValue === "")
        throw new Error("--repeat-value <n> is required");

    const endpoint = await createGithubEndpoint();
    const book = await resolveBook(endpoint, requireBook(opts.book));

    const categoriesBudget = await parseCategoriesBudget(
        opts.categoryBudget,
        endpoint,
        book.id,
    );
    const onlyTags = await resolveTagIds(endpoint, book.id, opts.onlyTags);
    const excludeTags = await resolveTagIds(endpoint, book.id, opts.excludeTags);

    const item = await commonAdd(endpoint, book.id, desc, () => ({
        title: opts.title as string,
        totalBudget: numberToAmount(parseFiniteNumber(opts.total as string | number, "--total")),
        start: parseIso(opts.start as string, "--start"),
        ...(opts.end ? { end: parseIso(opts.end, "--end") } : {}),
        repeat: {
            unit: opts.repeatUnit as RepeatUnit,
            value: parseFiniteNumber(
                opts.repeatValue as string | number,
                "--repeat-value",
            ),
        },
        joiners: parseJoiners(opts.joiners) ?? [],
        ...(categoriesBudget ? { categoriesBudget } : {}),
        ...(onlyTags && onlyTags.length > 0 ? { onlyTags } : {}),
        ...(excludeTags && excludeTags.length > 0 ? { excludeTags } : {}),
    }));

    if (opts.json) printJson({ ok: true, budget: item });
    else process.stdout.write(`added budget ${item.id}\n`);
    process.exit(0);
};

export const update = async (opts: BudgetUpdateOpts) => {
    if (!opts.id) throw new Error("<title|id> is required");
    if (opts.repeatUnit !== undefined && !isRepeatUnit(opts.repeatUnit)) {
        throw new Error(
            `--repeat-unit must be day|week|month|year (got "${opts.repeatUnit}")`,
        );
    }
    const endpoint = await createGithubEndpoint();
    const book = await resolveBook(endpoint, requireBook(opts.book));
    const items = await loadList(endpoint, book.id, desc);
    const targetId = resolveItemId(items, desc, opts.id);

    const categoriesBudget = await parseCategoriesBudget(
        opts.categoryBudget,
        endpoint,
        book.id,
    );
    const onlyTags = await resolveTagIds(endpoint, book.id, opts.onlyTags);
    const excludeTags = await resolveTagIds(endpoint, book.id, opts.excludeTags);
    const joiners = parseJoiners(opts.joiners);

    const next = await commonUpdate(endpoint, book.id, desc, targetId, (cur) => {
        const out: Budget = {
            ...cur,
            ...(opts.title !== undefined ? { title: opts.title } : {}),
            ...(opts.total !== undefined && opts.total !== ""
                ? { totalBudget: numberToAmount(parseFiniteNumber(opts.total, "--total")) }
                : {}),
            ...(opts.start !== undefined ? { start: parseIso(opts.start, "--start") } : {}),
            ...(joiners !== undefined ? { joiners } : {}),
            repeat: {
                unit: (opts.repeatUnit as RepeatUnit | undefined) ?? cur.repeat.unit,
                value:
                    opts.repeatValue !== undefined && opts.repeatValue !== ""
                        ? parseFiniteNumber(opts.repeatValue, "--repeat-value")
                        : cur.repeat.value,
            },
        };
        if (opts.end !== undefined) {
            if (opts.end === "") delete out.end;
            else out.end = parseIso(opts.end, "--end");
        }
        if (categoriesBudget !== undefined) {
            if (categoriesBudget.length > 0) out.categoriesBudget = categoriesBudget;
            else delete out.categoriesBudget;
        }
        if (onlyTags !== undefined) {
            if (onlyTags.length > 0) out.onlyTags = onlyTags;
            else delete out.onlyTags;
        }
        if (excludeTags !== undefined) {
            if (excludeTags.length > 0) out.excludeTags = excludeTags;
            else delete out.excludeTags;
        }
        return out;
    });

    if (opts.json) printJson({ ok: true, budget: next });
    else process.stdout.write(`updated budget ${next.id}\n`);
    process.exit(0);
};

export const remove = async (opts: BudgetDeleteOpts) => {
    if (!opts.id) throw new Error("<title|id> is required");
    requireYes(opts.yes, "budget");
    const endpoint = await createGithubEndpoint();
    const book = await resolveBook(endpoint, requireBook(opts.book));
    const items = await loadList(endpoint, book.id, desc);
    const targetId = resolveItemId(items, desc, opts.id);
    await commonDelete(endpoint, book.id, desc, targetId);

    if (opts.json) printJson({ ok: true, deleted: targetId });
    else process.stdout.write(`deleted budget ${targetId}\n`);
    process.exit(0);
};
