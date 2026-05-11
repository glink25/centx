#!/usr/bin/env bash
# End-to-end smoke covering Phase 1 + 2A + 2B + 2C + 4A + 4B (meta CRUD).
#
# Config: copy cli/.env.example → cli/.env.smoke and fill in your values.
# Required vars (in env or .env.smoke):
#   CENT_TEST_PAT   GitHub PAT (Contents R/W + Metadata R)
#   CENT_TEST_BOOK  short name (or owner/repo) of a writable test book
#                   (recommend a throwaway book like "cli-smoke")
#   CENT_TEST_CATEGORY  category name for add tests (default: "餐饮")
#
# Usage: pnpm test:smoke   (or: bash cli/scripts/smoke.sh)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Auto-source .env.smoke if it exists. Search order:
#   1) $CENT_SMOKE_ENV (explicit override, useful for CI)
#   2) cli/.env.smoke (next to package.json — the documented default)
#   3) cwd/.env.smoke
ENV_FILE=""
for candidate in \
    "${CENT_SMOKE_ENV:-}" \
    "$CLI_DIR/.env.smoke" \
    "$PWD/.env.smoke"; do
    if [[ -n "$candidate" && -f "$candidate" ]]; then
        ENV_FILE="$candidate"
        break
    fi
done
if [[ -n "$ENV_FILE" ]]; then
    printf "loading env from %s\n" "$ENV_FILE"
    # shellcheck disable=SC1090
    set -a; source "$ENV_FILE"; set +a
fi

: "${CENT_TEST_PAT:?need CENT_TEST_PAT — set in env or cli/.env.smoke (copy from .env.example)}"
: "${CENT_TEST_BOOK:?need CENT_TEST_BOOK — set in env or cli/.env.smoke}"
CATEGORY="${CENT_TEST_CATEGORY:-餐饮}"

# Isolate config so the smoke does not touch the user's real ~/.cent-cli/.
export CENT_CLI_HOME="${TMPDIR:-/tmp}/cent-cli-smoke-$$"
trap 'rm -rf "$CENT_CLI_HOME"' EXIT

BUNDLE="$CLI_DIR/dist/bin/cent-cli.js"
if [[ ! -f "$BUNDLE" ]]; then
    echo "bundle not found: $BUNDLE — run \`pnpm build\` first" >&2
    exit 1
fi
CLI=(node "$BUNDLE")

step() { printf "\n\033[1;36m▶ %s\033[0m\n" "$*"; }
ok()   { printf "  \033[32m✓\033[0m %s\n" "$*"; }
fail() { printf "  \033[31m✗\033[0m %s\n" "$*"; exit 1; }
need() { command -v "$1" >/dev/null || fail "missing dep: $1"; }

need jq
need node

# ─────────────────────────────────────────
step "0 — login dispatcher arg validation (offline; no network required)"

expect_fail() {
    local label="$1"; shift
    if "${CLI[@]}" "$@" >/dev/null 2>&1; then
        fail "expected failure: $label"
    fi
    ok "$label rejected"
}

expect_fail "login without provider"        login
expect_fail "login bogus"                   login bogus
expect_fail "login github without --token"  login github
expect_fail "login gitee without --token"   login gitee
expect_fail "login webdav without --url"    login webdav --username u --password p
expect_fail "login webdav without --user"   login webdav --url https://x --password p
expect_fail "login webdav without --pass"   login webdav --url https://x --username u
expect_fail "book-invite (always rejected)" book-invite owner/repo
expect_fail "book-delete (always rejected)" book-delete owner/repo

# ─────────────────────────────────────────
step "1.1 — login (caches user info to local-storage.json)"
"${CLI[@]}" login github --token "$CENT_TEST_PAT" --json | tee /tmp/cent-login.json
jq -e '.ok==true and .user.login != ""' /tmp/cent-login.json >/dev/null \
    || fail "login json shape unexpected"
ok "logged in as $(jq -r .user.login /tmp/cent-login.json)"

