# vektis-install — Known Limitations (v1)

This document tracks behavior that is intentionally limited in v1, with rationale and follow-up pointers.

## Framework support

### Tier 1 (validated, blocking ship)

- Next.js (App Router)
- Next.js (Pages Router)
- Vite + React

Each has a committed fixture under `e2e/fixtures/install-fixtures/` and is exercised in the geico-simple gate validation.

### Tier 2 (best-effort manual validation)

- Nuxt 3
- SvelteKit
- CRA (Create React App — note: deprecated by Meta in 2023; small but real customer base)
- Vanilla CDN (any HTML site loading the IIFE bundle)

These work in principle (detection logic + init code templates are in `SKILL.md`) but have NOT been validated end-to-end against committed fixtures in v1. If you hit a framework-specific issue, document the workaround here and file a follow-up ticket to add a Tier 2 fixture.

### Out of scope (not in v1)

- iOS / Android (no native SDK ports yet)
- Python / Ruby / Java backends with no frontend (no JS install needed)
- Server-side Node.js apps (no `window` — SDK is browser-only)

## Cut from v1

### `--paste-api-key` advanced mode

Originally proposed: a third onboarding path for security-conscious teams that want to use their own pre-existing SDK API key rather than have one auto-created.

Cut because: adds a third decision branch that weakens the cave-man test (OAuth default + paste-token fallback covers 99% of customers). Customers wanting BYO-key can manually run `echo "NEXT_PUBLIC_VEKTIS_KEY=vk_dev_..." >> .env.local` (or `vk_stg_` / `vk_prd_` per their environment) after `claude /vektis-install --paste-token`.

### Auto-edit of CSP config

Originally proposed: detect `next.config.{js,ts}`, `vercel.json`, `_headers`, Express CSP middleware and offer to add `https://events.vektis.io` to `connect-src`.

Cut because: CSP config functions can compose other headers; auto-edit is fragile and risks breaking custom CSP. Instead the skill prints a pointer to `https://docs.vektis.io/integrations/tracker/csp` (which has copy-paste blocks for 5+ platforms).

### Auto-insertion of `vektis.reset()` at logout sites

Originally proposed: detect logout calls across Clerk, Auth0, NextAuth, Supabase Auth, Firebase Auth, custom handlers and offer to add `vektis.reset()`.

Cut because: detection across 6 auth providers is fragile (high false-positive risk). Customer's first event still works without it (reset only matters for _subsequent_ sessions after logout). Skill prints a pointer to `https://docs.vektis.io/integrations/tracker/reset-on-logout` (snippets for 6+ providers).

### Verification via vanalytics admin endpoint

v1 verification: skill instructs PM to run `vektis.getStatus()` in browser DevTools.

v2 follow-up: call a vanalytics admin endpoint to programmatically confirm `customer.identified` arrived. Requires either a new vanalytics endpoint or reuse of VEK-289's `/api/internal/event-presence`.

## Platform-specific caveats

### Windows file permissions

`chmod 600` on `~/.vektis/credentials.json` is best-effort on Windows. Windows uses ACLs rather than POSIX permissions; the skill silently continues if `chmod` fails. The file inherits ACLs from `~/.vektis/`.

If a customer reports credential leakage on Windows, document the workaround here.

### Windows `expiresAt` computation

`_shared/cli-auth.md` Step F computes `expiresAt` via GNU `date -d` (Linux) with a BSD `date -v` fallback (macOS). Neither works in Git Bash (MINGW) or native PowerShell — both invocations fail and `expiresAt` is left empty. An empty `expiresAt` causes Step A's "expiry in the future" check to fail every run, forcing re-authentication on every skill invocation.

Mitigation today: customer re-auths each run (the OAuth path is fast — ~10s end-to-end). Follow-up: add a `node -e` or `python -c` third fallback in Step F so Windows shells produce a valid ISO8601 timestamp.

### Orphan SDK API keys on partial re-runs

The Step 2 idempotency check requires BOTH `@vektis-io/tracker` in `package.json` AND a `vektis.init(` call in source. If the customer cancels at the init-code diff prompt (Step 5), only the package install + key creation have run — subsequent re-invocations skip the idempotency check and create another `vk_dev_*` key.

Mitigation: orphaned keys can be revoked at `app.vektis.io/settings/api-usage`. Follow-up: persist a `.vektis-install-state.json` or check for any `vk_*` value in `.env.local` before issuing a new key.

### Headless / SSH environments

Browser auto-open via `open` / `xdg-open` / `start` may silently fail on:

- SSH sessions without X11 forwarding
- Docker containers without `DISPLAY`
- Cloud IDEs (Codespaces, Gitpod) that don't honor `xdg-open`

Mitigation: after 60s of polling without success, the skill prompts the customer to switch to `--paste-token` mode. The prompt is in `_shared/cli-auth.md` Step C.3.

### Monorepo edge case

If `package.json` dependencies match multiple frameworks (e.g. a monorepo with both Next.js and Vite roots), the skill prompts the customer to choose. Auto-detection is intentionally conservative.
