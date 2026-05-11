import { createGithubEndpoint } from "../runtime/context.ts";
import { printJson, printTable } from "../runtime/output.ts";

export const listBooks = async (opts: { json?: boolean }) => {
    const endpoint = await createGithubEndpoint();
    const books = await endpoint.fetchAllBooks();
    if (opts.json) {
        printJson(books);
    } else {
        printTable(books, ["id", "name"]);
    }
};
