---
name: cent-cli
description: Use Cent (a personal-finance ledger) from the command line — record bills, search & analyze spending, manage categories/tags/budgets, and import backups. Triggers on user requests about expenses, income, budgets, ledger queries, and spending analysis when a Cent account exists. All operations run via `npx -y cent-cli@latest <command>`; no separate install required.
---

# Cent CLI Skill

You can call **Cent CLI** to read and write the user's personal-finance ledger.
Cent is a sync-first ledger with multi-endpoint support (GitHub repo / Gitee / WebDAV).
The CLI is a non-interactive wrapper — every operation is one shell command, every
output supports `--json`, and writes go to a local stash that the user must push with
an explicit `cent-cli sync`.

## When to use this skill

Trigger when the user asks to:
- record a bill / expense / income (`add a 50 dollar lunch`, `记一笔餐费 30 块`)
- look up bills (`how much did I spend on food last week?`, `上个月吃饭花了多少`)
- analyze spending (`give me last month's spending breakdown`, `做一份月度分析`)
- manage categories / tags / budgets / saved filters
- import a backup file
- list books, sync state, or check what's pending

If the user has not yet logged in (no `~/.cent-cli/local-storage.json`, or `cent-cli books`
errors with "not logged in"), tell them to run `cent-cli login <provider> ...` themselves
once — the CLI never opens a browser, so credential issuance must happen out-of-band.

## Invocation

Run every command via `npx`:

```sh
npx -y cent-cli@latest <command> [flags]
```

After the first `npx` invocation the package is cached locally and subsequent calls are
fast. Always pass `--json` when you (the AI) need to parse the result.

Errors go to stderr with non-zero exit code. With `--json`, errors look like
`{"error":{"message":"..."}}`. Without `--json`, errors are plain `error: ...` lines.

## Critical contracts (read before writing)

1. **Writes are local until `sync`.** `add`, `update`, `delete`, `import --yes`, and
   every meta-CRUD write (`category add`, `tag add`, `budget update`, ...) only stash
   the change locally. To push to the remote, run `cent-cli sync --book <name|id>`.
   This is git-style commit/push — when you make multiple changes in a row, do them
   first and `sync` once at the end.

2. **`--book` is required for almost every command.** Accepts a short name OR a full
   id (`owner/repo` for GitHub/Gitee, full path for WebDAV). Resolve once with
   `cent-cli books --json` if you're unsure which name maps to what.

3. **Time range is required for `analyze`.** Pass either `--from <iso> --to <iso>` or
   `--unit <year|month|week|day> [--ref <iso>]`. Passing both or neither errors. Don't
   guess defaults; ask the user when ambiguous (e.g. "last month" → `--unit month
   --ref 2026-04-15`).

4. **Destructive ops require `--yes`.** `delete` and `<entity> delete` refuse without
   `--yes`. `import` defaults to dry-run; `--yes` actually writes. ALWAYS run import
   without `--yes` first to show the user the preview, then ask before committing.

5. **Categories: only user-defined ones can be edited.** Built-in default categories
   are read-only. To override one, `category add` a new entry with the same name
   (the user-defined entry wins).

6. **Tags must exist before bills reference them.** Bill `add --tag X` rejects unknown
   tags. If the user wants a new tag, `tag add` it first, then add the bill.

7. **Amounts are in main units.** Write `--amount 12.50` for $12.50. Internally Cent
   uses 10000:1 integers, but every CLI flag accepts the human form. (One exception:
   the JSON `Bill.amount` field in import payloads is the integer form — see import
   schema below.)

## Command map

