// Per-command long-form documentation. Single source of truth for `cli --help`
// long descriptions and example sections. Same prose is referenced by the
// committed SKILL.md (under `cli/skill/cent-cli/`); when that document changes,
// keep this file consistent so AI consumers (Skill / future MCP) and human
// CLI users see the same contract.
//
// Cross-cutting concepts (filter-query DSL, import JSON schema, the
// "explicit-sync" contract) live in SKILL.md so we don't repeat 200 lines per
// command — the per-command `description` here points there.

import type { CAC, Command } from "cac";

export type CommandDoc = {
    /** matches `cli.command(name, ...)` registration verbatim */
    name: string;
    description: string;
    examples?: string[];
};

const SKILL_REF = "see cli/skill/cent-cli/SKILL.md for the full reference";

export const COMMAND_DOCS: CommandDoc[] = [
    // ─────────────────────── auth ───────────────────────
    {
        name: "login <provider>",
        description: [
            "Log in to a Cent sync endpoint. CLI never opens a browser; you must",
            "supply already-issued credentials via flags.",
            "",
            "Providers and required flags:",
            "  github   --token <PAT>            (scopes: repo)",
            "  gitee    --token <PAT>            (scopes: projects)",
            "  webdav   --url <U> --username <U> --password <P>",
            "           [--proxy <U>] [--custom-user <name>]",
            "",
            "On success the credentials are written to ~/.cent-cli/local-storage.json",
            "(same file/keys as Cent Web's localStorage), and SYNC_ENDPOINT is set so",
            "subsequent commands route to this provider until you `logout` or",
            "`login` again with a different provider.",
        ].join("\n"),
        examples: [
            "cent-cli login github --token ghp_xxxxxxxxxxxxxxxxxxxx",
            "cent-cli login gitee  --token gxxx",
            'cent-cli login webdav --url https://dav.jianguoyun.com/dav/ --username me@x.com --password "<APP_PWD>" --custom-user mac',
        ],
    },
    {
        name: "logout",
        description:
            "Clear all stored credentials (github / gitee / webdav) and the cached current user.",
    },

    // ─────────────────────── books ───────────────────────
    {
        name: "books",
        description:
            "List all books visible on the active endpoint. Default output is a table; pass --json for structured output (id, name).",
        examples: ["cent-cli books", "cent-cli books --json"],
    },
    {
        name: "book-create <name>",
        description: [
            "Create a new book on the active endpoint. For GitHub/Gitee this creates",
            "the underlying repo; for WebDAV it creates the directory layout.",
            "Returns { id, name } as JSON when --json is passed.",
        ].join("\n"),
        examples: ["cent-cli book-create my-journal --json"],
    },
    {
        name: "book-invite [book-id]",
        description: [
            "Not supported in CLI. Inviting collaborators requires interactive",
            "authorization flows that aren't safe to automate from the command line.",
            "Use the Cent web app to share a book.",
        ].join("\n"),
    },
    {
        name: "book-delete [book-id]",
        description: [
            "Not supported in CLI. Deleting a book is irreversible and (for GitHub/Gitee)",
            "destroys the underlying repository — kept gated to the web app on purpose.",
        ].join("\n"),
    },

    // ─────────────────────── bills: read ───────────────────────
    {
        name: "search",
        description: [
            "List bills in a book. Optionally filter with -q using the Cent filter-query",
            "DSL (Lucene-like). Default output is a table; pass --json for full bill objects.",
            "",
            "Filter-query quick reference (see SKILL.md for the full DSL):",
            "  Fields:    type / category / tag / creator / currency / amount / time /",
            '             recent / has / comment    (no field name = "comment" substring)',
            "  Compare:   amount:>100  amount:[50 TO 200]  time:>=2026-01-01",
            "  Boolean:   AND  OR  NOT (also && || ! and `-` prefix); parens for grouping",
            "  Recent:    recent:7d / 3w / 6M / 1y     (M = month, m = minute)",
            "  Names ↔ ids: category/tag/creator names auto-resolve; ids work too",
            "",
            "Sync: `search` first refreshes the local cache (incremental via tidal).",
            "Run `cent-cli sync` ahead of time to amortize that cost across calls.",
        ].join("\n"),
        examples: [
            'cent-cli search --book mybook -q "category:餐饮 amount:>=50"',
            'cent-cli search --book mybook -q "recent:7d type:expense" --json',
            'cent-cli search --book mybook -q "(tag:旅行 OR tag:出差) AND -has:scheduled"',
            'cent-cli search --book mybook -q "amount:[100 TO 500] AND time:[2026-01-01 TO 2026-04-01]"',
            "cent-cli search --book mybook --limit 20 --json",
        ],
    },
    {
        name: "sync",
        description: [
            "Pull a book and refresh the local LevelDB cache (~/.cent-cli/cache/<book>/).",
            "Incremental — uses tidal to fetch only changed chunks. Run after writes",
            "(add / update / delete / import / meta CRUD) to push your local stash to",
            "the remote: per the project's contract those commands stash locally and",
            "ONLY `cent-cli sync` actually pushes.",
        ].join("\n"),
        examples: ["cent-cli sync --book mybook", "cent-cli sync --book mybook --json"],
    },
    {
        name: "stash",
        description: [
            "[debug] Inspect pending local stash entries (writes not yet synced) for a",
            "book. By default prints a count; pass --show to dump each entry. Useful",
            "for verifying the 'writes are local until sync' invariant.",
        ].join("\n"),
        examples: [
            "cent-cli stash --book mybook",
            "cent-cli stash --book mybook --show --json",
        ],
    },

    // ─────────────────────── bills: write ───────────────────────
    {
        name: "add",
        description: [
            "Record a new bill. Writes to the local stash only — run `cent-cli sync`",
            "afterwards to push to the remote (commit/push split, like git).",
            "",
            "Required flags:  --book  --amount  --category",
            "Optional flags:  --type (expense|income, default expense)  --comment",
            "                 --time (ISO-8601, default now)  --tag (repeatable or",
            "                 comma-separated; tags must already exist in book meta)",
            "",
            "Amount is given in the main unit (e.g. 12.50). Internally Cent stores",
            "amounts as 10000:1 integers, but every CLI flag accepts the human form.",
            "",
            "Category resolution: --category accepts a name OR an id. Names are",
            "matched against (a) user-defined categories in book meta and (b) Cent's",
            "built-in defaults (translated to the active locale). For ambiguous names",
            "(same name in expense AND income), pass --type to disambiguate or supply",
            "a category id.",
        ].join("\n"),
        examples: [
            'cent-cli add --book mybook --amount 12.50 --category 餐饮 --comment "lunch"',
            "cent-cli add --book mybook --amount 30 --category 交通 --tag 差旅,打车",
            "cent-cli add --book mybook --amount 8000 --category Salary --type income --time 2026-05-01T09:00:00Z",
        ],
    },
    {
        name: "update <bill-id>",
        description: [
            "Update fields of an existing bill by id. Only the flags you pass are",
            "changed — other fields are preserved. Writes to local stash; run",
            "`cent-cli sync` to push.",
            "",
            "--tag, when given, REPLACES the bill's tag list (no merge). To clear",
            "tags entirely, pass --tag '' once. Other flags accept the same forms",
            "as `add` (names or ids; ISO-8601 time; main-unit amount).",
        ].join("\n"),
        examples: [
            "cent-cli update <bill-id> --book mybook --amount 15",
            'cent-cli update <bill-id> --book mybook --comment "team dinner" --tag 团建',
        ],
    },
    {
        name: "delete <bill-id>",
        description: [
            "Delete a bill by id. Requires --yes; without it the command refuses to",
            "run (CLI is non-interactive — no confirmation prompt). Writes the",
            "delete-tombstone to local stash; `cent-cli sync` to push.",
        ].join("\n"),
        examples: ["cent-cli delete <bill-id> --book mybook --yes"],
    },

    // ─────────────────────── analyze ───────────────────────
    {
        name: "analyze",
        description: [
            "Summarize bills over a time range: totals, expense/income/tag/user",
            "structure, day/week/month/year averages, period-over-period growth",
            "(vs previous period and vs last year), and a couple of natural-language",
            "descriptions ready for AI consumption.",
            "",
            "Time range is REQUIRED — pass either:",
            "  --from <iso> --to <iso>           // custom range",
            "  --unit <year|month|week|day> [--ref <iso>]   // period containing ref",
            "                                                (default ref = now)",
            "Passing both, neither, or only one of --from/--to is an error.",
            "",
            "Optional:",
            "  -q <filter-query>   pre-filter bills before aggregation (same DSL as `search`)",
            "  --type <t>          focus type for averages/comparisons:",
            "                      expense (default) | income | balance",
            "  --top <n>           cap items per structure list (default 10)",
            "",
            "JSON shape (--json): { range, total, structure: {expense, income, subCategory,",
            "tag, user}, trend, top: {expense, income}, analysis: {current, projected,",
            "previous, lastYear, growthVsPrevious, growthVsLastYear}, descriptions }",
        ].join("\n"),
        examples: [
            "cent-cli analyze --book mybook --unit month",
            "cent-cli analyze --book mybook --unit year --type income --json",
            "cent-cli analyze --book mybook --from 2026-01-01 --to 2026-04-01 -q 'category:餐饮'",
            "cent-cli analyze --book mybook --unit week --top 5 --ref 2026-04-15",
        ],
    },

    // ─────────────────────── import ───────────────────────
    {
        name: "import <file>",
        description: [
            "Import bills + meta from a Cent JSON backup. Default is DRY-RUN (just",
            "prints a preview); add --yes to actually commit. Pass `-` as <file>",
            "to read JSON from stdin.",
            "",
            "Only plain JSON backups are accepted. .zip / .cent.zip backups are",
            "rejected (they include attachments which CLI does not handle — export",
            "the underlying JSON or use the web app for zip imports).",
            "",
            "JSON schema (top-level): { items: Bill[], meta: GlobalMeta }",
            "",
            "  Bill = {",
            "      id:        string                       // unique bill id",
            '      type:      "expense" | "income"',
            "      categoryId: string                       // matches a BillCategory.id",
            "                                               // in meta.categories or built-ins",
            "      creatorId: number | string               // can be rewritten via --as-mine",
            "      amount:    number                        // 10000:1 integer (so 12.50 = 125000)",
            "      time:      number                        // unix ms",
            "      comment?:  string",
            "      tagIds?:   string[]                      // each id must exist in meta.tags",
            "      currency?: { base, target, amount }      // multi-currency record",
            "      images?:   (string | File)[]             // base64 / URL / asset path; passed through verbatim",
            "      location?: { latitude, longitude, accuracy }",
            '      extra?:    { scheduledId?: string }      // present for "scheduled" bills',
            "  }",
            "  GlobalMeta = {",
            "      categories?: BillCategory[]              // user-customized categories;",
            "                                                // entries with customName=true override",
            "                                                // built-in defaults",
            "      tags:        BillTag[]                   // { id, name, preferCurrency? }",
            "      budgets?:    Budget[]",
            "      customFilters?: BillFilterView[]",
            "      personal?:   Record<userId, PersonalMeta>// per-user (tag-groups etc.)",
            "      baseCurrency?: string",
            "      ... (other web-side optional fields preserved as-is)",
            "  }",
            "",
            "Strategies:",
            "  --strategy append   (default) Skip incoming bills already present by",
            "                      matching id OR matching time. Meta is deep-merged",
            "                      with the existing meta; new categories are appended.",
            "  --strategy overlap  Take incoming bills as-is, REPLACE meta entirely,",
            "                      and clear local stash before writing. Destructive —",
            "                      use only when migrating an entire book.",
            "",
            "as-mine rewrite:",
            "  --as-mine     (default) Each imported bill's creatorId is rewritten to",
            "                the currently logged-in user's id.",
            "  --no-as-mine  Preserve original creatorIds. Note: bills authored by",
            "                users not on the book may show as `user-<id>` in analyze.",
            "",
            "Two-stage UX:",
            "  Without --yes:  preview only — prints incomingCount / importCount /",
            "                  skippedCount / metaDiff. Zero writes. Use this first.",
            "  With --yes:     performs endpoint.batch(...). Local stash gets the",
            "                  changes; run `cent-cli sync` afterwards to push.",
        ].join("\n"),
        examples: [
            "cent-cli import backup.json --book mybook            # preview only",
            "cent-cli import backup.json --book mybook --yes      # commit",
            "cent-cli import backup.json --book mybook --strategy overlap --yes",
            "cent-cli import backup.json --book mybook --no-as-mine --json",
            "cat backup.json | cent-cli import - --book mybook",
        ],
    },

    // ─────────────────────── meta CRUD ───────────────────────
    {
        name: "category <action> [id]",
        description: [
            "User-defined category CRUD. <action> = list | get <id> | add | update <id> | delete <id>.",
            "",
            "CLI category writes only operate on user-defined categories (customName=true).",
            "Built-in default categories are read-only — to override one, `add` a new",
            "category with the same name; the user-defined entry takes precedence.",
            "",
            "Add/update flags:  --name  --type expense|income  --parent <name|id>  --icon  --color",
            "                   (on update, pass --parent '' to clear)",
            "",
            "Delete refuses if it would leave the book without at least one expense AND",
            "one income category (matches the web `validateCategories` rule).",
            "",
            "All meta writes use the same explicit-sync contract: changes hit local",
            "stash, then `cent-cli sync` pushes them.",
        ].join("\n"),
        examples: [
            "cent-cli category list --book mybook --json",
            "cent-cli category add --book mybook --name 旅行支出 --type expense",
            "cent-cli category update 旅行支出 --book mybook --color '#ff8800'",
            "cent-cli category delete 旅行支出 --book mybook --yes",
        ],
    },
    {
        name: "tag <action> [id]",
        description: [
            "Tag CRUD. <action> = list | get <id> | add | update <id> | delete <id>.",
            "",
            "Add/update flags:  --name  --prefer-currency <code>",
            "(on update, pass --prefer-currency '' to clear)",
            "",
            "Note: `add --tag` on bills will REJECT unknown tag names — bills don't",
            "auto-create tags. Create tags here first, then reference them in bills.",
        ].join("\n"),
        examples: [
            "cent-cli tag list --book mybook",
            "cent-cli tag add --book mybook --name 差旅",
            "cent-cli tag delete 差旅 --book mybook --yes",
        ],
    },
    {
        name: "tag-group <action> [id]",
        description: [
            "Tag-group CRUD (per-user / personal scope). <action> = list | get | add | update | delete.",
            "",
            "Tag groups are stored under the current user's slot in meta.personal,",
            "so they're scoped to the logged-in user. Other collaborators on the same",
            "book have their own independent tag groups.",
            "",
            "Add/update flags:  --name  --color  --single-select  --required",
            "                   --tags <name|id,...>   (replaces the group's tags;",
            "                                           pass '' to clear)",
        ].join("\n"),
        examples: [
            "cent-cli tag-group list --book mybook",
            "cent-cli tag-group add --book mybook --name 出行 --tags 差旅,打车 --single-select",
        ],
    },
    {
        name: "budget <action> [id]",
        description: [
            "Budget CRUD. <action> = list | get | add | update | delete.",
            "",
            "Add/update flags:",
            "  --title <s>                 budget display title",
            "  --total <n>                 total per period in the main unit (e.g. 1000)",
            "  --start <iso>               start time",
            "  --end <iso>                 end time (pass '' on update to clear)",
            "  --repeat-unit <u>           day | week | month | year",
            "  --repeat-value <n>          repeat interval (e.g. 1 month)",
            "  --joiners <ids>             comma-separated user ids (string or numeric)",
            '  --category-budget <map>     per-category caps: "name=amount,name=amount"',
            "                              (main unit; on update pass '' to clear)",
            "  --only-tags <name|id,...>   restrict to bills having these tags",
            "  --exclude-tags <name|id,...> exclude bills having these tags",
        ].join("\n"),
        examples: [
            "cent-cli budget add --book mybook --title 月度餐饮 --total 1000 \\",
            "    --start 2026-01-01 --repeat-unit month --repeat-value 1 \\",
            "    --category-budget 餐饮=600,零食=200",
        ],
    },
    {
        name: "filter-view <action> [id]",
        description: [
            "Custom filter / stat view CRUD. <action> = list | get | add | update | delete.",
            "",
            "Filter views save a BillFilter shape plus rendering preferences for",
            "Cent's stat page. Most flags map 1:1 to BillFilter fields.",
            "",
            "Add/update flags:",
            "  --name <s>                       view display name",
            "  --display-currency <code>        currency totals are rendered in",
            "  --modules <m,...>                module list:",
            "                                   base-analysis,top-words,map,analysis,",
            "                                   top-expense,top-income,widget-<id>",
            "  --comment <s>                    BillFilter.comment substring",
            "  --recent <span>                  shorthand window: 7d / 3w / 12m / 1y",
            "                                   (mutually exclusive with --start/--end)",
            "  --start <iso> / --end <iso>      explicit absolute range",
            "  --filter-type <t>                expense | income",
            "  --creators <ids>                 comma-separated creator ids",
            "  --categories <name|id,...>",
            "  --min-amount <n> / --max-amount <n>  in the main unit",
            "  --assets / --scheduled           BillFilter.assets / .scheduled flags",
            "  --tags <name|id,...> / --exclude-tags <name|id,...>",
            "  --base-currency <code>",
            "  --currencies <codes>",
        ].join("\n"),
        examples: [
            "cent-cli filter-view add --book mybook --name 近30天支出 --recent 30d --filter-type expense",
            "cent-cli filter-view add --book mybook --name 旅行总览 --tags 旅行 --modules base-analysis,analysis,top-expense",
        ],
    },

    // ─────────────────────── meta-cli ───────────────────────
    {
        name: "install-skill",
        description: [
            "Install the Cent CLI Claude skill. Copies the bundled SKILL.md to",
            "~/.claude/skills/cent-cli/SKILL.md (or $CLAUDE_HOME/skills/cent-cli/",
            "if CLAUDE_HOME is set). Pass --print to print the skill content to",
            "stdout instead of writing.",
            "",
            "After install, Claude Code will pick up the skill on next launch and use",
            "`npx -y cent-cli@latest <command>` to invoke this CLI when relevant.",
        ].join("\n"),
        examples: [
            "npx -y cent-cli@latest install-skill",
            "cent-cli install-skill --force",
            "cent-cli install-skill --print > my-skill.md",
        ],
    },
];

