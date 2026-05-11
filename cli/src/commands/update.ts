import { numberToAmount } from "@/ledger/bill";
import type { Bill, BillType } from "@/ledger/type";
import { resolveBook } from "../runtime/book.ts";
import { createGithubEndpoint } from "../runtime/context.ts";
import { resolveCategoryId, resolveTagId } from "../runtime/meta.ts";
import { printJson } from "../runtime/output.ts";

export type UpdateOptions = {
    book?: string;
    id?: string;
    amount?: string | number;
    type?: BillType;
    category?: string;
    comment?: string;
    time?: string;
    tag?: string[] | string;
    json?: boolean;
};

export const update = async (opts: UpdateOptions) => {
    if (!opts.book) throw new Error("--book <name|id> is required");
    if (!opts.id) throw new Error("<bill-id> is required");

    const endpoint = await createGithubEndpoint();
    const book = await resolveBook(endpoint, opts.book);

    await endpoint.initBook(book.id);
    const items = (await endpoint.getAllItems(book.id)) as Bill[];
    const existing = items.find((b) => b.id === opts.id);
    if (!existing) {
        throw new Error(`bill "${opts.id}" not found in book ${book.id}`);
    }

    const meta = await endpoint.getMeta(book.id);

    const next: Bill = { ...existing };

    if (opts.amount !== undefined && opts.amount !== "") {
        const num = Number(opts.amount);
        if (!Number.isFinite(num)) {
            throw new Error(
                `--amount must be a finite number (got "${opts.amount}")`,
            );
        }
        next.amount = numberToAmount(num);
    }
    if (opts.type !== undefined) {
        if (opts.type !== "expense" && opts.type !== "income") {
            throw new Error(
                `--type must be "expense" or "income" (got "${opts.type}")`,
            );
        }
        next.type = opts.type;
    }
    if (opts.category !== undefined) {
        next.categoryId = resolveCategoryId(meta, {
            name: opts.category,
            type: next.type,
        });
    }
    if (opts.comment !== undefined) {
        next.comment = opts.comment;
    }
    if (opts.time !== undefined) {
        const t = Date.parse(opts.time);
        if (Number.isNaN(t)) {
            throw new Error(`--time must be ISO-8601 (got "${opts.time}")`);
        }
        next.time = t;
    }
    if (opts.tag !== undefined) {
        const arr = Array.isArray(opts.tag) ? opts.tag : [opts.tag];
        const ids = arr
            .flatMap((s) => s.split(","))
            .map((s) => s.trim())
            .filter(Boolean)
            .map((s) => resolveTagId(meta, s));
        next.tagIds = ids;
    }

    await endpoint.batch(book.id, [{ type: "update", value: next }]);

    if (opts.json) {
        printJson({ ok: true, bill: next });
    } else {
        process.stdout.write(`updated ${next.id}\n`);
    }

    process.exit(0);
};