test -f "$CENT_CLI_HOME/local-storage.json" \
    || fail "local-storage.json was not written"
jq -e '.cent_cli_user' "$CENT_CLI_HOME/local-storage.json" >/dev/null \
    || fail "cent_cli_user not persisted"
ok "credentials + user info persisted at $CENT_CLI_HOME/local-storage.json"

# ─────────────────────────────────────────
step "1.2 — books"
"${CLI[@]}" books --json | tee /tmp/cent-books.json
BOOK_ID=$(jq -r --arg b "$CENT_TEST_BOOK" \
    '(map(select(.name==$b or .id==$b)) | .[0].id) // empty' \
    /tmp/cent-books.json)
test -n "$BOOK_ID" || fail "test book \"$CENT_TEST_BOOK\" not in books list"
ok "resolved test book → $BOOK_ID"

# ─────────────────────────────────────────
step "2A — sync (cold; populates LevelDB cache)"
"${CLI[@]}" sync --book "$CENT_TEST_BOOK" --json | tee /tmp/cent-sync1.json
T1=$(jq -r '.elapsedMs' /tmp/cent-sync1.json)
ok "first sync: ${T1}ms"

test -d "$CENT_CLI_HOME/cache" || fail "cache dir not created"
CACHE_DIR=$(ls -d "$CENT_CLI_HOME/cache"/book-* 2>/dev/null | head -1)
test -n "$CACHE_DIR" || fail "no book-* subdir under cache/"
ok "leveldb cache at $CACHE_DIR"

step "2A — sync (warm; should be incremental)"
"${CLI[@]}" sync --book "$CENT_TEST_BOOK" --json | tee /tmp/cent-sync2.json
T2=$(jq -r '.elapsedMs' /tmp/cent-sync2.json)
ok "second sync: ${T2}ms (compare with cold ${T1}ms)"

# ─────────────────────────────────────────
step "2B — search no query"
"${CLI[@]}" search --book "$CENT_TEST_BOOK" --limit 3 --json | tee /tmp/cent-search.json
jq -e 'type=="array"' /tmp/cent-search.json >/dev/null \
    || fail "search output not an array"
ok "returned $(jq length /tmp/cent-search.json) rows"

step "2B — search -q recent:30d (filter-query path, exercises dayjs plugins)"
"${CLI[@]}" search --book "$CENT_TEST_BOOK" -q "recent:30d" --limit 3 --json >/dev/null
ok "filter-query recent:30d ok"

# ─────────────────────────────────────────
step "2C — stash should be empty before any writes"
"${CLI[@]}" stash --book "$BOOK_ID" --json | tee /tmp/cent-stash0.json
jq -e '.count==0' /tmp/cent-stash0.json >/dev/null \
    || fail "stash not empty at start (count=$(jq .count /tmp/cent-stash0.json))"
ok "stash empty"

step "2C — add (writes local stash, must NOT auto-sync)"
TS=$(date +%s)
ADD_OUT=$("${CLI[@]}" add --book "$CENT_TEST_BOOK" \
    --amount 1.23 --category "$CATEGORY" \
    --comment "smoke-$TS" --json)
echo "$ADD_OUT"
BILL_ID=$(echo "$ADD_OUT" | jq -r '.bill.id')
test -n "$BILL_ID" && test "$BILL_ID" != "null" || fail "no bill id returned"
echo "$ADD_OUT" | jq -e '.bill.amount==12300' >/dev/null \
    || fail "amount not normalized to 12300 (1.23 * 10000)"
ok "added bill $BILL_ID (amount=12300)"

step "2C — stash count should be 1 (add was NOT auto-synced)"
"${CLI[@]}" stash --book "$BOOK_ID" --json | tee /tmp/cent-stash1.json
jq -e '.count==1' /tmp/cent-stash1.json >/dev/null \
    || fail "expected exactly 1 stash entry (got $(jq .count /tmp/cent-stash1.json)) — did add accidentally sync?"
