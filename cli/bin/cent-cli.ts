// Side-effect import — must run BEFORE any reused src/ module so that
// localStorage / indexedDB / window globals exist by then.
import "../src/shims/globals.ts";

import cac from "cac";
import { add } from "../src/commands/add.ts";
import { analyze } from "../src/commands/analyze.ts";
import { bookCreate, bookDelete, bookInvite } from "../src/commands/book.ts";
import { listBooks } from "../src/commands/books.ts";
import * as budget from "../src/commands/budget.ts";
import * as category from "../src/commands/category.ts";
import { deleteBill } from "../src/commands/delete.ts";
import * as filterView from "../src/commands/filter-view.ts";
import { importBills } from "../src/commands/import.ts";
import { installSkill } from "../src/commands/install-skill.ts";
import { PROVIDER_NAMES, PROVIDERS } from "../src/commands/login/index.ts";
import { logout } from "../src/commands/logout.ts";
import { search } from "../src/commands/search.ts";
import { stash } from "../src/commands/stash.ts";
import { sync } from "../src/commands/sync.ts";
import * as tag from "../src/commands/tag.ts";
import * as tagGroup from "../src/commands/tag-group.ts";
import { update } from "../src/commands/update.ts";
import { wireDocs } from "../src/docs.ts";
import { printError } from "../src/runtime/output.ts";

const cli = cac("cent-cli");

cli.option("--json", "output structured JSON");

// `login <provider>` registers the union of every provider's flags onto a
// single command (cac doesn't have per-subcommand flag scoping). Each
// provider's `parseOpts` enforces its own required fields. To add a new
// endpoint, drop a file under `src/commands/login/` and register it in
// `src/commands/login/index.ts` — no edits to this file required.
{
    const loginCmd = cli.command(
        "login <provider>",
        `log in to an endpoint (one of: ${PROVIDER_NAMES.join(" | ")})`,
    );
    for (const p of Object.values(PROVIDERS)) {
        p.registerFlags(loginCmd);
    }
    loginCmd.action(async (provider: string, opts: Record<string, unknown>) => {
        const json = opts.json === true;
        try {
            const p = PROVIDERS[provider];
            if (!p) {
                throw new Error(
                    `provider "${provider}" not supported — choose one of: ${PROVIDER_NAMES.join(", ")}`,
                );
            }
            const parsed = p.parseOpts(opts);
            await p.run({ ...parsed, json });
        } catch (e) {
            printError(e, json ? "json" : "text");
        }
    });
}

cli.command("logout", "clear stored credentials").action(async (opts) => {
    try {
        await logout({ json: opts.json });
    } catch (e) {
        printError(e, opts.json ? "json" : "text");
    }
});

cli.command("books", "list all books on the active endpoint").action(async (opts) => {
    try {
        await listBooks({ json: opts.json });
    } catch (e) {
        printError(e, opts.json ? "json" : "text");
    }
});

cli
    .command("search", "list bills in a book")
    .option("--book <name|id>", "book short name or full id (owner/repo)")
    .option("--limit <n>", "limit number of rows", { type: [Number] })
    .option(
        "-q, --query <q>",
        'filter query (Lucene-like, e.g. "category:food amount:>50")',
    )
    .action(async (opts) => {
        try {
            await search({
                book: opts.book,
                json: opts.json,
                limit: Array.isArray(opts.limit) ? opts.limit[0] : opts.limit,
                query: opts.query,
            });
        } catch (e) {
            printError(e, opts.json ? "json" : "text");
        }
    });

cli
    .command("sync", "pull a book and refresh local cache")
    .option("--book <name|id>", "book short name or full id (owner/repo)")
    .action(async (opts) => {
        try {
            await sync({ book: opts.book, json: opts.json });
        } catch (e) {
            printError(e, opts.json ? "json" : "text");
        }
    });

cli
    .command("add", "record a new bill (writes local stash; run `sync` to push)")
    .option("--book <name|id>", "book short name or full id (owner/repo)")
    .option("--amount <n>", "amount in main unit (e.g. 12.50)")
    .option("--type <type>", "bill type: expense | income (default expense)")
    .option("--category <name|id>", "category name or id")
    .option("--comment <s>", "comment / note")
    .option("--time <iso>", "occurrence time, ISO-8601 (default now)")
    .option("--tag <name|id>", "tag (repeatable, also accepts comma-list)", {
        type: [String],
    })
    .action(async (opts) => {
        try {
            await add({
                book: opts.book,
                amount: opts.amount,
                type: opts.type,
                category: opts.category,
                comment: opts.comment,
                time: opts.time,
                tag: opts.tag,
                json: opts.json,
            });
        } catch (e) {
            printError(e, opts.json ? "json" : "text");
        }
    });

