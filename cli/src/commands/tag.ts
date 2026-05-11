import type { BillTag } from "@/ledger/type";
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

const desc: MetaCollectionDescriptor<BillTag> = {
    name: "tag",
    scope: "global",
    pluralPath: "tags",
    nameField: "name",
};

export type TagListOpts = { book?: string; json?: boolean };
export type TagGetOpts = { book?: string; id?: string; json?: boolean };
export type TagAddOpts = {
    book?: string;
    name?: string;
    preferCurrency?: string;
    json?: boolean;
};
export type TagUpdateOpts = {
    book?: string;
    id?: string;
    name?: string;
    preferCurrency?: string;
    json?: boolean;
};
export type TagDeleteOpts = {
    book?: string;
    id?: string;
    yes?: boolean;
    json?: boolean;
};

export const list = async (opts: TagListOpts) => {
    const endpoint = await createGithubEndpoint();
    const book = await resolveBook(endpoint, requireBook(opts.book));
    const items = await loadList(endpoint, book.id, desc);
    if (opts.json) {
        printJson(items);
        return;
    }
    printTable(
        items.map((t) => ({
            id: t.id,
            name: t.name,
            preferCurrency: t.preferCurrency ?? "",
        })),
        ["id", "name", "preferCurrency"],
    );
};

export const get = async (opts: TagGetOpts) => {
    if (!opts.id) throw new Error("<name|id> is required");
    const endpoint = await createGithubEndpoint();
    const book = await resolveBook(endpoint, requireBook(opts.book));
    const items = await loadList(endpoint, book.id, desc);
    const id = resolveItemId(items, desc, opts.id);
    const found = items.find((t) => t.id === id);
    if (!found) throw new Error(`tag "${opts.id}" not found`);
    if (opts.json) printJson(found);
    else process.stdout.write(`${JSON.stringify(found, null, 2)}\n`);
};

export const add = async (opts: TagAddOpts) => {
    if (!opts.name) throw new Error("--name <s> is required");
    const endpoint = await createGithubEndpoint();
    const book = await resolveBook(endpoint, requireBook(opts.book));

    const item = await commonAdd(endpoint, book.id, desc, () => ({
        name: opts.name as string,
        ...(opts.preferCurrency ? { preferCurrency: opts.preferCurrency } : {}),
    }));

    if (opts.json) printJson({ ok: true, tag: item });
    else process.stdout.write(`added tag ${item.id}\n`);
    process.exit(0);
};

export const update = async (opts: TagUpdateOpts) => {
    if (!opts.id) throw new Error("<name|id> is required");
    const endpoint = await createGithubEndpoint();
    const book = await resolveBook(endpoint, requireBook(opts.book));
    const items = await loadList(endpoint, book.id, desc);
    const targetId = resolveItemId(items, desc, opts.id);

    const next = await commonUpdate(endpoint, book.id, desc, targetId, (cur) => {
        const out: BillTag = {
            ...cur,
            ...(opts.name !== undefined ? { name: opts.name } : {}),
        };
        if (opts.preferCurrency !== undefined) {
            if (opts.preferCurrency === "") delete out.preferCurrency;
            else out.preferCurrency = opts.preferCurrency;
        }
        return out;
    });

    if (opts.json) printJson({ ok: true, tag: next });
    else process.stdout.write(`updated tag ${next.id}\n`);
    process.exit(0);
};

export const remove = async (opts: TagDeleteOpts) => {
    if (!opts.id) throw new Error("<name|id> is required");
    requireYes(opts.yes, "tag");
    const endpoint = await createGithubEndpoint();
    const book = await resolveBook(endpoint, requireBook(opts.book));
    const items = await loadList(endpoint, book.id, desc);
    const targetId = resolveItemId(items, desc, opts.id);
    await commonDelete(endpoint, book.id, desc, targetId);

    if (opts.json) printJson({ ok: true, deleted: targetId });
    else process.stdout.write(`deleted tag ${targetId}\n`);
    process.exit(0);
};
