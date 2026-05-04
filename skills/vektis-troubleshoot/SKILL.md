---
name: vektis-troubleshoot
description: Diagnose @vektis-io/tracker SDK problems. Given an error code (e.g. VEK_TRK_INVALID_API_KEY) or a free-form symptom (e.g. "events not arriving"), loads the SDK error catalog at runtime and returns ranked hypotheses with concrete fix steps. Never hardcodes error strings — single source of truth is the SDK.
argument-hint: [error-code-or-symptom]
user-invocable: true
---

# vektis-troubleshoot

Diagnose `@vektis-io/tracker` SDK problems. The customer invokes this with either:

- an error code shown in the SDK's debug output (e.g. `claude /vektis-troubleshoot VEK_TRK_INVALID_API_KEY`), OR
- a free-form symptom (e.g. `claude /vektis-troubleshoot "events not arriving"`).

Both inputs are matched against the live `@vektis-io/tracker/errors` catalog at runtime — never hardcoded. The catalog is the single source of truth (per VEK-282); codes are SemVer-stable.

## Hard constraints

- **Never hardcode error codes or messages.** Always load `ERROR_CATALOG` at runtime via the recipe in `_shared/sdk-error-catalog.md`.
- **Never claim certainty.** Output is _ranked hypotheses_ with confidence-shaping language: "most likely", "possible", "less likely". The customer chooses what to investigate first.
- **Never trigger external action.** This skill diagnoses; it does NOT mutate the customer's code, config, or auth state. For mutating fixes (re-auth, re-install), surface the appropriate skill (`vektis-install`).
- **Catalog miss is a soft-fail.** If the input does not match any catalog entry, link to the docs.vektis.io troubleshooting matrix rather than throw.

---

## Step 1 — Parse the input

If the argument matches the regex `^VEK_TRK_[A-Z_]+$`, treat as a **code lookup** (Step 3).

Otherwise treat as a **symptom** (Step 4).

If no argument was provided, prompt:

```
Paste the error code (e.g. VEK_TRK_INVALID_API_KEY) or describe the symptom (e.g. "events not arriving in dashboard"):
```

---

## Step 2 — Load the SDK error catalog

Read `.claude/skills/_shared/sdk-error-catalog.md` and follow its loading recipe.

The SDK is ESM-only — use dynamic `import()` (NOT `require`):

```bash
node --input-type=module -e "import('@vektis-io/tracker/errors').then(m => console.log(JSON.stringify(m.ERROR_CATALOG)))"
```

If that fails (no local install), fall back to:

```bash
npx -y -p @vektis-io/tracker@^1.0.0 -- node --input-type=module -e "import('@vektis-io/tracker/errors').then(m => console.log(JSON.stringify(m.ERROR_CATALOG)))"
```

If both fail, surface the catalog-miss message from `_shared/sdk-error-catalog.md` and stop.

Parse the JSON. `ERROR_CATALOG` is an **object keyed by code** (not an array). Each value has shape `{ code, message, actionItem, docsAnchor, hypotheses[] }`. Look up by `catalog[code]`; iterate via `Object.values(catalog)`.

---

## Step 3 — Code-lookup path

Look up the entry: `entry = catalog[input]`.

If `entry` is undefined: print `Code <input> is not in the catalog.` and proceed to Step 5 (catalog miss).

If match: print in this exact format:

```
Error: <code>
<message>

Action: <actionItem>

Likely causes (most likely first):
  1. <hypotheses[0]>
  2. <hypotheses[1]>
  3. <hypotheses[2]>
  ...

Docs: <docsAnchor>
```

If the action involves re-authenticating or re-installing the SDK, suggest the relevant skill at the end:

```
Next step: run `claude /vektis-install` to re-install and re-authenticate.
```

---

## Step 4 — Symptom-matching path

For each catalog entry, compute a similarity score against the input symptom. Use simple substring matching against `entry.message + " " + entry.hypotheses.join(" ")` plus token-overlap heuristics. No embeddings or external calls.

Surface the top 2-3 candidates ranked by score:

```
Top matches for "<input>":

1. <code>  — likely match because: <one-line rationale tying input tokens to entry tokens>
   <full code-lookup output for this entry, indented>

2. <code>  — possible match because: <rationale>
   <full code-lookup output>

3. <code>  — less likely, but consider if 1 and 2 don't apply:
   <full code-lookup output>
```

If no entry scores above a reasonable threshold (e.g. zero token overlap with all entries), proceed to Step 5.

---

## Step 5 — Catalog miss

Print:

```
No matching error in the catalog. The SDK may have shipped a new error since this skill was published.

Browse all known errors:
  https://docs.vektis.io/integrations/tracker/troubleshooting

If you're seeing this in production, please file an issue:
  https://github.com/vektis-dev/tracker-js/issues
```

Never throw. Always degrade to the docs link. Do NOT inline hardcoded workarounds — that's the principle this skill exists to defend.

---

## Output style

- Lead with the error code or top-match code as the headline.
- Use confidence-shaping language: "most likely", "possible", "less likely". Never absolute.
- Cite the catalog as the source: "From the @vektis-io/tracker/errors catalog..."
- End with a docs link.
- For 1 to 3 hypotheses: numbered list. For 4 or more: cap at 3 to avoid overload, mention "...and more in docs".

---

## Failure modes

- **Catalog load fails** (no `node`, no `npx`, sandboxed env) — surface Step 5 (catalog miss) with a note: "Could not load the SDK catalog locally — pointing you at docs."
- **Input ambiguous** (e.g. just "broken") — prompt for more detail rather than emit unranked top-N.
- **Catalog version mismatch** — the runtime catalog is the source of truth; trust it. If a customer reports a code that the live catalog doesn't have, they may be on an older SDK; suggest `npm install @vektis-io/tracker@latest`.
