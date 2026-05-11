import { resolveBook } from "../runtime/book.ts";
import { createGithubEndpoint } from "../runtime/context.ts";
import { applyFilter } from "../runtime/filter.ts";
import { printJson, printTable } from "../runtime/output.ts";

export type SearchOptions = {
    book?: string;
    json?: boolean;
    limit?: number;
    query?: string;
};

export const search = async (opts: SearchOptions) => {
    if (!opts.book) {
        throw new Error("--book <name|id> is required");
    }
    const endpoint = await createGithubEndpoint();
    const book = await resolveBook(endpoint, opts.book);

    await endpoint.initBook(book.id);
    await syncOnce(endpoint);

    const items = await endpoint.getAllItems(book.id);
    const filtered = await applyFilter(items, opts.query, () =>
        endpoint.getMeta(book.id),
    );
    const limited = opts.limit ? filtered.slice(0, opts.limit) : filtered;

    if (opts.json) {
        printJson(limited);
        return;
    }

    const rows = limited.map((b: any) => ({
        id: b.id,
        time: b.time ? new Date(b.time).toISOString() : "",
        amount: b.amount,
        category: b.category ?? "",
        comment: b.comment ?? "",
    }));
    printTable(rows, ["id", "time", "amount", "category", "comment"]);
};

const syncOnce = (endpoint: {
    onSync: (cb: (p: Promise<void>) => void) => () => void;
    toSync: () => Promise<any>;
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