cli
    .command(
        "update <bill-id>",
        "update fields of an existing bill (writes local stash; run `sync` to push)",
    )
    .option("--book <name|id>", "book short name or full id (owner/repo)")
    .option("--amount <n>", "amount in main unit")
    .option("--type <type>", "bill type: expense | income")
    .option("--category <name|id>", "category name or id")
    .option("--comment <s>", "comment / note")
    .option("--time <iso>", "occurrence time, ISO-8601")
    .option("--tag <name|id>", "tag (repeatable; replaces existing tags)", {
        type: [String],
    })
    .action(async (id, opts) => {
        try {
            await update({
                book: opts.book,
                id,
                amount: opts.amount,
                type: opts.type,
                category: opts.category,
                comment: opts.comment,
                time: opts.time,
                tag: opts.tag,
                json: opts.json,
            });
        } catch (e) {
            printError(e, opts.json ? "json" : "text");
        }
    });

cli
    .command(
        "delete <bill-id>",
        "delete a bill (writes local stash; run `sync` to push)",
    )
    .option("--book <name|id>", "book short name or full id (owner/repo)")
    .option("--yes", "confirm deletion (required)")
    .action(async (id, opts) => {
        try {
            await deleteBill({
                book: opts.book,
                id,
                yes: Boolean(opts.yes),
                json: opts.json,
            });
        } catch (e) {
            printError(e, opts.json ? "json" : "text");
        }
    });

cli
    .command(
        "analyze",
        "summarize bills (totals + structure + day/week/month/year averages and comparisons)",
    )
    .option("--book <name|id>", "book short name or full id (owner/repo)")
    .option("--from <iso>", "range start (ISO-8601); pair with --to")
    .option("--to <iso>", "range end (ISO-8601); pair with --from")
    .option(
        "--unit <u>",
        "period unit: year|month|week|day (mutually exclusive with --from/--to)",
    )
    .option(
        "--ref <iso>",
        "reference time inside the period (default: now); only with --unit",
    )
    .option(
        "-q, --query <q>",
        'filter query (Lucene-like, e.g. "category:food amount:>50")',
    )
    .option(
        "--type <t>",
        "focus type for analysis comparisons: expense|income|balance (default expense)",
    )
    .option("--top <n>", "max items per structure list (default 10)")
    .action(async (opts) => {
        try {
            await analyze({
                book: opts.book,
                from: opts.from,
                to: opts.to,
                unit: opts.unit,
                ref: opts.ref,
                query: opts.query,
                type: opts.type,
                top: opts.top,
                json: opts.json,
            });
        } catch (e) {
            printError(e, opts.json ? "json" : "text");
        }
    });

cli
    .command(
        "import <file>",
        "import bills + meta from a JSON backup (dry-run unless --yes; pass `-` to read stdin)",
    )
    .option("--book <name|id>", "book short name or full id (owner/repo)")
    .option(
        "--strategy <s>",
        "append (default) | overlap (overlap replaces meta and clears local stash before write)",
    )
    .option(
        "--as-mine",
        "rewrite imported bills' creator to current user (default true)",
    )
    .option("--no-as-mine", "keep original creator ids from the backup")
    .option(
        "--yes",
        "actually commit (without it, only prints the preview)",
    )
    .action(async (file, opts) => {
        try {
            await importBills({
                file,
                book: opts.book,
                strategy: opts.strategy,
                asMine: opts.asMine,
                yes: Boolean(opts.yes),
                json: opts.json,
            });
        } catch (e) {
            printError(e, opts.json ? "json" : "text");
        }
    });

cli
    .command(
        "stash",
        "[debug] count pending local stash entries (writes not yet synced)",
    )
    .option("--book <name|id>", "book short name or full id (owner/repo)")
    .option("--show", "print each stash entry instead of just count")
    .action(async (opts) => {
        try {
            await stash({
                book: opts.book,
                json: opts.json,
                show: Boolean(opts.show),
            });
        } catch (e) {
            printError(e, opts.json ? "json" : "text");
        }
    });

cli
    .command("book-create <name>", "create a new book on the active endpoint")
    .action(async (name, opts) => {
        try {
            await bookCreate({ name, json: opts.json });
        } catch (e) {
            printError(e, opts.json ? "json" : "text");
        }
    });

cli
    .command(
        "book-invite [book-id]",
        "(not supported in CLI; please use the Cent web app)",
    )
    .action(async (id, opts) => {
        try {
            await bookInvite({ id, json: opts.json });
        } catch (e) {
            printError(e, opts.json ? "json" : "text");
        }
    });

