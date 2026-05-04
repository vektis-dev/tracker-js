---
name: vektis-instrument
description: Bulk-instrument a customer codebase from a vektis-discover output. Reads .vektis/discover-output.json, batch-creates Dev Items in app.vektis.io, and inserts vektis.track() calls at every approved insertion point — one diff confirmation, no per-feature configuration.
argument-hint: [--paste-token]
user-invocable: true
---

# vektis-instrument

Consume `.vektis/discover-output.json` (produced by `vektis-discover`), batch-create matching Dev Items in vektis-app, and insert `vektis.track()` calls in the customer's source code. The customer never types a credential, never types a Dev Item field, and approves a single multi-file diff.

## Hard constraints

- **Never modify files without showing a diff first.** The customer approves the entire batch in one go (or per-file).
- **Never remove existing analytics SDK calls** (mixpanel, segment, amplitude, posthog, ga4). v1 ADDS `vektis.track()` alongside; removal is the customer's separate decision.
- **Never write if the working tree is dirty.** Prompt to stash or commit first.
- **Never create a PR automatically.** Print the `gh pr create` command; the customer runs it.
- **Always call the bulk endpoint BEFORE writing any code.** If the endpoint fails, no files are touched.

## Resolve `VEKTIS_API_URL`

```bash
VEKTIS_API_URL="${VEKTIS_API_URL:-https://app.vektis.io}"
```

Print the resolved URL only if it differs from the default (signals local dev / preview).

---

## Step 1 — Read `.vektis/discover-output.json`

```bash
if [ ! -f .vektis/discover-output.json ]; then
  echo "No .vektis/discover-output.json found. Run \`claude /vektis-discover\` first."
  exit 1
fi
```

Parse the file. Validate `schema_version: 1`. Extract `generated_at` and `candidates[]`.

**Staleness check.** If `generated_at` is older than 7 days, warn:

```
discover-output.json is N days old. Your codebase may have changed since the scan.
Re-run `claude /vektis-discover` for an up-to-date scan, or continue with the existing output? [y/N]
```

---

## Step 2 — Git status preflight

```bash
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  echo "Working tree is not clean. Stash or commit your changes before running vektis-instrument."
  echo
  git status --short
  exit 1
fi
```

This guards against the diff confirmation overlapping with unrelated edits the customer is mid-flight on.

---

## Step 3 — Authenticate via VEK-383

Read `.claude/skills/_shared/cli-auth.md` and follow Steps A through F end-to-end.

- Default: OAuth Device Flow.
- If the customer invoked the skill with `--paste-token`, skip OAuth and go straight to the paste-token branch (Step D).

After `_shared/cli-auth.md` completes, you have:

- `access_token` — the `vkcli_*` bearer in memory
- `~/.vektis/credentials.json` — persisted with `{ token, organizationId, expiresAt }`
- Confirmation: `Authenticated as <email> in <organizationName> org.`

If `_shared/cli-auth.md` Step E surfaced "Ask your admin..." (role !== admin), the skill exits there. Do NOT proceed.

---

## Step 4 — Bulk-create Dev Items

Translate each candidate from snake_case (discover-output) to camelCase (vektis-app DTO):

| discover-output | vektis-app DTO |
| --- | --- |
| `feature_id` | `featureId` |
| `value_type` | `valueType` |
| `metric_config` | `metricConfig` |
| `existing_sdk_call.event_name` | `eventName` |
| `existing_sdk_call.sdk` | `sdk` |
| `title` | `title` |

Inside `metricConfig`, keep snake_case keys (`numerator_action`, `start_action`, etc.) — that's the on-disk format.

**Cap and fan-out.** If `candidates.length > 100`, batch into ceil(N/100) sequential calls. Print progress between batches.

```bash
items_json=$(jq -c '.candidates | map({
  featureId: .feature_id,
  valueType: .value_type,
  metricConfig: .metric_config,
  title: .title,
  eventName: .existing_sdk_call.event_name,
  sdk: .existing_sdk_call.sdk
})' .vektis/discover-output.json)

response=$(curl -s -w "\n%{http_code}" -X POST \
  "$VEKTIS_API_URL/api/dev-items/bulk" \
  -H "Authorization: Bearer $access_token" \
  -H "Content-Type: application/json" \
  -d "{\"items\":$items_json}")

status=$(echo "$response" | tail -n 1)
body=$(echo "$response" | sed '$d')

if [ "$status" != "201" ]; then
  echo "Bulk create failed (HTTP $status):"
  echo "$body"
  exit 1
fi

created=$(echo "$body" | jq '.created')
skipped=$(echo "$body" | jq '.skipped')
```

Print a summary:

```
Created N dev items in <org>. Skipped M (already exist).
```

The skipped list contains feature IDs that already had non-deleted dev items in this org. Their insertion points still need code written (the customer wants `vektis.track()` calls regardless of whether the dev item is fresh).

---

## Step 5 — Build the insertion plan