| Command | Purpose |
| --- | --- |
| `login <provider> ...` | log in (github / gitee / webdav) — user runs once, manually |
| `logout` | clear stored credentials |
| `books [--json]` | list all books on the active endpoint |
| `book-create <name>` | create a new book |
| `search --book <b> [-q <filter>] [--limit N] [--json]` | list / filter bills |
| `sync --book <b>` | push local stash + pull remote changes |
| `add --book <b> --amount <n> --category <c> [...]` | record a bill (local stash) |
| `update <id> --book <b> [--amount/--type/...]` | edit a bill (local stash) |
| `delete <id> --book <b> --yes` | delete a bill (local stash) |
| `analyze --book <b> [--unit / --from --to] [...]` | totals + structure + period stats |
| `import <file> --book <b> [--strategy] [--yes]` | import JSON backup (dry-run by default) |
| `category <list/get/add/update/delete> ...` | category CRUD (user-defined only) |
| `tag <list/get/add/update/delete> ...` | tag CRUD |
| `tag-group <list/get/add/update/delete> ...` | personal tag-group CRUD |
| `budget <list/get/add/update/delete> ...` | budget CRUD |
| `filter-view <list/get/add/update/delete> ...` | saved filter / stat view CRUD |
| `stash --book <b> [--show]` | [debug] count pending local writes |

For exact flag lists run `npx -y cent-cli@latest <command> --help` — the help text
contains the same long-form description and examples that appear below.

---

## Filter-query DSL (used by `search -q` and `analyze -q`)

Cent's filter query is Lucene-like. `q:` prefix is optional in CLI (`-q "..."` always
parses as a filter expression).

### Fields

| Field | Meaning | Examples |
| --- | --- | --- |
| `type` | bill type | `type:expense` / `type:income` |
| `category` | category name OR id | `category:餐饮` / `category:cat_abc` |
| `tag` | tag name OR id | `tag:旅行` |
| `creator` / `user` | bill creator name OR id | `creator:张三` |
| `currency` | currency code | `currency:USD` |
| `amount` | numeric amount (main unit) | `amount:>100` |
| `time` | bill time, ISO date or full ISO | `time:>=2026-01-01` |
| `recent` | relative window: `<n><d|w|M|y>` (M=month, m=minute) | `recent:7d` |
| `has` | boolean flag: `assets` / `scheduled` / `comment` / `location` | `has:assets` |
| `comment` | substring match against bill comment (default field) | `comment:晚餐` or just `晚餐` |

### Operators

- Compare: `:`, `:>`, `:>=`, `:<`, `:<=`
- Range: `field:[low TO high]` (inclusive)
- Boolean: `AND` / `&&`, `OR` / `||`, `NOT` / `!` / `-` prefix
- Grouping: `( ... )`
- Implicit AND: adjacent terms without a connector AND together
- Quoted values for spaces/colons/parens: `comment:"家庭 聚餐"`
- Precedence: `NOT` > `AND` > `OR` (parenthesize when in doubt)

### Recipes

```
recent:7d AND type:expense                         # last 7 days, expenses
category:餐饮 AND amount:>=50                       # food bills ≥ 50
(tag:旅行 OR tag:出差) AND -has:scheduled            # trip-tagged ad-hoc bills
amount:[100 TO 500] AND time:[2026-01-01 TO 2026-04-01]  # Q1 mid-amount bills
报销 AND -has:assets                                # comment "报销" without attachments
```

> Names ↔ ids: any `category` / `tag` / `creator` value can be a name or id.
> Names auto-resolve against book meta + Cent's built-in defaults (translated to the
> active locale). Unknown names fall back to literal match (so they just don't hit
> anything — no error).

---

## Import JSON schema

`cent-cli import <file> --book <b>` reads a Cent backup JSON. The expected shape:

```jsonc
{
  "items": Bill[],     // all transactions
  "meta":  GlobalMeta  // categories, tags, budgets, etc.
}
```

### `Bill`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `string` | unique bill id; on `append` strategy, an existing bill with the same id (or same `time`) is skipped |
| `type` | `"expense" \| "income"` | |
| `categoryId` | `string` | must match an entry in `meta.categories` OR a built-in default category id |
| `creatorId` | `number \| string` | rewriteable via `--as-mine` (default true) to the current user's id |
| `amount` | `number` | **integer, 10000:1** — `12.50` USD is stored as `125000`. (CLI flags use main units; only the JSON payload uses the integer form.) |
| `time` | `number` | unix milliseconds |
| `comment` | `string?` | |
| `tagIds` | `string[]?` | each id must exist in `meta.tags` |
| `currency` | `{ base: string, target: string, amount: number }?` | multi-currency record |
| `images` | `(string \| File)[]?` | base64 / URL / asset path; passed through verbatim — CLI does NOT handle `.zip` backups with attachments |
| `location` | `{ latitude, longitude, accuracy }?` | |
| `extra` | `{ scheduledId?: string }?` | |

