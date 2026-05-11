import Table from "cli-table3";

export type OutputFormat = "text" | "json";

export const printJson = (data: unknown) => {
    process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
};

export const printTable = (
    rows: Record<string, unknown>[],
    columns?: string[],
) => {
    if (rows.length === 0) {
        process.stdout.write("(no rows)\n");
        return;
    }
    const head = columns ?? Object.keys(rows[0]);
    const table = new Table({ head });
    for (const row of rows) {
        table.push(head.map((c) => formatCell(row[c])));
    }
    process.stdout.write(`${table.toString()}\n`);
};

const formatCell = (v: unknown): string => {
    if (v == null) return "";
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
};

export const printError = (
    err: unknown,
    format: OutputFormat = "text",
): never => {
    const message = err instanceof Error ? err.message : String(err);
    if (format === "json") {
        process.stderr.write(
            `${JSON.stringify({ error: { message } })}\n`,
        );
    } else {
        process.stderr.write(`error: ${message}\n`);
    }
    process.exit(1);
};
