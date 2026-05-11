// Import bills + meta from a Cent JSON backup.
//
// Two-stage UX (mirrors the `delete --yes` gate elsewhere in CLI):
// - Without `--yes`: parse + run preview math + print stats; never writes.
// - With `--yes`:    perform `endpoint.batch(...)` then `process.exit(0)` to
//                    kill the implicit scheduler.schedule() so sync stays
//                    explicit (same convention as add/update/delete).
//
// Only plain JSON backups are accepted. Zip backups are explicitly rejected
// because attachment ingestion is not in scope for the CLI; users should
// either export the underlying JSON or use the web app for zip imports.
//
// Behaviour mirrors src/components/data-manager/{preview.tsx,preview-form.tsx}
// minus the React store coupling — we replicate the pure parts inline.

import { readFileSync } from "node:fs";
import { cloneDeep, isEqual, merge as deepMerge } from "lodash-es";
import type { Full, MetaUpdate, Update } from "@/database/stash";
import { BillCategories } from "@/ledger/category";
import type { Bill, ExportedJSON, GlobalMeta } from "@/ledger/type";
import { appendCategories } from "@/ledger/utils";
import { resolveBook } from "../runtime/book.ts";
import { getCurrentUser } from "../runtime/config.ts";
import { createGithubEndpoint } from "../runtime/context.ts";
import { printJson } from "../runtime/output.ts";

export type ImportOptions = {
    file?: string;
    book?: string;
    strategy?: "append" | "overlap";
    asMine?: boolean;
    yes?: boolean;
    json?: boolean;
};

export const importBills = async (opts: ImportOptions) => {
    if (!opts.file) throw new Error("<file> argument is required");
    if (!opts.book) throw new Error("--book <name|id> is required");

    const strategy: "append" | "overlap" = opts.strategy ?? "append";
    if (strategy !== "append" && strategy !== "overlap") {
        throw new Error(
            `--strategy must be "append" or "overlap" (got "${opts.strategy}")`,
        );
    }
    const asMine = opts.asMine ?? true;

    const data = readBackup(opts.file);

    const user = getCurrentUser();
    if (asMine && !user) {
        throw new Error(
            "no logged-in user — run `cent-cli login <github|gitee|webdav> ...` first (or pass --no-as-mine)",
        );
    }

    const endpoint = await createGithubEndpoint();
    const book = await resolveBook(endpoint, opts.book);

    // Refresh local cache so the append-skip math sees up-to-date existing bills.
    await endpoint.initBook(book.id);
    await syncOnce(endpoint);
    const existing: Full<Bill>[] = await endpoint.getAllItems(book.id);

    // Strategy: which incoming bills survive?
    const incoming = data.items ?? [];
    const available =
        strategy === "append"
            ? incoming.filter((b) =>
                  // Same `every(...)` semantics as Web preview.tsx:
                  // an incoming bill is dropped when *any* existing bill has
                  // matching id OR matching time.
                  existing.every(
                      (e) => e.id !== b.id && e.time !== b.time,
                  ),
              )
            : [...incoming];

    const skippedCount = incoming.length - available.length;

    // Meta merge — replicates preview-form.tsx:26-55 verbatim.
    const currentMeta = cloneDeep(
        (await endpoint.getMeta(book.id)) ?? ({} as GlobalMeta),
    );
    const newMeta = computeNewMeta(currentMeta, data.meta, strategy);

    const metaDiff = computeMetaDiff(currentMeta, newMeta);

    if (!opts.yes) {
        const out = {
            dryRun: true,
            book: book.id,
            strategy,
            asMine,
            creator: asMine && user ? user.name : undefined,
            incomingCount: incoming.length,
            importCount: available.length,
            skippedCount,
            metaDiff,
        };
        if (opts.json) {
            printJson(out);
        } else {
            process.stdout.write(`book: ${book.id}\n`);
            process.stdout.write(`strategy: ${strategy}\n`);
            process.stdout.write(
                `as-mine: ${asMine}${
                    asMine && user ? ` (creator = ${user.name})` : ""
                }\n`,
            );
            process.stdout.write(`incoming items: ${incoming.length}\n`);
            process.stdout.write(`to import: ${available.length}\n`);
            if (strategy === "append") {
                process.stdout.write(
                    `to skip (id/time match): ${skippedCount}\n`,
                );
            }
            process.stdout.write(
                `meta: categories +${metaDiff.categories} / tags +${metaDiff.tags} / budgets +${metaDiff.budgets}\n`,
            );
            process.stdout.write("(run again with --yes to commit)\n");
        }
        return;
    }

    // Real write path.
    const mineId = user?.id;
    const actions: (Update<Bill> | MetaUpdate)[] = [
        ...available.map(
            (v) =>
                ({
                    id: v.id,
                    type: "update",
                    value: {
                        ...v,
                        creatorId: asMine && mineId ? mineId : v.creatorId,
                    } as Bill,
                    timestamp: v.__update_at,
                }) as Update<Bill>,
        ),
        { type: "meta", metaValue: newMeta } as MetaUpdate,
    ];

    await endpoint.batch(book.id, actions, strategy === "overlap");

    if (opts.json) {
        printJson({
            ok: true,
            book: book.id,
            strategy,
            asMine,
            imported: available.length,
            skipped: skippedCount,
            metaDiff,
        });
    } else {
        process.stdout.write(
            `imported ${available.length} items into ${book.id} (strategy=${strategy})\n`,
        );
    }

    // Same exit(0) trick as add.ts: kill the implicit scheduler.schedule()
    // sync that endpoint.batch starts. CLI contract: sync only via `cent-cli sync`.
    process.exit(0);
};

