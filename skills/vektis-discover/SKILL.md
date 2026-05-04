---
name: vektis-discover
description: Sweep a customer codebase for analytics SDK calls (Mixpanel, Segment, Amplitude, PostHog, GA4) and produce an approved candidate list at .vektis/discover-output.json. Read-only — no source code is modified. Output is consumed by vektis-instrument to create Dev Items and insert vektis.track() calls.
argument-hint: [--scope <path>]
user-invocable: true
---

# vektis-discover

Sweep the customer's project for existing analytics-SDK calls and present them as a candidate list the PM can approve, reject, or edit in chat. On approval, write `.vektis/discover-output.json` for `vektis-instrument` (sibling skill) to consume.

**v1 scope: existing-analytics-SDK detection only.** Inferred-feature detection (named click handlers, form submits, route handlers without prior instrumentation) is deferred to a follow-up. If the codebase has no analytics calls, the empty-state message points the PM to `claude /vektis-bootstrap` or the manual wizard.

## Hard constraints

- **Read-only.** Never modify any customer source file. The only writes allowed by this skill are `.vektis/discover-output.json` (atomic) and an idempotent append to the customer's `.gitignore`.
- **Atomic write.** Nothing is persisted until the PM types `done`. `cancel` exits with zero side effects.
- **Never silently overwrite** an existing `.vektis/discover-output.json`. Always prompt.
- **Never throw.** File-write failures degrade to printing the candidate JSON in chat with manual-save instructions.
- **Tool-agnostic.** Pick `Grep`, `Glob`, or parallel `Agent` + `subagent_type=Explore` based on codebase size and your judgment. Do not hard-code a single tool — the regex-coverage variants below are what matter.

---

## Step 1 — Pre-flight checks

Verify the current working directory is a project root.

```bash
ls package.json index.html nuxt.config.ts svelte.config.* 2>/dev/null
```

If none of those exist, abort with: `No project markers found. Run claude /vektis-discover from your project root.`

Refuse to run inside the vektis-app source tree itself (developer-test guard):

```bash
grep -lE '"name":[[:space:]]*"vektis"' package.json 2>/dev/null
```

If matched, abort with: `This is the vektis-app source tree. Run /vektis-discover against a customer codebase.`

If `--scope <path>` was passed, validate the path exists and treat it as the scan root in place of cwd. Print `Scan scope: <path>`.

---

## Step 2 — Detect existing output (re-run guard)

If `.vektis/discover-output.json` already exists, prompt:

```
Existing .vektis/discover-output.json found (generated <timestamp>, N candidates).

  [1] Overwrite (re-scan from scratch — replaces the file on `done`)
  [2] Run /vektis-update instead (delta-only — only NEW features since last run)
  [3] Cancel

Which?
```

Wait for the PM's choice. Never silently overwrite.

---

## Step 3 — Sweep the codebase

### Scan scope

**Allowlist (where to look):**

- `src/`, `app/`, `pages/`, `components/`, `lib/`, project root files (top-level only — do not recurse into root-adjacent build dirs)

**Denylist (skip entirely):**

- `node_modules/`, `.next/`, `dist/`, `build/`, `out/`, `.turbo/`, `.cache/`, `.svelte-kit/`, `.nuxt/`, `coverage/`
- File patterns: `*.min.js`, `*.bundle.js`, `*.chunk.js`, `*.map`
- Tests / stories: `e2e/`, `__tests__/`, `*.spec.*`, `*.test.*`, `*.stories.*`
- Files larger than 500 KB

Honor the customer's `.gitignore` — anything ignored by git should not be scanned.

### SDK call signatures (canonical regex)

All regex below uses POSIX character classes (`[[:space:]]`) instead of `\s` so it works under `grep -E` on BSD grep (macOS default) — `\s` is a PCRE/GNU extension and silently matches nothing under POSIX ERE, which would cause silent missed detections.

| SDK       | Canonical pattern                                                 | Skip patterns (identity / lifecycle, not feature usage)                                     |
| --------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Mixpanel  | `mixpanel\.track[[:space:]]*\(`                                   | `mixpanel\.identify`, `mixpanel\.alias`, `mixpanel\.people\.set`                            |
| Segment   | `analytics\.track[[:space:]]*\(`, `analytics\.page[[:space:]]*\(` | `analytics\.identify`, `analytics\.alias`, `analytics\.group`                               |
| Amplitude | `amplitude\.(track\|logEvent)[[:space:]]*\(`                      | `amplitude\.setUserId`, `amplitude\.setUserProperties`                                      |
| PostHog   | `posthog\.capture[[:space:]]*\(`                                  | `posthog\.identify`, `posthog\.reset`, `posthog\.alias`                                     |
| GA4       | `gtag[[:space:]]*\([[:space:]]*['"]event['"]`                     | `gtag[[:space:]]*\([[:space:]]*['"]config['"]`, `gtag[[:space:]]*\([[:space:]]*['"]set['"]` |