const docMap = new Map<string, CommandDoc>(
    COMMAND_DOCS.map((d) => [d.name, d]),
);

/**
 * Apply long-form descriptions and examples to cac commands.
 * Looks up each command by its registered name (the first arg of `cli.command`).
 * Commands without a docs entry are left untouched.
 *
 * cac's default help renderer omits a "Description" section for subcommand
 * --help output, so we also install a global help callback that injects one
 * (sourced from the matched command's docs entry) right after the Usage line.
 */
export const wireDocs = (cli: CAC): void => {
    for (const cmd of cli.commands as Command[]) {
        const doc = docMap.get(cmd.rawName);
        if (!doc) continue;
        // The single-line description shown in the parent `cent-cli --help`
        // listing should stay short. Keep the original short text from
        // bin/cent-cli.ts there, and stash the long form on the command for
        // the help callback below.
        (cmd as unknown as { __longDescription?: string }).__longDescription =
            doc.description;
        for (const ex of doc.examples ?? []) {
            cmd.example(ex);
        }
    }

    // Inject a "Description" section into the per-subcommand --help output.
    type Section = { title?: string; body: string };
    const cliWithMatched = cli as CAC & { matchedCommand?: Command };
    cli.help((sections: Section[]) => {
        const matched = cliWithMatched.matchedCommand;
        if (!matched) return;
        const long = (matched as unknown as { __longDescription?: string })
            .__longDescription;
        if (!long) return;
        // cac sections layout: [name/version, Usage, (Commands?), Options,
        // (Examples?)]. Insert Description right after Usage (index 2) so the
        // header reads name → usage line → prose.
        sections.splice(2, 0, { title: "Description", body: long });
    });
};
