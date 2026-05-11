import { v4 as uuidv4 } from "uuid";
import { numberToAmount } from "@/ledger/bill";
import type { Bill, BillType } from "@/ledger/type";
import { resolveBook } from "../runtime/book.ts";
import { getCurrentUser } from "../runtime/config.ts";
import { createGithubEndpoint } from "../runtime/context.ts";
import { resolveCategoryId, resolveTagId } from "../runtime/meta.ts";
import { printJson } from "../runtime/output.ts";

export type AddOptions = {
    book?: string;
    amount?: string | number;
    type?: BillType;
    category?: string;
    comment?: string;
    time?: string;
    tag?: string[] | string;
    json?: boolean;
};

export const add = async (opts: AddOptions) => {
    if (!opts.book) throw new Error("--book <name|id> is required");
    if (opts.amount === undefined || opts.amount === "")
        throw new Error("--amount <number> is required");
    if (!opts.category) throw new Error("--category <name|id> is required");

    const num = Number(opts.amount);
    if (!Number.isFinite(num)) {
        throw new Error(
            `--amount must be a finite number (got "${opts.amount}")`,
        );
    }
    const amount = numberToAmount(num);

    const type: BillType = opts.type ?? "expense";
    if (type !== "expense" && type !== "income") {
        throw new Error(`--type must be "expense" or "income" (got "${type}")`);
    }

    const time = parseTime(opts.time);

    const user = getCurrentUser();
    if (!user) {
        throw new Error(
            "no logged-in user — run `cent-cli login <github|gitee|webdav> ...` first",
        );
    }

    const endpoint = await createGithubEndpoint();
    const book = await resolveBook(endpoint, opts.book);

    // Need book meta for category/tag resolution.
    await endpoint.initBook(book.id);
    const meta = await endpoint.getMeta(book.id);

    const categoryId = resolveCategoryId(meta, {
        name: opts.category,
        type,
    });
    const tagIds = normalizeTagInput(opts.tag).map((t) =>
        resolveTagId(meta, t),
    );

    const bill: Bill = {
        id: uuidv4(),
        type,
        categoryId,
        creatorId: user.id,
        amount,
        time,
        ...(opts.comment ? { comment: opts.comment } : {}),
        ...(tagIds.length > 0 ? { tagIds } : {}),
    };

    await endpoint.batch(book.id, [{ type: "update", value: bill }]);

    if (opts.json) {
        printJson({ ok: true, bill });
    } else {
        process.stdout.write(`added ${bill.id}\n`);
    }

    // The endpoint's `batch` schedules an immediate sync attempt internally.
    // CLI semantics dictate sync is only via `cent-cli sync`, so exit hard
    // and let the aborted in-flight sync's stash live on disk for next time.
    process.exit(0);
};

const parseTime = (input: string | undefined): number => {
    if (!input) return Date.now();
    const t = Date.parse(input);
    if (Number.isNaN(t)) {
        throw new Error(`--time must be ISO-8601 parseable (got "${input}")`);
    }
    return t;
};

const normalizeTagInput = (input: string[] | string | undefined): string[] => {
    if (!input) return [];
    const arr = Array.isArray(input) ? input : [input];
    // also support comma-separated single value: --tag a,b
    return arr
        .flatMap((s) => s.split(","))
        .map((s) => s.trim())
        .filter(Boolean);
};
