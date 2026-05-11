import { BillCategories } from "@/ledger/category";
import { t } from "@/locale";
import type { BillCategory, BillType } from "@/ledger/type";
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

const localized = (c: BillCategory): string =>
    c.customName ? c.name : t(c.name);

const desc: MetaCollectionDescriptor<BillCategory> = {
    name: "category",
    scope: "global",
    pluralPath: "categories",
    nameField: "name",
    defaults: BillCategories,
    localizeName: localized,
    validate: (next, action) => {
        // Only block destructive imbalance; add/update of one category alone
        // can never violate the invariant of "≥1 each".
        if (action !== "delete") return;
        const hasIncome = next.some((c) => c.type === "income");
        const hasExpense = next.some((c) => c.type === "expense");
        if (next.length > 0 && (!hasIncome || !hasExpense)) {
            throw new Error(
                "delete blocked: each bill type (income/expense) must keep at least one category",
            );
        }
    },
};

export type CategoryListOpts = { book?: string; json?: boolean };
export type CategoryGetOpts = { book?: string; id?: string; json?: boolean };
export type CategoryAddOpts = {
    book?: string;
    name?: string;
    type?: BillType;
    parent?: string;
    icon?: string;
    color?: string;
    json?: boolean;
};
export type CategoryUpdateOpts = {
    book?: string;
    id?: string;
    name?: string;
    type?: BillType;
    parent?: string;
    icon?: string;
    color?: string;
    json?: boolean;
};
export type CategoryDeleteOpts = {
    book?: string;
    id?: string;
    yes?: boolean;
    json?: boolean;
};

const ensureUserCategory = (
    items: BillCategory[],
    targetId: string,
): BillCategory => {
    const target = items.find((c) => c.id === targetId);
    if (!target) {
        throw new Error(
            `category "${targetId}" is a built-in default — CLI only modifies user-defined categories. Add a custom category first via \`category add\`.`,
        );
    }
    return target;
};

export const list = async (opts: CategoryListOpts) => {
    const endpoint = await createGithubEndpoint();
    const book = await resolveBook(endpoint, requireBook(opts.book));
    const items = await loadList(endpoint, book.id, desc);
    if (opts.json) {
        printJson(items);
        return;
    }
    printTable(
        items.map((c) => ({
            id: c.id,
            type: c.type,
            name: localized(c),
            parent: c.parent ?? "",
            customName: c.customName ?? false,
        })),
        ["id", "type", "name", "parent", "customName"],
    );
};

export const get = async (opts: CategoryGetOpts) => {
    if (!opts.id) throw new Error("<name|id> is required");
    const endpoint = await createGithubEndpoint();
    const book = await resolveBook(endpoint, requireBook(opts.book));
    const items = await loadList(endpoint, book.id, desc);
    const id = resolveItemId(items, desc, opts.id);
    const found = [...items, ...BillCategories].find((c) => c.id === id);
    if (!found) throw new Error(`category "${opts.id}" not found`);
    if (opts.json) printJson(found);
    else process.stdout.write(`${JSON.stringify(found, null, 2)}\n`);
};

export const add = async (opts: CategoryAddOpts) => {
    if (!opts.name) throw new Error("--name <s> is required");
    if (!opts.type) throw new Error("--type expense|income is required");
    if (opts.type !== "expense" && opts.type !== "income") {
        throw new Error(`--type must be expense|income (got "${opts.type}")`);
    }
    const endpoint = await createGithubEndpoint();
    const book = await resolveBook(endpoint, requireBook(opts.book));

    let parentId: string | undefined;
    if (opts.parent !== undefined && opts.parent !== "") {
        const items = await loadList(endpoint, book.id, desc);
        parentId = resolveItemId(items, desc, opts.parent);
    }

    const item = await commonAdd(endpoint, book.id, desc, () => ({
        type: opts.type as BillType,
        name: opts.name as string,
        icon: opts.icon ?? "",
        color: opts.color ?? "",
        customName: true,
        ...(parentId ? { parent: parentId } : {}),
    }));

    if (opts.json) printJson({ ok: true, category: item });
    else process.stdout.write(`added category ${item.id}\n`);
    process.exit(0);
};

export const update = async (opts: CategoryUpdateOpts) => {
    if (!opts.id) throw new Error("<name|id> is required");
    const endpoint = await createGithubEndpoint();
    const book = await resolveBook(endpoint, requireBook(opts.book));
    const items = await loadList(endpoint, book.id, desc);
    const targetId = resolveItemId(items, desc, opts.id);
    ensureUserCategory(items, targetId);

    let parentId: string | undefined;
    let parentExplicit = false;
    if (opts.parent !== undefined) {
        parentExplicit = true;
        if (opts.parent !== "") {
            parentId = resolveItemId(items, desc, opts.parent);
        }
    }

    if (opts.type !== undefined && opts.type !== "expense" && opts.type !== "income") {
        throw new Error(`--type must be expense|income (got "${opts.type}")`);
    }

    const next = await commonUpdate(endpoint, book.id, desc, targetId, (cur) => {
        const out: BillCategory = {
            ...cur,
            ...(opts.name !== undefined ? { name: opts.name } : {}),
            ...(opts.type !== undefined ? { type: opts.type as BillType } : {}),
            ...(opts.icon !== undefined ? { icon: opts.icon } : {}),
            ...(opts.color !== undefined ? { color: opts.color } : {}),
            customName: true,
        };
        if (parentExplicit) {
            if (parentId) out.parent = parentId;
            else delete out.parent;
        }
        return out;
    });

    if (opts.json) printJson({ ok: true, category: next });
    else process.stdout.write(`updated category ${next.id}\n`);
    process.exit(0);
};

export const remove = async (opts: CategoryDeleteOpts) => {
    if (!opts.id) throw new Error("<name|id> is required");
    requireYes(opts.yes, "category");
    const endpoint = await createGithubEndpoint();
    const book = await resolveBook(endpoint, requireBook(opts.book));
    const items = await loadList(endpoint, book.id, desc);
    const targetId = resolveItemId(items, desc, opts.id);
    ensureUserCategory(items, targetId);
    await commonDelete(endpoint, book.id, desc, targetId);

    if (opts.json) printJson({ ok: true, deleted: targetId });
    else process.stdout.write(`deleted category ${targetId}\n`);
    process.exit(0);
};
