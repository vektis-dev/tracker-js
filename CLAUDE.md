# `@vektis-io/tracker`

Browser JavaScript SDK that POSTs engagement events from customer products to `https://events.vektis.io/api/v1/events`. Zero runtime dependencies, <5KB gzipped target. Published to npm via Trusted Publishing (OIDC) per [ADR 004](https://github.com/vektis-dev/knowledge-base/blob/main/vektis-claude-project-context/decisions/004-npm-publishing-trusted-publishing.md).

Origin: [VEK-282](https://linear.app/vektis/issue/VEK-282). First release: `1.0.0` on 2026-04-27. `1.1.0` on 2026-05-04 added the Claude Code skill distribution path ([VEK-382](https://linear.app/vektis/issue/VEK-382) Path A).

## Common Commands

```bash
npm install                # install deps (zero runtime deps; @vektis-io/events-schema is devDep only)
npm run typecheck          # tsc --noEmit
npm test                   # jest with jsdom env (~97 unit + contract + black-box CLI tests)
npm run test:integration   # TRACKER_INTEGRATION=1 jest, runs against local vanalytics on :3333
npm run build              # tsup (ESM + IIFE + .d.ts + errors sub-export) THEN bundle skills/ → dist/skills/
npm run bundle:skills      # just the skill bundle step (writes dist/skills/MANIFEST.json with sha256 hashes)
npm run smoke              # load dist artifacts in Node; assert public API + error catalog + skill bundle
npm run size               # size-limit: ESM bundle gzipped < 8KB hard cap
npx @vektis-io/tracker install-skills [--create] [--force]   # customer-facing skill installer
```

## Architecture

- **Error catalog (`src/errors.ts`)** — single source of truth for every error customers can see. Public sub-export at `@vektis-io/tracker/errors` consumed by the `vektis-troubleshoot` Claude Code skill ([VEK-349](https://linear.app/vektis/issue/VEK-349)) and the docs.vektis.io troubleshooting matrix ([VEK-350](https://linear.app/vektis/issue/VEK-350)). Codes are SemVer-stable.
- **Tracker class (`src/tracker.ts`)** — transport-agnostic state machine (UNINITIALIZED → READY → DISABLED), identity context, customer_id injection, debug heuristics (vk_test on non-local + vk_live on localhost), getStatus introspection. Sender is injected for testability.
- **Queue (`src/queue.ts`)** — batch buffer, flushing lock (concurrent flush() shares one in-flight promise), 100-event split, 480KB byte-size pre-split (server limit 512KB), offline/online handling, drain() for sendBeacon path.
- **Transport (`src/transport.ts`)** — fetch (normal) + sendBeacon (page unload, with `?key=` query param) + retry with exp backoff/jitter + Retry-After parsing + OPTIONS prewarm + production-mode CSP-hint cap (single console.error per page-load on first network failure).
- **Public API (`src/index.ts`)** — pre-init queue (1000-cap, drop-oldest, replay on init), visibilitychange:hidden + pagehide listeners, OPTIONS prewarm at init.
- **Skill distribution (`bin/` + `scripts/bundle-skills.mjs`)** — `npm run build` bundles `skills/` → `dist/skills/` with a `MANIFEST.json` of per-file sha256 hashes. Customers run `npx @vektis-io/tracker install-skills` (entry: `bin/tracker.mjs` → `bin/install-skills.mjs`); copies skills into the project's `.claude/skills/` and writes a `.vektis-managed` marker. Idempotent: matching sha → skip; differing sha → overwrite *our* content; no marker → preserve customer edits with a one-line log. All failure modes (no `.claude/`, EACCES, no project root) exit 0 with a doc-link hint.
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
  bundle-skills.test.ts             dist/skills/ + MANIFEST.json after build
  install-skills.test.ts            Black-box CLI via child_process.spawn (21 cases)
bin/
  tracker.mjs           npx subcommand router (install-skills | --help)
  install-skills.mjs    Walks INIT_CWD up for project root; copy + .vektis-managed marker
scripts/
  bundle-skills.mjs     Thin entry; calls scripts/lib/bundle-skills.mjs
  lib/bundle-skills.mjs Copy skills/ → dist/skills/ + write MANIFEST.json (sha256)
  smoke-build.mjs       Post-build smoke against dist artifacts (API + error catalog + skill bundle)
skills/                 SOURCE OF TRUTH (committed). Shipped only via dist/skills/ in tarball.
  _shared/              cli-auth.md, sdk-error-catalog.md (referenced by 3 of 4 skills)
  vektis-install/       SKILL.md + KNOWN_LIMITATIONS.md
  vektis-instrument/    SKILL.md + INSERTION_RULES.md
  vektis-discover/      SKILL.md
  vektis-troubleshoot/  SKILL.md
.github/workflows/
  ci.yml          PR + non-main push: typecheck + test + build + size + dry-run (guarded vs published version)
  release.yml     Tag v*: OIDC publish via Trusted Publishing + provenance
  integration.yml main push or workflow_dispatch: services-block integration test
```

> `scripts/live-verify/` is intentionally **not** in git — Playwright + production secrets. Local-only convenience for the [Live Verification Runbook](https://github.com/vektis-dev/knowledge-base/blob/main/Operations/technical-setup/browser-sdk-live-verification-runbook.md).

## Reuse / cross-package contracts

- **`@vektis-io/events-schema`** is the schema source of truth (devDep only — never bundled into customer-shipped code; verified by `package.json#exports` excluding it from runtime deps). Used by `validate.ts` (debug-mode props caps) and `__tests__/contract.test.ts` (SDK-generated-payload validation).
- **vanalytics CORS contract** — `events.vektis.io` responds with reflected origin + `Access-Control-Allow-Credentials: true` per the fix landed during VEK-282 verification. Without this, sendBeacon fails customer-wide. See `vanalytics/server/src/middleware/cors.ts` and the [Browser SDK Live Verification Runbook](https://github.com/vektis-dev/knowledge-base/blob/main/Operations/technical-setup/browser-sdk-live-verification-runbook.md).
- **`skills/` is the source of truth for VEKTIS Claude Code skills.** `vektis-app` symlinks back to this directory so VEKTIS engineers see all skills in their local Claude Code session — drift is structurally impossible.

## Common False Positives

| Pattern | Why it looks wrong | Why it's correct |
| --- | --- | --- |
| `@vektis-io/tracker@0.0.1` exists on npm under `bootstrap` dist-tag | Looks like an accidental publish | Bootstrap placeholder for npm Trusted Publishing cold-start (see [npm runbook](https://github.com/vektis-dev/knowledge-base/blob/main/Operations/technical-setup/npm-package-publishing-runbook.md)). Deprecated, never on `latest`. |
| `--provenance=false` in any local publish command | Looks like a security regression | Required to override `publishConfig.provenance: true` when token-publishing locally for the bootstrap. OIDC release path still emits provenance. |
| `actions/checkout@v6` and `actions/setup-node@v6` (not @v4) | Inconsistent with older repos | Bumped pre-emptively for the Node.js 20 → 24 forced migration on June 2, 2026. Same fix needs to land in `events-schema` ([VEK-354](https://linear.app/vektis/issue/VEK-354)). |
| Integration test pinned to `node` jest environment, not `jsdom` | Inconsistent with the rest of `__tests__/` | jsdom strips Node's native `fetch` global, breaking integration tests that need real network. The `/** @jest-environment node */` directive at the top of `integration.test.ts` is intentional. |
| `skills/` lives at repo top-level, not under `src/` | Looks like dev-only files leaking into the customer dir | `package.json#files` ships only `dist/`, `bin/`, `README.md`, `LICENSE`. Skill source is bundled into `dist/skills/` at build time and shipped from there — top-level keeps the editing surface obvious for engineers and lets `vektis-app` symlink back without fishing into `src/`. |
| `__tests__/install-skills.test.ts` runs the CLI via `child_process.spawn` | Inconsistent with the rest of the Jest suite | Black-box on purpose. Avoids invasive Jest ESM-mode changes that would touch all 8 existing test files. 21 cases, 97/97 total passing. |
| No `postinstall` script that auto-installs skills | Looks like an oversight ("isn't that the point?") | Deliberate. pnpm 10+, yarn berry, and bun all block lifecycle scripts by default in 2026 — postinstall would silently skip for ~half the customer base. Customers run `npx @vektis-io/tracker install-skills` explicitly. Best-effort postinstall *hint* is deferred to VEK-382c. |
| Live-verify harness uses synthetic event dispatch, not navigation | Doesn't match real-browser unload behavior | Playwright's `page.goto('about:blank')` + `context.close()` abort in-flight beacons in both headless and headed mode. Synthetic dispatch (`Object.defineProperty(document, 'visibilityState')` + `dispatchEvent`) is the workaround. Real browsers are MORE forgiving than Playwright at unload, so a pass on the harness implies pass in production. See the [Live Verification Runbook](https://github.com/vektis-dev/knowledge-base/blob/main/Operations/technical-setup/browser-sdk-live-verification-runbook.md). |

## Cross-references

- npm publishing mechanics: [npm Package Publishing Cold-Start Runbook](https://github.com/vektis-dev/knowledge-base/blob/main/Operations/technical-setup/npm-package-publishing-runbook.md)
- Pre-stable verification: [Browser SDK Live Verification Runbook](https://github.com/vektis-dev/knowledge-base/blob/main/Operations/technical-setup/browser-sdk-live-verification-runbook.md)
- ADR for OIDC publishing: [ADR 004](https://github.com/vektis-dev/knowledge-base/blob/main/vektis-claude-project-context/decisions/004-npm-publishing-trusted-publishing.md)
- Skill distribution: [VEK-382](https://linear.app/vektis/issue/VEK-382) (Path A npx; plugin marketplace = VEK-382b; postinstall hint = VEK-382c)
- Companion tickets to VEK-282: [VEK-349](https://linear.app/vektis/issue/VEK-349) (skills), [VEK-350](https://linear.app/vektis/issue/VEK-350) (docs site section)