cli
    .command(
        "book-delete [book-id]",
        "(not supported in CLI; please use the Cent web app)",
    )
    .action(async (id, opts) => {
        try {
            await bookDelete({ id, json: opts.json });
        } catch (e) {
            printError(e, opts.json ? "json" : "text");
        }
    });

// ──────────────────── meta CRUD ────────────────────
// Each entity is a single dispatcher command `<entity> <action> [id]`.
// (cac doesn't actually fire the action for true multi-word command names
// like `category list` when no positional/option follows — even though it
// pretends to register them — so we route action -> handler manually.)
//
// All five entity families share the same five actions: list / get / add /
// update / delete. Writes go through `endpoint.batch({type:"meta"})` and
// each handler hard-exits after the meta batch lands, preserving the
// "explicit-sync only" contract used by bill writes.

type Handlers = {
    list: (o: Record<string, unknown>) => Promise<unknown>;
    get: (o: Record<string, unknown>) => Promise<unknown>;
    add: (o: Record<string, unknown>) => Promise<unknown>;
    update: (o: Record<string, unknown>) => Promise<unknown>;
    remove: (o: Record<string, unknown>) => Promise<unknown>;
};

const dispatch = (entity: string, handlers: Handlers) =>
    async (action: string, id: string | undefined, opts: Record<string, unknown>) => {
        const json = opts.json === true;
        try {
            switch (action) {
                case "list":
                    if (id !== undefined)
                        throw new Error(`${entity} list takes no positional argument`);
                    await handlers.list(opts);
                    return;
                case "get":
                    if (!id) throw new Error(`${entity} get <name|id> requires a positional id`);
                    await handlers.get({ ...opts, id });
                    return;
                case "add":
                    if (id !== undefined)
                        throw new Error(
                            `${entity} add takes no positional argument (use flags)`,
                        );
                    await handlers.add(opts);
                    return;
                case "update":
                    if (!id) throw new Error(`${entity} update <name|id> requires a positional id`);
                    await handlers.update({ ...opts, id });
                    return;
                case "delete":
                    if (!id) throw new Error(`${entity} delete <name|id> requires a positional id`);
                    await handlers.remove({ ...opts, id, yes: Boolean(opts.yes) });
                    return;
                default:
                    throw new Error(
                        `unknown action "${action}" for ${entity} — expected list|get|add|update|delete`,
                    );
            }
        } catch (e) {
            printError(e, json ? "json" : "text");
        }
    };

// Common options — shared by every entity dispatcher.
const COMMON = (cmd: ReturnType<typeof cli.command>) =>
    cmd
        .option("--book <name|id>", "book short name or full id (owner/repo)")
        .option("--yes", "confirm destructive action (delete)");

// ─── category ───
COMMON(
    cli.command(
        "category <action> [id]",
        "category CRUD: list | get <id> | add | update <id> | delete <id>",
    ),
)
    .option("--name <s>", "display name (add/update)")
    .option("--type <t>", "expense | income (add/update)")
    .option("--parent <name|id>", 'parent category (update: pass "" to clear)')
    .option("--icon <s>", "icon class string")
    .option("--color <s>", "color (any CSS color)")
    .action(
        dispatch("category", {
            list: category.list as Handlers["list"],
            get: category.get as Handlers["get"],
            add: category.add as Handlers["add"],
            update: category.update as Handlers["update"],
            remove: category.remove as Handlers["remove"],
        }),
    );

// ─── tag ───
COMMON(
    cli.command(
        "tag <action> [id]",
        "tag CRUD: list | get <id> | add | update <id> | delete <id>",
    ),
)
    .option("--name <s>", "tag name (add/update)")
    .option("--prefer-currency <code>", 'preferred currency (update: pass "" to clear)')
    .action(
        dispatch("tag", {
            list: tag.list as Handlers["list"],
            get: tag.get as Handlers["get"],
            add: tag.add as Handlers["add"],
            update: tag.update as Handlers["update"],
            remove: tag.remove as Handlers["remove"],
        }),
    );

// ─── tag-group (personal-scoped) ───
COMMON(
    cli.command(
        "tag-group <action> [id]",
        "tag-group CRUD (current user's personal meta): list | get <id> | add | update <id> | delete <id>",
    ),
)
    .option("--name <s>", "group name (add/update)")
    .option("--color <s>", "group color (CSS)")
    .option("--single-select", "only one tag in this group selectable at a time")
    .option("--required", "force at least one selection")
    .option("--tags <name|id,...>", 'comma-separated tag list (update: "" clears)')
    .action(
        dispatch("tag-group", {
            list: tagGroup.list as Handlers["list"],
            get: tagGroup.get as Handlers["get"],
            add: tagGroup.add as Handlers["add"],
            update: tagGroup.update as Handlers["update"],
            remove: tagGroup.remove as Handlers["remove"],
        }),
    );