### Variants you must cover

The canonical regex above is the **starting point**, not the whole job. After running canonical greps, verify coverage by checking each variant against the discovered files. If any variant returns hits the canonical regex missed, re-run with the broader pattern.

| Variant          | Example                                                             | Detection guidance                                                                                                                                                      |
| ---------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bracket notation | `mixpanel["track"]('event', ...)`                                   | Regex `mixpanel[[:space:]]*\[[[:space:]]*["']track["'][[:space:]]*\]`                                                                                                   |
| Aliased import   | `import mp from 'mixpanel-browser'; mp.track(...)`                  | First grep for `from[[:space:]]+['"]mixpanel(-browser)?['"]` to find aliases, then grep `<alias>\.track[[:space:]]*\(`                                                  |
| Destructured     | `const { track } = mixpanel; track(...)`                            | Find the destructure line with `const[[:space:]]*\{[^}]*track[^}]*\}[[:space:]]*=`, then locate bare calls with `^[[:space:]]+track[[:space:]]*\(` within the same file |
| Wrapped helper   | `function trackEvent(name, props) { mixpanel.track(name, props); }` | Flag the wrapper definition. Then grep for calls to the wrapper name across the project — those call sites are the actual feature events                                |
| Multi-line call  | `mixpanel.track(\n  'Checkout Completed',\n  { ... }\n)`            | Capture multi-line: read 5 lines after each match to extract the event-name string literal                                                                              |

### Skip-already-instrumented filter

Exclude any line matching the canonical Vektis event names (these are already-instrumented features — see `src/components/api-keys/event-usage-help.tsx:6-13` in the vektis-app repo for the source of truth):

```regex
vektis\.track[[:space:]]*\([[:space:]]*['"](feature\.used|feature\.engagement|session\.active|feature\.first_use|customer\.identified)['"]
```

A `vektis.track('feature.used', { feature_id: 'x' })` call already covers feature `x`. Do not surface it as a candidate.

---

## Step 4 — Build candidate rows

For each detected SDK call, extract the **event-name string literal** (the first argument). Then build a candidate row.

**Skip rules:**

- If the first argument is a variable, expression, or template literal (not a static string), skip the call. Slug normalization needs a string literal.
- If the slugged `feature_id` is empty (e.g., `mixpanel.track('')`), skip the call.

### Slug normalization (for `feature_id`)

Apply this normalizer to convert event names to `feature_id`:

1. Trim whitespace.
2. Lowercase.
3. Replace any run of non-alphanumeric characters with a single `-`.
4. Trim leading and trailing `-`.
5. Truncate to 200 characters (`src/backend/dev-items/dto/dev-item.dto.ts:118-123` enforces `trim().max(200)`).

Examples:

- `Checkout Completed` → `checkout-completed`
- `User_Signed-Up` → `user-signed-up`
- `view item` → `view-item`

### `value_type` heuristic

Default to `count`. Apply these heuristics in order to upgrade to other types when the signal is strong:

| Heuristic                                                                                                                                                                    | Resulting `value_type` | `metric_config` shape                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | -------------------------------------------------------------------- |
| Two events share a stem with `started` + `completed` (or `start` + `end`) suffixes (e.g., `checkout-started` + `checkout-completed`) — and BOTH are detected in the codebase | `duration`             | `{ start_action: '<stem>-started', end_action: '<stem>-completed' }` |
| Two events share a stem with `started` + `succeeded` / `failed` / `completed` semantics suggesting a conversion ratio                                                        | `percentage`           | `{ numerator_action: '<success>', denominator_action: '<start>' }`   |
| Page-view call type: `analytics.page(...)` (Segment) OR `gtag('event', 'page_view', ...)` (GA4) — regardless of the event-name string                                        | `activity`             | `null`                                                               |
| Event name suggests passive engagement (`page_view`, `dashboard_viewed`, `feature_seen`)                                                                                     | `activity`             | `null`                                                               |
| Event name suggests revenue (`purchase`, `subscription_created`, `payment_completed`)                                                                                        | `currency`             | `null`                                                               |
| Otherwise                                                                                                                                                                    | `count`                | `{ action: '<feature_id>' }`                                         |

When upgrading two events into one paired `duration` or `percentage` candidate, **do not surface the individual events as separate `count` candidates** — they are now represented by the paired row. Record both files/lines in `insertion_points` with appropriate `role` values.

The 5 supported `value_type` values are bound by `src/lib/db/schema/dev-items.schema.ts:117-141` and validated by the cross-field rules in `src/backend/dev-items/dto/dev-item.dto.spec.ts:22-76`. Do not invent new values.