ok "exactly 1 pending stash entry"

step "2C — update (should densify into the same single stash slot)"
"${CLI[@]}" update "$BILL_ID" --book "$CENT_TEST_BOOK" --amount 9.99 --json \
    | jq -e '.bill.amount==99900' >/dev/null \
    || fail "update amount not 99900 (9.99 * 10000)"
"${CLI[@]}" stash --book "$BOOK_ID" --json \
    | jq -e '.count==1' >/dev/null \
    || fail "stash count != 1 after update (densStashes should collapse same id)"
ok "update applied; stash count still 1 (densified)"

step "2C — delete without --yes must fail"
if "${CLI[@]}" delete "$BILL_ID" --book "$CENT_TEST_BOOK" --json 2>/dev/null; then
    fail "delete should reject without --yes"
fi
ok "delete correctly rejected"

step "2C — delete --yes"
"${CLI[@]}" delete "$BILL_ID" --book "$CENT_TEST_BOOK" --yes --json \
    | jq -e --arg id "$BILL_ID" '.deleted==$id' >/dev/null \
    || fail "delete output unexpected"
"${CLI[@]}" stash --book "$BOOK_ID" --json \
    | jq -e '.count==1' >/dev/null \
    || fail "stash count != 1 after delete (still densified to one entry per id)"
ok "delete applied; stash count still 1"

step "2C — sync flushes pending stash"
"${CLI[@]}" sync --book "$CENT_TEST_BOOK" --json >/dev/null
"${CLI[@]}" stash --book "$BOOK_ID" --json | tee /tmp/cent-stash-after-sync.json
jq -e '.count==0' /tmp/cent-stash-after-sync.json >/dev/null \
    || fail "stash not empty after explicit sync"
ok "stash drained to 0 after sync"

# ─────────────────────────────────────────
step "2C — book-invite / book-delete (URL only, no endpoint call)"
"${CLI[@]}" book-invite owner/repo --json \
    | jq -e '.url|test("github.com/owner/repo/settings/access")' >/dev/null \
    || fail "book-invite URL malformed"
"${CLI[@]}" book-delete owner/repo --json \
    | jq -e '.url|test("github.com/owner/repo/settings$")' >/dev/null \
    || fail "book-delete URL malformed"
ok "book-* commands print URL only"

# ─────────────────────────────────────────
step "4A — analyze --unit month (json shape)"
"${CLI[@]}" analyze --book "$CENT_TEST_BOOK" --unit month --json \
    | tee /tmp/cent-analyze-month.json
jq -e '
    .range.unit=="month"
    and (.range.fromIso != null)
    and (.total | has("expense") and has("income") and has("balance"))
    and (.structure | has("expense") and has("income") and has("tag"))
    and (.analysis.current | has("dayAvg") and has("weekAvg") and has("monthAvg"))
    and (.descriptions.summary | type=="string" and length>0)
    and (.descriptions.total | type=="string" and length>0)
' /tmp/cent-analyze-month.json >/dev/null \
    || fail "analyze --unit month json shape unexpected"
ok "analyze --unit month ok ($(jq '.range.count' /tmp/cent-analyze-month.json) bills)"

step "4A — analyze --from/--to (range mode + filter-query)"
FROM_ISO="$(date -u -v-30d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '30 days ago' +%Y-%m-%dT%H:%M:%SZ)"
TO_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
"${CLI[@]}" analyze --book "$CENT_TEST_BOOK" \
    --from "$FROM_ISO" --to "$TO_ISO" -q "type:expense" --json \
    | tee /tmp/cent-analyze-range.json
jq -e '
    .range.unit==null
    and .range.focusType=="expense"
    and (.structure.expense | type=="array")
    and (.descriptions.total | type=="string")
' /tmp/cent-analyze-range.json >/dev/null \
    || fail "analyze --from/--to + -q json shape unexpected"
ok "analyze --from/--to ok"