const readBackup = (file: string): ExportedJSON => {
    if (/\.zip$/i.test(file) || /\.cent\.zip$/i.test(file)) {
        throw new Error(
            "zip imports are not supported by CLI; export the underlying JSON or use the web app",
        );
    }

    let raw: string;
    if (file === "-") {
        raw = readFileSync(0, "utf8");
    } else {
        raw = readFileSync(file, "utf8");
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        throw new Error(
            `invalid JSON: ${e instanceof Error ? e.message : String(e)}`,
        );
    }
    if (!parsed || typeof parsed !== "object") {
        throw new Error("backup root must be an object with `items`");
    }
    const obj = parsed as Partial<ExportedJSON>;
    if (!Array.isArray(obj.items)) {
        throw new Error("backup `items` must be an array");
    }
    return {
        items: obj.items as Full<Bill>[],
        meta: (obj.meta ?? {}) as GlobalMeta,
    };
};

const computeNewMeta = (
    currentMeta: GlobalMeta,
    incomingMeta: GlobalMeta | undefined,
    strategy: "append" | "overlap",
): GlobalMeta => {
    if (strategy === "overlap") {
        return (incomingMeta ?? ({} as GlobalMeta)) as GlobalMeta;
    }
    if (!incomingMeta) {
        return currentMeta;
    }
    if (!incomingMeta.categories) {
        return deepMerge(currentMeta, incomingMeta);
    }
    const currentCategories =
        (currentMeta.categories?.length ?? 0) === 0
            ? BillCategories
            : (currentMeta.categories ?? BillCategories);
    const incomingCategories = [...(incomingMeta.categories ?? [])];
    const appended = cloneDeep(
        appendCategories(currentCategories, incomingCategories),
    );
    const merged: GlobalMeta = deepMerge(currentMeta, incomingMeta);
    if (isEqual(BillCategories, appended)) {
        merged.categories = undefined;
    } else {
        merged.categories = appended;
    }
    return merged;
};

const computeMetaDiff = (
    before: GlobalMeta,
    after: GlobalMeta,
): { categories: number; tags: number; budgets: number } => {
    const lenBefore = (k: keyof GlobalMeta) =>
        Array.isArray(before[k]) ? (before[k] as unknown[]).length : 0;
    const lenAfter = (k: keyof GlobalMeta) =>
        Array.isArray(after[k]) ? (after[k] as unknown[]).length : 0;
    return {
        categories: Math.max(
            0,
            lenAfter("categories") - lenBefore("categories"),
        ),
        tags: Math.max(0, lenAfter("tags") - lenBefore("tags")),
        budgets: Math.max(0, lenAfter("budgets") - lenBefore("budgets")),
    };
};

const syncOnce = (endpoint: {
    onSync: (cb: (p: Promise<void>) => void) => () => void;
    toSync: () => Promise<unknown>;
}) =>
    new Promise<void>((resolve, reject) => {
        const unsub = endpoint.onSync((running) => {
            running.then(
                () => {
                    unsub();
                    resolve();
                },
                (err) => {
                    unsub();
                    reject(err);
                },
            );
        });
        endpoint.toSync().catch(reject);
    });