### `GlobalMeta`

| Field | Type | Notes |
| --- | --- | --- |
| `categories` | `BillCategory[]?` | user-customized categories. Entries with `customName: true` override built-in defaults of the same name. |
| `tags` | `BillTag[]` | required (can be empty array) |
| `budgets` | `Budget[]?` | |
| `customFilters` | `BillFilterView[]?` | saved stat views |
| `personal` | `Record<userId, PersonalMeta>?` | per-user (tag-groups etc.) |
| `baseCurrency` | `string?` | |
| ... | | other web-side optional fields are preserved as-is |

### `BillCategory`

```ts
{
  id:           string;        // unique
  type:         "expense" | "income";
  name:         string;
  icon:         string;        // icon class string (may be "")
  color:        string;
  customName?:  boolean;       // MUST be true for new user categories
  parent?:      string;        // parent category id; absent = top-level
  defaultSelect?: boolean;
}
```

### `BillTag`

```ts
{ id: string; name: string; preferCurrency?: string }
```

### Strategies

- `--strategy append` (default) — drops incoming bills whose `id` OR `time` already
  exists locally; meta is deep-merged; new categories appended.
- `--strategy overlap` — replaces meta entirely, takes incoming bills as-is, clears
  local stash before writing. Use only for full-book migration.

### Workflow

```
# 1. Always preview first (no --yes):
npx -y cent-cli@latest import backup.json --book mybook --json

# 2. Show the preview to the user (importCount / skippedCount / metaDiff)
#    and ask whether to commit.

# 3. Commit:
npx -y cent-cli@latest import backup.json --book mybook --yes

# 4. Push:
npx -y cent-cli@latest sync --book mybook
```

---

## Examples

### "How much did I spend on food last month?"

```sh
# Resolve "last month" with the user (or use the most recent complete month).
npx -y cent-cli@latest analyze --book mybook --unit month --ref 2026-04-15 \
  -q "category:餐饮" --type expense --json
```

Read `analysis.current.total` (already in main units).

### "Record a 50-yuan lunch"

```sh
npx -y cent-cli@latest add --book mybook --amount 50 --category 餐饮 --comment "lunch"
npx -y cent-cli@latest sync --book mybook   # don't forget the push
```

### "Show me trips over $100"

```sh
npx -y cent-cli@latest search --book mybook \
  -q "tag:旅行 AND amount:>100" --json
```

### "Import this backup, but only show me what would change"

```sh
npx -y cent-cli@latest import ~/Downloads/cent-backup.json --book mybook --json
# Show the user importCount / skippedCount / metaDiff, ask before re-running with --yes.
```

### "Set up a monthly food budget of 1000"

```sh
npx -y cent-cli@latest budget add --book mybook --title 月度餐饮 \
  --total 1000 --start 2026-05-01 --repeat-unit month --repeat-value 1 \
  --category-budget 餐饮=1000
npx -y cent-cli@latest sync --book mybook
```

---

## Output conventions

- Default human-readable text (tables for lists, key=value blocks for analyze).
- `--json` everywhere → structured output suitable for parsing.
- Errors → stderr + non-zero exit. JSON-mode errors are single-line JSON objects.

## Things this CLI does NOT do

- **No interactive prompts.** Every input must be a flag.
- **No browser-based OAuth.** `login` accepts already-issued tokens only.
- **No `book-invite` / `book-delete`.** Both gated to the web app (collaboration
  authorization / irreversible repo destruction).
- **No `.zip` import.** Attachments are out of scope. Export the inner JSON or use
  the web app for zip imports.
- **No automatic sync after writes.** Always run `cent-cli sync` to push.
- **No category type coercion.** New user categories are `customName: true`; built-in
  defaults are read-only.
