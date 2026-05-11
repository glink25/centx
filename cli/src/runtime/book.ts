// Resolve a user-provided book identifier to a concrete endpoint book id.
// Accepts either a full id ("owner/cent-journal-foo") or a short name ("foo").
// Names are matched against the endpoint's book list, case-insensitive when
// no exact match exists.

export type BookRef = { id: string; name: string };

export const resolveBook = async (
    endpoint: { fetchAllBooks: () => Promise<BookRef[]> },
    input: string,
): Promise<BookRef> => {
    const books = await endpoint.fetchAllBooks();

    if (input.includes("/")) {
        const hit = books.find((b) => b.id === input);
        if (!hit) throw new Error(`book id not found: ${input}`);
        return hit;
    }

    const exact = books.filter((b) => b.name === input);
    if (exact.length === 1) return exact[0];
    if (exact.length > 1) {
        throw new Error(
            `multiple books named "${input}" — disambiguate with full id: ${exact
                .map((b) => b.id)
                .join(", ")}`,
        );
    }

    const ci = books.filter(
        (b) => b.name.toLowerCase() === input.toLowerCase(),
    );
    if (ci.length === 1) return ci[0];
    if (ci.length > 1) {
        throw new Error(
            `multiple books match "${input}" (case-insensitive) — disambiguate with full id: ${ci
                .map((b) => b.id)
                .join(", ")}`,
        );
    }

    throw new Error(
        `book "${input}" not found — run \`cent-cli books\` to list available books`,
    );
};