For every candidate where `featureId` is in `created` OR in `skipped` (already_exists), compute the set of `(file, line, role, valueType, metric_config)` tuples from `insertion_points[]`.

Look up the literal `vektis.track()` call to insert per `INSERTION_RULES.md`:

- `count` + role `action` → `vektis.track('feature.used', { feature_id })`
- `percentage` + role `numerator_action` → `vektis.track('feature.used', { feature_id })`
- `percentage` + role `denominator_action` → `vektis.track('feature.engagement', { feature_id, action })` with `action` from `metric_config.denominator_action`
- `duration` + role `start_action` → `vektis.track('feature.engagement', { feature_id, action })` with `action` from `metric_config.start_action`
- `duration` + role `end_action` → `vektis.track('feature.engagement', { feature_id, action })` with `action` from `metric_config.end_action`
- `activity` + role `action` → `vektis.track('feature.engagement', { feature_id, action })` with `action` from `existing_sdk_call.event_name`
- `currency` → never auto-instrumented; print warning, skip.

**Per-line drift guard.** Read the target file. Verify the line at `insertion_points[i].line` still contains the expected SDK call signature (e.g., `mixpanel.track(`). If the line has drifted, skip that file with a warning row in the summary.

**Insertion mechanics (line-based, v1).** Insert the new `vektis.track()` call on a new line immediately AFTER the matched SDK call, preserving indentation. Add an import for the SDK if the file does not already import `@vektis-io/tracker` (use the same `import { vektis } from '@vektis-io/tracker'` pattern as `vektis-install`).

---

## Step 6 — Show summary diff and confirm

```
Instrumentation plan:

  18 files will be modified
  32 vektis.track() calls will be inserted
  3 imports will be added (files that don't yet import @vektis-io/tracker)
  2 candidates skipped (currency value type — manual entry only)
  1 file skipped (drift detected at src/components/Old.tsx:42)

Commands:
  approve all     — apply all changes
  show diff       — show the full unified diff
  show diff <N>   — show diff for file N (1-indexed)
  approve <N>     — approve only file N
  cancel          — exit without writing
```

Wait for the customer's command. `approve all` proceeds to Step 7. `cancel` exits with no file changes.

**Important note in the summary:** dev items have ALREADY been created in `app.vektis.io` (Step 4 ran first). Cancelling here does NOT delete them. To clean up, the customer can soft-delete in the `/dev` list view.

---

## Step 7 — Write all approved changes

Apply the inserts. Use atomic file writes (write to temp, then rename) so a mid-write failure does not corrupt the file.

After all writes succeed, print:

```
Instrumentation complete:

  N files modified
  M vektis.track() calls inserted

Branch: <current branch>

To open a PR for review:
  gh pr create --title 'feat(impact-tracking): instrument N features for VEKTIS'

To inspect the changes:
  git diff
```

If `gh auth status` succeeds, optionally offer:

```
Open PR now? [y/N]
```

On `Y`, run `gh pr create` with the suggested title. On `N`, exit. On `gh auth status` failure, just print the manual command and exit.

---

## Failure modes

- **Auth fails or token expires mid-flow** — re-run `_shared/cli-auth.md` Step A. If the customer has been polling for 10+ minutes, offer `--paste-token` fallback.
- **Bulk endpoint returns 4xx** — print the response body (it contains validation details). No files have been touched. Customer fixes the discover-output and re-runs.
- **Bulk endpoint returns 5xx** — print the body, suggest re-running. The endpoint is best-effort idempotent, so a re-run resumes cleanly.
- **All discover-output candidates already exist as dev items** — skill prints "All N candidates already exist; proceeding to instrumentation." and continues to Step 5 with the full candidate list.
- **All target files have drifted** — skill prints "All N candidates' source lines have drifted since discover. Re-run `claude /vektis-discover`." and exits without writing.
- **Customer cancels at the diff prompt** — exit cleanly. Dev items remain in app.vektis.io; customer can soft-delete in `/dev`.
- **Mid-write file permission error** — atomic write means partial state is impossible; the half-written file gets discarded. Print the error and exit; customer fixes the permission and re-runs (idempotency catches the existing dev items).
- **Currency-only candidates** — print warning rows, skip them all, otherwise proceed normally.

---

## Geico-simple gate (validation)

A non-engineer with an approved `vektis-discover` output runs `claude /vektis-instrument`:

1. Skill reads `.vektis/discover-output.json` (no prompts).
2. Skill checks `git status` — clean tree assumed.
3. Skill opens browser; customer clicks Authorize once.
4. Skill calls bulk endpoint; N dev items created in app.vektis.io.
5. Skill computes the insertion plan and shows the summary.
6. Customer types `approve all` — files written.
7. Skill prints `gh pr create` command. Customer runs it.

Total customer actions: **1 browser click + 1 typed approval + 1 PR creation command**. Time to "fully instrumented codebase + N dev items + PR ready" — under 5 minutes for a 30-candidate codebase.
