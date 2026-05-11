import { resolveBook } from "../runtime/book.ts";
import { createGithubEndpoint } from "../runtime/context.ts";
import { printJson } from "../runtime/output.ts";

export type DeleteOptions = {
    book?: string;
    id?: string;
    yes?: boolean;
    json?: boolean;
};

export const deleteBill = async (opts: DeleteOptions) => {
    if (!opts.book) throw new Error("--book <name|id> is required");
    if (!opts.id) throw new Error("<bill-id> is required");
    if (!opts.yes) {
        throw new Error(
            "destructive — pass --yes to confirm bill deletion (CLI is non-interactive)",
        );
    }

    const endpoint = await createGithubEndpoint();
    const book = await resolveBook(endpoint, opts.book);
    await endpoint.initBook(book.id);

    await endpoint.batch(book.id, [
        { type: "delete", value: opts.id } as any,
    ]);

    if (opts.json) {
        printJson({ ok: true, deleted: opts.id });
    } else {
        process.stdout.write(`deleted ${opts.id}\n`);
    }

    process.exit(0);
};