// ─── budget ───
COMMON(
    cli.command(
        "budget <action> [id]",
        "budget CRUD: list | get <id> | add | update <id> | delete <id>",
    ),
)
    .option("--title <s>", "budget title (add/update)")
    .option("--total <n>", "total budget per period in main unit")
    .option("--start <iso>", "start time, ISO-8601")
    .option("--end <iso>", 'end time, ISO-8601 (update: "" clears)')
    .option("--repeat-unit <u>", "day | week | month | year")
    .option("--repeat-value <n>", "repeat interval (e.g. 1 month)")
    .option("--joiners <ids>", "comma-separated user ids (string or numeric)")
    .option(
        "--category-budget <map>",
        'per-category caps: "name=amount,name=amount" (main unit; update: "" clears)',
    )
    .option("--only-tags <name|id,...>", 'comma-separated tag list (update: "" clears)')
    .option("--exclude-tags <name|id,...>", 'comma-separated tag list (update: "" clears)')
    .action(
        dispatch("budget", {
            list: budget.list as Handlers["list"],
            get: budget.get as Handlers["get"],
            add: budget.add as Handlers["add"],
            update: budget.update as Handlers["update"],
            remove: budget.remove as Handlers["remove"],
        }),
    );

// ─── filter-view (a.k.a. stat view) ───
COMMON(
    cli.command(
        "filter-view <action> [id]",
        "custom filter / stat view CRUD: list | get <id> | add | update <id> | delete <id>",
    ),
)
    .option("--name <s>", "view display name (add/update)")
    .option("--display-currency <code>", "currency to render totals in")
    .option(
        "--modules <m,...>",
        "module list: base-analysis,top-words,map,analysis,top-expense,top-income,widget-<id>",
    )
    .option("--comment <s>", "BillFilter.comment substring")
    .option("--recent <span>", "shorthand recent window: 7d / 3w / 12m / 1y")
    .option("--start <iso>", "BillFilter.start (ISO-8601)")
    .option("--end <iso>", "BillFilter.end (ISO-8601)")
    .option("--filter-type <t>", "BillFilter.type: expense | income")
    .option("--creators <ids>", "comma-separated creator ids")
    .option("--categories <name|id,...>", "comma-separated category names or ids")
    .option("--min-amount <n>", "BillFilter.minAmountNumber (main unit)")
    .option("--max-amount <n>", "BillFilter.maxAmountNumber (main unit)")
    .option("--assets", "BillFilter.assets")
    .option("--scheduled", "BillFilter.scheduled")
    .option("--tags <name|id,...>", "comma-separated tag names or ids")
    .option("--exclude-tags <name|id,...>", "comma-separated tag names or ids")
    .option("--base-currency <code>", "BillFilter.baseCurrency")
    .option("--currencies <codes>", "comma-separated currency codes")
    .action(
        dispatch("filter-view", {
            list: filterView.list as Handlers["list"],
            get: filterView.get as Handlers["get"],
            add: filterView.add as Handlers["add"],
            update: filterView.update as Handlers["update"],
            remove: filterView.remove as Handlers["remove"],
        }),
    );

// install-skill — copy the bundled SKILL.md into ~/.claude/skills/cent-cli/.
cli
    .command(
        "install-skill",
        "install the Cent CLI Claude skill into ~/.claude/skills/cent-cli/",
    )
    .option("--force", "overwrite an existing SKILL.md if present")
    .option("--print", "print the embedded skill markdown to stdout instead of writing")
    .option("--dir <path>", "explicit install directory (overrides default)")
    .action(async (opts) => {
        try {
            await installSkill({
                force: Boolean(opts.force),
                print: Boolean(opts.print),
                dir: opts.dir,
                json: opts.json,
            });
        } catch (e) {
            printError(e, opts.json ? "json" : "text");
        }
    });

// Apply per-command long-form descriptions and examples from src/docs.ts.
// `wireDocs` calls `cli.help(callback)` itself to inject a Description section
// into per-subcommand --help output, so we MUST NOT call `cli.help()` again
// here — a second call overwrites the callback and re-registers `-h --help`.
wireDocs(cli);
cli.version("0.0.1");

cli.parse();