step "4A — analyze validation (must fail without time range)"
if "${CLI[@]}" analyze --book "$CENT_TEST_BOOK" --json 2>/dev/null; then
    fail "analyze should fail without --from/--to or --unit"
fi
ok "analyze rejects missing time range"

# ─────────────────────────────────────────
# Phase 4B — import (JSON-only, dry-run by default, --yes commits).
step "4B — import dry-run (uses existing book bills as JSON payload)"
"${CLI[@]}" search --book "$CENT_TEST_BOOK" --json > /tmp/cent-import-bills.json
jq -n --slurpfile items /tmp/cent-import-bills.json \
    '{ items: $items[0], meta: {} }' > /tmp/cent-import.json
"${CLI[@]}" import /tmp/cent-import.json --book "$CENT_TEST_BOOK" --json \
    | tee /tmp/cent-import-dry.json
jq -e '.dryRun==true and .strategy=="append" and (.incomingCount|type=="number")' \
    /tmp/cent-import-dry.json >/dev/null \
    || fail "import dry-run json shape unexpected"
# Append strategy against own backup → every incoming bill collides on id+time → importCount must be 0.
jq -e '.importCount==0' /tmp/cent-import-dry.json >/dev/null \
    || fail "expected importCount=0 when re-importing own bills with append (id+time match)"
"${CLI[@]}" stash --book "$BOOK_ID" --json | jq -e '.count==0' >/dev/null \
    || fail "dry-run must NOT write to stash"
ok "dry-run preview emitted; no writes"

step "4B — import rejects .zip files"
echo "not really a zip" > /tmp/cent-import.zip
if "${CLI[@]}" import /tmp/cent-import.zip --book "$CENT_TEST_BOOK" --json 2>/dev/null; then
    fail "import should reject .zip"
fi
ok "zip imports rejected"

step "4B — import --yes writes a synthetic new bill"
NEW_ID="cent-cli-smoke-import-$$"
NEW_TIME=$(($(date +%s) * 1000))
USER_ID=$(jq -r '.cent_cli_user | fromjson | .id' "$CENT_CLI_HOME/local-storage.json")
NOW_MS=$(date +%s)000
jq -n \
    --arg id "$NEW_ID" \
    --arg uid "$USER_ID" \
    --argjson t "$NEW_TIME" \
    --argjson now "$NOW_MS" \
    '{
        items: [{
            id: $id,
            type: "expense",
            amount: 4321,
            time: $t,
            categoryId: "food",
            creatorId: $uid,
            comment: "smoke-import",
            __create_at: $now,
            __update_at: $now
        }],
        meta: {}
    }' > /tmp/cent-import-one.json
"${CLI[@]}" import /tmp/cent-import-one.json --book "$CENT_TEST_BOOK" --yes --json \
    | tee /tmp/cent-import-yes.json
jq -e '.ok==true and .imported==1' /tmp/cent-import-yes.json >/dev/null \
    || fail "import --yes did not report imported=1"
"${CLI[@]}" stash --book "$BOOK_ID" --json \
    | jq -e '.count>=1' >/dev/null \
    || fail "stash should contain the imported bill (sync-only contract)"
ok "import --yes wrote 1 stash entry"

step "4B — sync flushes import; then delete the synthetic bill to keep the book clean"
"${CLI[@]}" sync --book "$CENT_TEST_BOOK" --json >/dev/null
"${CLI[@]}" delete "$NEW_ID" --book "$CENT_TEST_BOOK" --yes --json >/dev/null
"${CLI[@]}" sync --book "$CENT_TEST_BOOK" --json >/dev/null
ok "synthetic import bill cleaned up"

# ─────────────────────────────────────────
# Phase 4B — meta CRUD (categories / tags / tag-groups / budgets / filter-views).
# All five entities share the same dispatcher (`<entity> <action> [id]`) and the
# same write contract: writes a meta batch, then process.exit(0). The smoke
# below only covers add → list → (update for one entity) → delete to keep the
# scope small; full-field permutations are AI-tool-callable and don't need a
# manual smoke. Each create uses a unique suffix so re-running the smoke is
# idempotent against the test book.
SUFFIX="smoke-$$"

