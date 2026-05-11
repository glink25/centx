// Book repo-management commands.
//
// `book-create` is supported: every endpoint exposes a clean `createBook(name)`
// async API that does not touch the modal layer. `book-invite` and
// `book-delete` remain unsupported — invites are an authorization flow and
// deletion is irreversible, both better handled in the web/desktop UI.

import { createActiveEndpoint } from "../runtime/context.ts";
import { printJson } from "../runtime/output.ts";

const NOT_SUPPORTED_INVITE =
    "book invite is not supported in CLI — please open the Cent web app to invite collaborators";
const NOT_SUPPORTED_DELETE =
    "book delete is not supported in CLI — please open the Cent web app to delete the book";

export type BookActionOptions = {
    id?: string;
    json?: boolean;
};

export const bookInvite = async (_opts: BookActionOptions) => {
    throw new Error(NOT_SUPPORTED_INVITE);
};

export const bookDelete = async (_opts: BookActionOptions) => {
    throw new Error(NOT_SUPPORTED_DELETE);
};

export type BookCreateOptions = {
    name: string;
    json?: boolean;
};

export const bookCreate = async (opts: BookCreateOptions) => {
    const name = opts.name?.trim();
    if (!name) throw new Error("book-create <name> requires a non-empty name");
    const endpoint = await createActiveEndpoint();
    const book = await endpoint.createBook(name);
    if (opts.json) {
        printJson(book);
    } else {
        process.stdout.write(`created ${book.name}  id=${book.id}\n`);
        process.stdout.write(`(run: cent-cli sync --book ${book.id})\n`);
    }
    // Match the bill/meta write contract: hard-exit so any scheduler the
    // endpoint kicked off internally cannot keep the process alive or
    // perform an implicit sync.
    process.exit(0);
};