### `confidence`

For v1, every existing-SDK-call candidate is `high` confidence — the customer already chose to track it. Keep the field in the schema for forward compatibility with the inferred-feature follow-up.

### `title` and `description`

- `title`: human-readable rendering of the event name. Capitalize words, replace hyphens/underscores with spaces. Example: `checkout-completed` → `Checkout completed`.
- `description`: one-sentence plain-English summary, e.g., `Track when a user completes the checkout flow`.

### `existing_sdk_call`

Always populated for v1 (since the only candidates come from existing SDK calls):

```json
{ "sdk": "mixpanel" | "segment" | "amplitude" | "posthog" | "ga4", "event_name": "<original event-name string literal>" }
```

### `insertion_points`

One entry per detected call site. `role` matches a key in `metric_config`:

- `count`, `activity`, `currency`: single insertion point with `role: "action"` (count) or `role: "primary"` (activity/currency).
- `duration`: two insertion points with `role: "start_action"` and `role: "end_action"`.
- `percentage`: two insertion points with `role: "numerator_action"` and `role: "denominator_action"`.

```json
{ "file": "src/components/checkout/CheckoutButton.tsx", "line": 42, "role": "action" }
```

Use repo-relative paths.

---

## Step 5 — Render the candidate table for PM review

Print a numbered markdown table:

```
Found N candidates. Review and respond:

| # | feature_id            | value_type | title              | source           | files                                  |
|---|-----------------------|------------|--------------------|------------------|----------------------------------------|
| 1 | checkout-completed    | count      | Checkout completed | mixpanel.track   | src/components/checkout/Button.tsx:42  |
| 2 | checkout-flow         | duration   | Checkout flow      | mixpanel.track×2 | …Start.tsx:18, …Button.tsx:42          |
| 3 | dashboard-viewed      | activity   | Dashboard viewed   | mixpanel.track   | src/app/dashboard/page.tsx:12          |

Commands:
  approve all                          — accept every row
  reject N        / reject N,M,...     — drop rows
  edit N feature_id=...                — change a row's feature_id
  edit N value_type=count|percentage|duration|activity|currency
  edit N title=...                     — override the human-readable title
  cancel                               — exit without writing
  done                                 — write .vektis/discover-output.json
```

Wait for PM input. On ambiguous syntax (e.g., `accept 1-3`), ask: `Did you mean rows 1, 2, 3? (y/n)`. Do not silently guess.

After each command, re-render the table reflecting the current state (rejected rows shown crossed out or omitted; edited rows highlighted).

---

## Step 6 — Empty state

If Step 3 returns zero candidates after filtering, print:

```
No analytics SDK calls detected in this codebase.

What now?

  • If you haven't installed VEKTIS yet: run `claude /vektis-bootstrap` (installs the SDK + sets up tracking in one flow).
  • If you have a feature in mind already: open the manual wizard at `<your-vektis-host>/dev` and click "Add Dev Item".
  • If you expected analytics calls to be detected: re-run with `--scope <path>` to broaden the scan.

Exiting without writing .vektis/discover-output.json.
```

Do not write a file. Exit cleanly.

---

## Step 7 — Atomic write on `done`

When the PM types `done`:

### 7a. Build the output JSON

```json
{
  "schema_version": 1,
  "generated_at": "<ISO8601 UTC>",
  "candidates": [
    {
      "feature_id": "checkout-completed",
      "value_type": "count",
      "metric_config": { "action": "checkout-completed" },
      "title": "Checkout completed",
      "description": "Track when a user completes the checkout flow",
      "confidence": "high",
      "existing_sdk_call": { "sdk": "mixpanel", "event_name": "Checkout Completed" },
      "insertion_points": [
        { "file": "src/components/checkout/CheckoutButton.tsx", "line": 42, "role": "action" }
      ]
    },
    {
      "feature_id": "checkout-flow",
      "value_type": "duration",
      "metric_config": { "start_action": "checkout-started", "end_action": "checkout-completed" },
      "title": "Checkout flow duration",
      "description": "Track how long the checkout flow takes from start to completion",
      "confidence": "high",
      "existing_sdk_call": { "sdk": "mixpanel", "event_name": "Checkout Completed" },
      "insertion_points": [
        { "file": "src/components/checkout/CheckoutStart.tsx", "line": 18, "role": "start_action" },
        { "file": "src/components/checkout/CheckoutButton.tsx", "line": 42, "role": "end_action" }
      ]
    }
  ]
}
```

### 7b. Write `.vektis/discover-output.json`

```bash
mkdir -p .vektis
# Write to a temp file first, then rename — atomic on POSIX.
printf '%s\n' "$JSON" > .vektis/discover-output.json.tmp
mv .vektis/discover-output.json.tmp .vektis/discover-output.json
```