step "4B — tag add → list → update → delete"
TAG_OUT=$("${CLI[@]}" tag add --book "$CENT_TEST_BOOK" \
    --name "tag-$SUFFIX" --json)
echo "$TAG_OUT"
TAG_ID=$(echo "$TAG_OUT" | jq -r .tag.id)
test -n "$TAG_ID" && test "$TAG_ID" != "null" || fail "tag add no id"
ok "added tag $TAG_ID"
"${CLI[@]}" tag list --book "$CENT_TEST_BOOK" --json \
    | jq -e --arg id "$TAG_ID" 'map(select(.id==$id))|length==1' >/dev/null \
    || fail "tag $TAG_ID not in tag list"
"${CLI[@]}" tag update "tag-$SUFFIX" --book "$CENT_TEST_BOOK" \
    --prefer-currency USD --json \
    | jq -e '.tag.preferCurrency=="USD"' >/dev/null \
    || fail "tag update did not set preferCurrency"
ok "tag update applied (preferCurrency=USD)"
"${CLI[@]}" tag delete "$TAG_ID" --book "$CENT_TEST_BOOK" --yes --json \
    | jq -e --arg id "$TAG_ID" '.deleted==$id' >/dev/null \
    || fail "tag delete json shape unexpected"
ok "tag deleted"

step "4B — category add → list → delete (custom-only path)"
CAT_OUT=$("${CLI[@]}" category add --book "$CENT_TEST_BOOK" \
    --name "cat-$SUFFIX" --type expense --json)
echo "$CAT_OUT"
CAT_ID=$(echo "$CAT_OUT" | jq -r .category.id)
echo "$CAT_OUT" | jq -e '.category.customName==true' >/dev/null \
    || fail "category add must set customName=true"
ok "added category $CAT_ID (customName=true)"
"${CLI[@]}" category list --book "$CENT_TEST_BOOK" --json \
    | jq -e --arg id "$CAT_ID" 'map(select(.id==$id))|length==1' >/dev/null \
    || fail "category $CAT_ID not in list"
"${CLI[@]}" category delete "$CAT_ID" --book "$CENT_TEST_BOOK" --yes --json \
    | jq -e --arg id "$CAT_ID" '.deleted==$id' >/dev/null \
    || fail "category delete json shape unexpected"
ok "category deleted"

step "4B — budget add → list → delete (basic monthly budget)"
NOW_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
BDG_OUT=$("${CLI[@]}" budget add --book "$CENT_TEST_BOOK" \
    --title "bdg-$SUFFIX" --total 1000 \
    --start "$NOW_ISO" --repeat-unit month --repeat-value 1 --json)
echo "$BDG_OUT"
BDG_ID=$(echo "$BDG_OUT" | jq -r .budget.id)
echo "$BDG_OUT" | jq -e '.budget.totalBudget==10000000' >/dev/null \
    || fail "budget total not normalized to 10000000 (1000 * 10000)"
ok "added budget $BDG_ID (total=10000000)"
"${CLI[@]}" budget list --book "$CENT_TEST_BOOK" --json \
    | jq -e --arg id "$BDG_ID" 'map(select(.id==$id))|length==1' >/dev/null \
    || fail "budget $BDG_ID not in list"
"${CLI[@]}" budget delete "$BDG_ID" --book "$CENT_TEST_BOOK" --yes --json >/dev/null
ok "budget deleted"

step "4B — filter-view add → list → delete (recent:30d)"
FV_OUT=$("${CLI[@]}" filter-view add --book "$CENT_TEST_BOOK" \
    --name "fv-$SUFFIX" --recent 30d --filter-type expense --json)
echo "$FV_OUT"
FV_ID=$(echo "$FV_OUT" | jq -r .filterView.id)
echo "$FV_OUT" | jq -e '.filterView.filter.recent.value==30 and .filterView.filter.recent.unit=="day"' >/dev/null \
    || fail "filter-view recent shorthand not parsed (expected 30 day)"
