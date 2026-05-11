// Debug command. Reads `__stashes` sublevel of a book's local LevelDB
// directly, no network. Exists primarily to verify the "writes go to local
// stash, sync only via explicit `cent-cli sync`" invariant in tests.

import { resolveBook } from "../runtime/book.ts";
import { createGithubEndpoint } from "../runtime/context.ts";
import { printJson, printTable } from "../runtime/output.ts";
import { BillIndexedDBStorage } from "../shims/storage.ts";

export type StashOptions = {
    book?: string;
    json?: boolean;
    show?: boolean;
};

export const stash = async (opts: StashOptions) => {
    if (!opts.book) throw new Error("--book <name|id> is required");

    let bookId: string;
    if (opts.book.includes("/")) {
        // Full owner/repo form — read LevelDB directly, no endpoint init.
        bookId = opts.book;
    } else {
        const endpoint = await createGithubEndpoint();
        const book = await resolveBook(endpoint, opts.book);
        bookId = book.id;
    }

    const storage = new BillIndexedDBStorage(`book-${bookId}`);
    const stashStorage = storage.createArrayableStorage<any>("__stashes");
    const entries = await stashStorage.toArray();

    if (opts.json) {
        printJson({
            book: bookId,
            count: entries.length,
            ...(opts.show ? { entries } : {}),
        });
        return;
    }

    if (opts.show) {
        printTable(
            entries.map((e: any) => ({
                id: e.id,
                type: e.type,
                timestamp: e.timestamp
                    ? new Date(e.timestamp).toISOString()
                    : "",
                value:
                    typeof e.value === "string"
                        ? e.value
                        : (e.value?.id ?? ""),
            })),
            ["id", "type", "timestamp", "value"],
        );
        return;
    }

    process.stdout.write(
        `${entries.length} pending stash entries for ${bookId}\n`,
    );
};
