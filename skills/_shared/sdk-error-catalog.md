# Shared: SDK Error Catalog Loading (VEK-282)

**Reference doc** — not an invokable skill. Read this file when a customer-facing skill needs to consume the `@vektis-io/tracker/errors` catalog. Consumed by `vektis-troubleshoot` (VEK-349); may be consumed by future analytics-debug skills.

The catalog is the single source of truth for every error a customer can see from the SDK. Every entry has a stable `code`, human-readable `message`, customer-facing `actionItem`, `docsAnchor` link, and ranked `hypotheses[]`. **Never hardcode error codes or messages** — load the catalog at runtime so the skill stays in sync as the SDK evolves.

Codes are SemVer-stable per VEK-282 AC: removing or renaming a code requires a major version bump and a coordinated skill update.

---

## Loading the catalog at runtime

The SDK is an **ESM-only package** (`"type": "module"` in its package.json). Dynamic `import()` is required — `require()` will fail with `ERR_PACKAGE_PATH_NOT_EXPORTED`. The skill instructs Claude to run:

```bash
node --input-type=module -e "import('@vektis-io/tracker/errors').then(m => console.log(JSON.stringify(m.ERROR_CATALOG)))"
```

This works in two environments:

1. **Customer codebase** (the typical case) — `@vektis-io/tracker` is installed as a dependency by `vektis-install`. The dynamic import resolves from `node_modules/`.
2. **Customer codebase without the SDK installed** — fall back to a quick npx-based load:
   ```bash
   npx -y -p @vektis-io/tracker@^1.0.0 -- node --input-type=module -e "import('@vektis-io/tracker/errors').then(m => console.log(JSON.stringify(m.ERROR_CATALOG)))"
   ```
   Slower (downloads the package), but works without modifying the customer's project.

If both fail, treat as **Catalog miss** (see below).

---

## Catalog shape

`ERROR_CATALOG` is an **object keyed by code**, not an array. Look up an entry with `ERROR_CATALOG[code]`. Iterate via `Object.values(ERROR_CATALOG)` or `Object.entries(ERROR_CATALOG)`.

Each entry:

```typescript
type ErrorEntry = {
  code: string; // e.g. "VEK_TRK_INVALID_API_KEY"
  message: string; // human-readable summary
  actionItem: string; // what the customer should do
  docsAnchor: string; // e.g. "https://docs.vektis.io/integrations/tracker/troubleshooting#invalid-api-key"
  hypotheses: string[]; // ranked likely root causes (most likely first)
};
```

The `code` field uses the `VEK_TRK_*` namespace per VEK-282. The runtime load is the source of truth — never hardcode the catalog list in skill output, this doc, or downstream consumers.

---

## Code lookup (exact match)

When the customer provides a known code (e.g. `claude /vektis-troubleshoot VEK_TRK_INVALID_API_KEY`):

1. Load the catalog (above).
2. Look up the entry: `entry = ERROR_CATALOG[input]`. Returns `undefined` if no match.
3. Print `message` (header), `actionItem`, `hypotheses` (numbered), `docsAnchor` (footer link).

```
Error: VEK_TRK_INVALID_API_KEY
The SDK rejected your API key (HTTP 401).

Action: Generate a new key at app.vektis.io/settings/api-usage and call vektis.init() again.

Likely causes (most likely first):
  1. The API key was revoked or rotated.
  2. The key was issued for a different organization.
  3. The key was issued for live but used in test (or vice versa).

Docs: https://docs.vektis.io/integrations/tracker/troubleshooting#invalid-api-key
```

---

## Symptom matching (free-form input)

When the customer describes the problem in prose (e.g. `claude /vektis-troubleshoot "events not arriving"`):

1. Load the catalog.
2. Iterate via `Object.values(ERROR_CATALOG)`. For each entry, score similarity between input and `entry.message + " " + entry.hypotheses.join(" ")`. Use simple substring + token-overlap heuristics; no embeddings needed.
3. Surface top 2-3 candidate codes with rationale, then walk through each (same format as code lookup).

```
Top candidates for "events not arriving":

1. VEK_TRK_NETWORK_BLOCKED  (likely match: CSP / firewall blocking events.vektis.io)
   <full breakdown as above>

2. VEK_TRK_INVALID_API_KEY  (possible match: SDK silently disabled after 401)
   <full breakdown>

3. VEK_TRK_MISSING_IDENTITY  (possible match: track() before identify() — events dropped)
   <full breakdown>
```

---

## Catalog miss

If the input code does not match any catalog entry, AND no symptom match scores above the threshold:

```
No matching error in the catalog. The SDK may have shipped a new error since this skill was published.

Browse all known errors: https://docs.vektis.io/integrations/tracker/troubleshooting

If you're seeing this code in the wild, please file an issue at https://github.com/vektis-dev/tracker-js/issues
so we can update the troubleshooting matrix.
```

Never throw on catalog miss — degrade gracefully to the docs link.

---

## Reference (vektis-app source-of-truth)

- VEK-282 ticket: defines the catalog contract (`code`, `message`, `actionItem`, `docsAnchor`, `hypotheses[]`)
- `@vektis-io/tracker@^1.0.0` published on npm
- `@vektis-io/tracker/errors` sub-export — runtime catalog
- `https://docs.vektis.io/integrations/tracker/troubleshooting` — auto-generated from the same catalog (per VEK-350)
