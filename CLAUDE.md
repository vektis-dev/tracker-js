# `@vektis-io/tracker`

Browser JavaScript SDK that POSTs engagement events from customer products to `https://events.vektis.io/api/v1/events`. Zero runtime dependencies, <5KB gzipped target. Published to npm via Trusted Publishing (OIDC) per [ADR 004](https://github.com/vektis-dev/knowledge-base/blob/main/vektis-claude-project-context/decisions/004-npm-publishing-trusted-publishing.md).

Origin: [VEK-282](https://linear.app/vektis/issue/VEK-282). First release: `1.0.0` on 2026-04-27.

## Common Commands

```bash
npm install                # install deps (zero runtime deps; @vektis-io/events-schema is devDep only)
npm run typecheck          # tsc --noEmit
npm test                   # jest with jsdom env (unit + contract tests)
npm run test:integration   # TRACKER_INTEGRATION=1 jest, runs against local vanalytics on :3333
npm run build              # tsup (ESM + IIFE + .d.ts + errors sub-export)
npm run smoke              # load dist artifacts in Node; assert public API + error catalog
npm run size               # size-limit: ESM bundle gzipped < 8KB hard cap
```

## Architecture

- **Error catalog (`src/errors.ts`)** — single source of truth for every error customers can see. Public sub-export at `@vektis-io/tracker/errors` consumed by the docs.vektis.io troubleshooting matrix ([VEK-350](https://linear.app/vektis/issue/VEK-350)). Codes are SemVer-stable.
- **Tracker class (`src/tracker.ts`)** — transport-agnostic state machine (UNINITIALIZED → READY → DISABLED), identity context, customer_id injection, debug heuristics (vk_test on non-local + vk_live on localhost), getStatus introspection. Sender is injected for testability.
- **Queue (`src/queue.ts`)** — batch buffer, flushing lock (concurrent flush() shares one in-flight promise), 100-event split, 480KB byte-size pre-split (server limit 512KB), offline/online handling, drain() for sendBeacon path.
- **Transport (`src/transport.ts`)** — fetch (normal, key in `X-Vektis-Key` header) + sendBeacon (page unload, key in request body — sendBeacon can't set headers, URL stays clean) + `fetch(..., { keepalive: true })` fallback when sendBeacon rejects the batch (over-size/throttled) + retry with exp backoff/jitter + Retry-After parsing. No OPTIONS prewarm (vanalytics caches CORS preflight) and no production-mode CSP-hint logging — both removed; debug mode still surfaces `VEK_TRK_NETWORK_ERROR`.
- **Public API (`src/index.ts`)** — pre-init queue (1000-cap, drop-oldest, replay on init), visibilitychange:hidden + pagehide listeners.
- **Build tool: tsup.** Outputs `vektis-tracker.esm.js`, `vektis-tracker.iife.js` (global `vektis`), errors sub-export bundle, and `.d.ts`. Mirror of `@vektis-io/events-schema`'s tsup config with adapted format set.

## Directory Structure

```
src/                          See Architecture for per-file responsibilities
  index.ts, types.ts, constants.ts, errors.ts, tracker.ts,
  queue.ts, transport.ts, uuid.ts, validate.ts
__tests__/
  errors|uuid|validate|transport|queue|tracker|index.test.ts   Unit
  contract.test.ts                  SDK payloads pass @vektis-io/events-schema
  integration.test.ts               E2E against local vanalytics (TRACKER_INTEGRATION=1)
scripts/
  smoke-build.mjs       Post-build smoke against dist artifacts (API + error catalog)
.github/workflows/
  ci.yml          PR + non-main push: typecheck + test + build + size + dry-run (guarded vs published version)
  release.yml     Tag v*: OIDC publish via Trusted Publishing + provenance
  integration.yml main push or workflow_dispatch: services-block integration test
```

> `scripts/live-verify/` is intentionally **not** in git — Playwright + production secrets. Local-only convenience for the [Live Verification Runbook](https://github.com/vektis-dev/knowledge-base/blob/main/Operations/technical-setup/browser-sdk-live-verification-runbook.md).

## Reuse / cross-package contracts

- **`@vektis-io/events-schema`** is the schema source of truth (devDep only — never bundled into customer-shipped code; verified by `package.json#exports` excluding it from runtime deps). Used by `validate.ts` (debug-mode props caps) and `__tests__/contract.test.ts` (SDK-generated-payload validation).
- **vanalytics CORS contract** — `events.vektis.io` responds with reflected origin + `Access-Control-Allow-Credentials: true` per the fix landed during VEK-282 verification. Without this, sendBeacon fails customer-wide. See `vanalytics/server/src/middleware/cors.ts` and the [Browser SDK Live Verification Runbook](https://github.com/vektis-dev/knowledge-base/blob/main/Operations/technical-setup/browser-sdk-live-verification-runbook.md).

## Common False Positives

| Pattern | Why it looks wrong | Why it's correct |
| --- | --- | --- |
| `@vektis-io/tracker@0.0.1` exists on npm under `bootstrap` dist-tag | Looks like an accidental publish | Bootstrap placeholder for npm Trusted Publishing cold-start (see [npm runbook](https://github.com/vektis-dev/knowledge-base/blob/main/Operations/technical-setup/npm-package-publishing-runbook.md)). Deprecated, never on `latest`. |
| `--provenance=false` in any local publish command | Looks like a security regression | Required to override `publishConfig.provenance: true` when token-publishing locally for the bootstrap. OIDC release path still emits provenance. |
| `actions/checkout@v6` and `actions/setup-node@v6` (not @v4) | Inconsistent with older repos | Bumped pre-emptively for the Node.js 20 → 24 forced migration on June 2, 2026. Same fix needs to land in `events-schema` ([VEK-354](https://linear.app/vektis/issue/VEK-354)). |
| Integration test pinned to `node` jest environment, not `jsdom` | Inconsistent with the rest of `__tests__/` | jsdom strips Node's native `fetch` global, breaking integration tests that need real network. The `/** @jest-environment node */` directive at the top of `integration.test.ts` is intentional. |
| Live-verify harness uses synthetic event dispatch, not navigation | Doesn't match real-browser unload behavior | Playwright's `page.goto('about:blank')` + `context.close()` abort in-flight beacons in both headless and headed mode. Synthetic dispatch (`Object.defineProperty(document, 'visibilityState')` + `dispatchEvent`) is the workaround. Real browsers are MORE forgiving than Playwright at unload, so a pass on the harness implies pass in production. See the [Live Verification Runbook](https://github.com/vektis-dev/knowledge-base/blob/main/Operations/technical-setup/browser-sdk-live-verification-runbook.md). |

## Cross-references

- npm publishing mechanics: [npm Package Publishing Cold-Start Runbook](https://github.com/vektis-dev/knowledge-base/blob/main/Operations/technical-setup/npm-package-publishing-runbook.md)
- Pre-stable verification: [Browser SDK Live Verification Runbook](https://github.com/vektis-dev/knowledge-base/blob/main/Operations/technical-setup/browser-sdk-live-verification-runbook.md)
- ADR for OIDC publishing: [ADR 004](https://github.com/vektis-dev/knowledge-base/blob/main/vektis-claude-project-context/decisions/004-npm-publishing-trusted-publishing.md)
- Companion ticket to VEK-282: [VEK-350](https://linear.app/vektis/issue/VEK-350) (docs site section)