echo "$FV_OUT" | jq -e '.filterView.filter.type=="expense"' >/dev/null \
    || fail "filter-view type not set to expense"
ok "added filter-view $FV_ID (recent=30d type=expense)"
"${CLI[@]}" filter-view list --book "$CENT_TEST_BOOK" --json \
    | jq -e --arg id "$FV_ID" 'map(select(.id==$id))|length==1' >/dev/null \
    || fail "filter-view $FV_ID not in list"
"${CLI[@]}" filter-view delete "$FV_ID" --book "$CENT_TEST_BOOK" --yes --json >/dev/null
ok "filter-view deleted"

step "4B — tag-group add → list → delete (personal scope, requires currentUser)"
TG_OUT=$("${CLI[@]}" tag-group add --book "$CENT_TEST_BOOK" \
    --name "tg-$SUFFIX" --color "#cccccc" --json)
echo "$TG_OUT"
TG_ID=$(echo "$TG_OUT" | jq -r .tagGroup.id)
test -n "$TG_ID" && test "$TG_ID" != "null" || fail "tag-group add no id"
"${CLI[@]}" tag-group list --book "$CENT_TEST_BOOK" --json \
    | jq -e --arg id "$TG_ID" 'map(select(.id==$id))|length==1' >/dev/null \
    || fail "tag-group $TG_ID not in personal list (current user mismatch?)"
"${CLI[@]}" tag-group delete "$TG_ID" --book "$CENT_TEST_BOOK" --yes --json >/dev/null
ok "tag-group $TG_ID added & deleted in personal scope"

step "4B — meta delete must require --yes"
"${CLI[@]}" tag add --book "$CENT_TEST_BOOK" --name "tag-${SUFFIX}-2" --json >/dev/null
if "${CLI[@]}" tag delete "tag-${SUFFIX}-2" --book "$CENT_TEST_BOOK" --json 2>/dev/null; then
    fail "tag delete should reject without --yes"
fi
"${CLI[@]}" tag delete "tag-${SUFFIX}-2" --book "$CENT_TEST_BOOK" --yes --json >/dev/null
ok "tag delete correctly rejects without --yes"

step "4B — meta dispatcher rejects unknown action"
if "${CLI[@]}" tag bogus --book "$CENT_TEST_BOOK" --json 2>/dev/null; then
    fail "expected error on unknown action"
fi
ok "dispatcher rejects unknown action"

step "4B — sync to flush meta batches before checkout"
"${CLI[@]}" sync --book "$CENT_TEST_BOOK" --json >/dev/null
ok "meta batches flushed"

# ─────────────────────────────────────────
step "logout"
"${CLI[@]}" logout --json >/dev/null
if [[ -f "$CENT_CLI_HOME/local-storage.json" ]]; then
    jq -e '(.github_user_token // null)==null and (.cent_cli_user // null)==null' \
        "$CENT_CLI_HOME/local-storage.json" >/dev/null \
        || fail "logout did not clear stored credentials"
fi
ok "credentials cleared"

# ─────────────────────────────────────────
step "bundle size sanity"
SIZE_KB=$(du -k "$BUNDLE" | awk '{print $1}')
# Threshold history: 200 (Phase 1-2C) → 300 (Phase 4A: charts + inlined dayjs)
# → 400 (Phase 4B/4C: meta CRUD + import. lodash-es merge/cloneDeep/isEqual
# fully inlined; webdav + gitee endpoint paths transitively pulled by github
# endpoint init). Verified: no echarts/react/UI deps in bundle.
test "$SIZE_KB" -lt 400 \
    || fail "bundle size ${SIZE_KB}KB exceeds 400KB threshold — did UI deps leak in?"
ok "bundle size ${SIZE_KB}KB"

printf "\n\033[1;32mall checks passed\033[0m\n"
