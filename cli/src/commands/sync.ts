import { resolveBook } from "../runtime/book.ts";
import { createGithubEndpoint } from "../runtime/context.ts";
import { printJson } from "../runtime/output.ts";

export type SyncOptions = {
    book?: string;
    json?: boolean;
};

export const sync = async (opts: SyncOptions) => {
    if (!opts.book) {
        throw new Error("--book <name|id> is required");
    }
    const endpoint = await createGithubEndpoint();
    const book = await resolveBook(endpoint, opts.book);

    const start = Date.now();
    await endpoint.initBook(book.id);
    await syncOnce(endpoint);
    const items = await endpoint.getAllItems(book.id);
    const elapsed = Date.now() - start;

    if (opts.json) {
        printJson({ book: book.id, items: items.length, elapsedMs: elapsed });
        return;
    }
    process.stdout.write(
        `synced ${book.id}: ${items.length} items (${elapsed}ms)\n`,
    );
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
