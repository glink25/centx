import type { BillTag, BillTagGroup } from "@/ledger/type";
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

const desc: MetaCollectionDescriptor<BillTagGroup> = {
    name: "tag-group",
    scope: "personal",
    pluralPath: "tagGroups",
    nameField: "name",
};

const tagDesc: MetaCollectionDescriptor<BillTag> = {
    name: "tag",
    scope: "global",
    pluralPath: "tags",
    nameField: "name",
};

const splitCsv = (input: string | undefined): string[] => {
    if (!input) return [];
    return input
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
};

const resolveTagIds = async (
    endpoint: Awaited<ReturnType<typeof createGithubEndpoint>>,
    bookId: string,
    raw: string | undefined,
): Promise<string[]> => {
    const names = splitCsv(raw);
    if (names.length === 0) return [];
    const tags = await loadList(endpoint, bookId, tagDesc);
    return names.map((n) => resolveItemId(tags, tagDesc, n));
};

export type TagGroupListOpts = { book?: string; json?: boolean };
export type TagGroupGetOpts = { book?: string; id?: string; json?: boolean };
export type TagGroupAddOpts = {
    book?: string;
    name?: string;
    color?: string;
    singleSelect?: boolean;
    required?: boolean;
    tags?: string;
    json?: boolean;
};
export type TagGroupUpdateOpts = TagGroupAddOpts & { id?: string };
export type TagGroupDeleteOpts = {
    book?: string;
    id?: string;
    yes?: boolean;
    json?: boolean;
};

export const list = async (opts: TagGroupListOpts) => {
    const endpoint = await createGithubEndpoint();
    const book = await resolveBook(endpoint, requireBook(opts.book));
    const items = await loadList(endpoint, book.id, desc);
    if (opts.json) {
        printJson(items);
        return;
    }
    printTable(
        items.map((g) => ({
            id: g.id,
            name: g.name,
            color: g.color,
            singleSelect: g.singleSelect ?? false,
            required: g.required ?? false,
            tagCount: g.tagIds?.length ?? 0,
        })),
        ["id", "name", "color", "singleSelect", "required", "tagCount"],
    );
};

export const get = async (opts: TagGroupGetOpts) => {
    if (!opts.id) throw new Error("<name|id> is required");
    const endpoint = await createGithubEndpoint();
    const book = await resolveBook(endpoint, requireBook(opts.book));
    const items = await loadList(endpoint, book.id, desc);
    const id = resolveItemId(items, desc, opts.id);
    const found = items.find((g) => g.id === id);
    if (!found) throw new Error(`tag-group "${opts.id}" not found`);
    if (opts.json) printJson(found);
    else process.stdout.write(`${JSON.stringify(found, null, 2)}\n`);
};

export const add = async (opts: TagGroupAddOpts) => {
    if (!opts.name) throw new Error("--name <s> is required");
    if (!opts.color) throw new Error("--color <css-color> is required");
    const endpoint = await createGithubEndpoint();
    const book = await resolveBook(endpoint, requireBook(opts.book));
    const tagIds = await resolveTagIds(endpoint, book.id, opts.tags);

    const item = await commonAdd(endpoint, book.id, desc, () => ({
        name: opts.name as string,
        color: opts.color as string,
        ...(opts.singleSelect ? { singleSelect: true } : {}),
        ...(opts.required ? { required: true } : {}),
        ...(tagIds.length > 0 ? { tagIds } : {}),
    }));

    if (opts.json) printJson({ ok: true, tagGroup: item });
    else process.stdout.write(`added tag-group ${item.id}\n`);
    process.exit(0);
};

export const update = async (opts: TagGroupUpdateOpts) => {
    if (!opts.id) throw new Error("<name|id> is required");
    const endpoint = await createGithubEndpoint();
    const book = await resolveBook(endpoint, requireBook(opts.book));
    const items = await loadList(endpoint, book.id, desc);
    const targetId = resolveItemId(items, desc, opts.id);

    const tagIdsExplicit = opts.tags !== undefined;
    const tagIds = tagIdsExplicit
        ? await resolveTagIds(endpoint, book.id, opts.tags)
        : undefined;

    const next = await commonUpdate(endpoint, book.id, desc, targetId, (cur) => {
        const out: BillTagGroup = {
            ...cur,
            ...(opts.name !== undefined ? { name: opts.name } : {}),
            ...(opts.color !== undefined ? { color: opts.color } : {}),
            ...(opts.singleSelect !== undefined
                ? { singleSelect: opts.singleSelect }
                : {}),
            ...(opts.required !== undefined ? { required: opts.required } : {}),
        };
        if (tagIdsExplicit) {
            if (tagIds && tagIds.length > 0) out.tagIds = tagIds;
            else delete out.tagIds;
        }
        return out;
    });

    if (opts.json) printJson({ ok: true, tagGroup: next });
    else process.stdout.write(`updated tag-group ${next.id}\n`);
    process.exit(0);
};

export const remove = async (opts: TagGroupDeleteOpts) => {
    if (!opts.id) throw new Error("<name|id> is required");
    requireYes(opts.yes, "tag-group");
    const endpoint = await createGithubEndpoint();
    const book = await resolveBook(endpoint, requireBook(opts.book));
    const items = await loadList(endpoint, book.id, desc);
    const targetId = resolveItemId(items, desc, opts.id);
    await commonDelete(endpoint, book.id, desc, targetId);

    if (opts.json) printJson({ ok: true, deleted: targetId });
    else process.stdout.write(`deleted tag-group ${targetId}\n`);
    process.exit(0);
};