If any step fails (permission denied, disk full), abort the write but **do not throw**. Print the JSON in chat with: `Could not write .vektis/discover-output.json (<reason>). Save manually:` followed by the JSON in a fenced block.

### 7c. Idempotently append `.vektis/` to `.gitignore`

```bash
if [ ! -f .gitignore ]; then
  printf '.vektis/\n' > .gitignore
elif ! grep -qE '^\.vektis/?$' .gitignore; then
  # Check trailing newline
  if [ -n "$(tail -c 1 .gitignore)" ]; then
    printf '\n.vektis/\n' >> .gitignore
  else
    printf '.vektis/\n' >> .gitignore
  fi
fi
```

This is idempotent — running again does not duplicate the entry.

### 7d. Print the success message

```
✓ Wrote .vektis/discover-output.json (N candidates).
✓ Added .vektis/ to .gitignore.

Next:
  claude /vektis-instrument    — create Dev Items and insert vektis.track() calls
```

---

## Step 8 — Cancel behavior

When the PM types `cancel`:

- Do not write any file.
- Print `Cancelled. No changes made.` and exit.

---

## Output schema reference

`.vektis/discover-output.json` (`schema_version: 1`):

```typescript
{
  schema_version: 1;
  generated_at: string; // ISO8601 UTC
  candidates: Array<{
    feature_id: string; // lowercase-hyphen, max 200
    value_type: "count" | "percentage" | "duration" | "activity" | "currency";
    metric_config:
      | { action: string } // count
      | { numerator_action: string; denominator_action: string } // percentage
      | { start_action: string; end_action: string } // duration
      | null; // activity, currency
    title: string;
    description: string;
    confidence: "high" | "medium" | "low"; // v1: always "high"
    existing_sdk_call: {
      sdk: "mixpanel" | "segment" | "amplitude" | "posthog" | "ga4";
      event_name: string;
    } | null;
    insertion_points: Array<{
      file: string; // repo-relative
      line: number;
      role: string; // matches a key in metric_config (or "primary" for activity/currency)
    }>;
  }>;
}
```

Schema is bound by:

- 5 `value_type` values: `src/lib/db/types.ts` (`VALUE_TYPES`) — enforced via `z.enum(VALUE_TYPES)` in `src/backend/dev-items/dto/dev-item.dto.ts:124`. The schema column itself is plain `text("value_type")` (`src/lib/db/schema/dev-items.schema.ts:135-141` documents the values in a comment); validation lives at the DTO layer.
- `metric_config` shape per `value_type`: `src/backend/dev-items/dto/dev-item.dto.spec.ts:22-76`
- `feature_id` length cap: `src/backend/dev-items/dto/dev-item.dto.ts:118-123`

Downstream consumers:

- `vektis-instrument` (sibling skill) reads this file to insert `vektis.track()` calls and call `POST /api/dev-items/bulk`.
- `vektis-update` (sibling skill) reads this file to compute the delta on subsequent runs.

---

## Failure modes (never throw)

| Symptom                                   | Behavior                                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------------------------- |
| `package.json` / project root not found   | Print pre-flight error, exit 0.                                                             |
| Scan exceeds 60s on a large monorepo      | Print progress every 15s. Suggest `--scope <path>` to narrow.                               |
| File-write permission denied / disk full  | Print JSON in chat with manual-save instructions. Skip `.gitignore` update.                 |
| `.gitignore` is malformed (binary, huge)  | Skip the append, print: `Could not append .vektis/ to .gitignore — please add it manually.` |
| PM types ambiguous / unrecognized command | Ask for clarification. Do not guess.                                                        |
| Zero candidates after filtering           | Empty-state message (Step 6). Do not write a file.                                          |

---

## What this skill does NOT do

- Modify any customer source file (read-only).
- Insert `vektis.track()` calls — that's `vektis-instrument`.
- Create Dev Items in vektis-app — that's `vektis-instrument`.
- Authenticate with vektis-app — discover is purely local; auth is needed only by `vektis-instrument` and `vektis-update`.
- Detect inferred features (handlers without prior SDK calls) — deferred to a v1.5 follow-up.
- Scan iOS / Android / Python codebases — v1 is web frontend only.
- Detect custom in-house analytics SDKs — v1 covers Mixpanel, Segment, Amplitude, PostHog, GA4.

---

## When to use vektis-discover vs vektis-update

- **First time on a codebase, or after major changes**: `vektis-discover` (full sweep).
- **Periodic re-scan to catch new features added since last run**: `vektis-update` (delta-only — skips already-instrumented features).
- **Brand-new install, nothing set up yet**: `vektis-bootstrap` (orchestrates install + discover + instrument as one command).
