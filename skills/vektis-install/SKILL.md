---
name: vektis-install
description: Install the @vektis-io/tracker SDK in a customer's project — detects framework, authenticates via OAuth (default) or paste-token fallback, auto-creates an SDK API key, writes env vars and init code with diff confirmations. Customer never types or sees the SDK key value.
argument-hint: [--paste-token]
user-invocable: true
---

# vektis-install

Install the `@vektis-io/tracker` SDK end-to-end in the customer's current project. The default path is **OAuth — zero credential pastes**. The fallback (`--paste-token`) is **at most one paste action**. Both paths produce a working install with the customer's first event arriving in vanalytics.

## Hard constraints

- **Never type or display the SDK API key value.** It is auto-created on the customer's behalf and written directly to `.env.local` (or framework-equivalent).
- **Always show a unified diff before writing or modifying customer files.** Customer must confirm.
- **Never auto-edit CSP config files or logout handlers.** Print pointers to docs.vektis.io for those — fragile detection, kept manual in v1.
- **Respect `VEKTIS_API_URL`** — defaults to `https://app.vektis.io`. Customer override allows local dev.

## Resolve `VEKTIS_API_URL`

```bash
VEKTIS_API_URL="${VEKTIS_API_URL:-https://app.vektis.io}"
```

Print the resolved URL only if it differs from the default (signals local dev / preview).

---

## Step 1 — Detect framework

Read `package.json` from the current working directory. If it does not exist, abort with: "No `package.json` found. Run `claude /vektis-install` from your project root."

Scan for framework markers (in priority order):

| Framework              | Marker(s)                                                                |
| ---------------------- | ------------------------------------------------------------------------ |
| Next.js (App Router)   | `"next"` in `dependencies` AND directory `app/` exists                   |
| Next.js (Pages Router) | `"next"` in `dependencies` AND directory `pages/` exists (and no `app/`) |
| Vite + React           | `"vite"` AND `"react"` in dependencies; `vite.config.{ts,js,mjs}` exists |
| Nuxt 3                 | `"nuxt"` in dependencies (^3.0); `nuxt.config.{ts,js}` exists            |
| SvelteKit              | `"@sveltejs/kit"` in dependencies; `svelte.config.{ts,js}` exists        |
| CRA                    | `"react-scripts"` in dependencies                                        |
| Vanilla CDN            | None of the above; an `index.html` exists at root                        |

If multiple match (monorepo edge case), prompt the customer to choose. If none match, surface: "Could not detect a supported framework. Supported: Next.js, Vite + React, Nuxt 3, SvelteKit, CRA, vanilla CDN." Tier 2 frameworks (Nuxt, SvelteKit, CRA, vanilla) — see `KNOWN_LIMITATIONS.md` for caveats.

Print: `Detected framework: <name>`.

---

## Step 2 — Detect existing install (idempotency)

Check whether `@vektis-io/tracker` is already in `package.json` dependencies AND whether any source file imports from the package:

```bash
grep -rEl "vektis-io/tracker" --include="*.{ts,tsx,js,jsx,mjs,svelte,vue,html}" \
  src/ app/ pages/ components/ lib/ 2>/dev/null
```

- If both are true AND the matching file also contains `endpoint:` — print `Already installed — verifying setup.` and jump to **Step 8 (verification)**.
- If the package is installed and a matching file exists BUT `endpoint:` is absent — print `Existing install detected — adding endpoint configuration.` Then run **patch mode**: authenticate (Step 3, skip if `~/.vektis/credentials.json` is valid), create a new API key (Step 4) to obtain `events_url`, write the events URL env var to `.env.local` (Step 5, skip the API key var — already set), then open the existing init file and add `endpoint:` (Step 6, init code only).

---

## Step 3 — Authenticate

Read `.claude/skills/_shared/cli-auth.md` and follow Steps A through F end-to-end.

- Default: OAuth Device Flow.
- If the customer invoked the skill with `--paste-token`, skip OAuth and go straight to the paste-token branch in `_shared/cli-auth.md` Step D.

After `_shared/cli-auth.md` completes, you have:

- `access_token` — the `vkcli_*` bearer in memory
- `~/.vektis/credentials.json` — persisted with `{ token, organizationId, expiresAt }`
- Confirmation: `Authenticated as <email> in <organizationName> org.`

If `_shared/cli-auth.md` Step E surfaced "Ask your admin..." (role !== admin), the skill exits there. Do NOT proceed.

---

## Step 4 — Auto-create the SDK API key

```bash
api_key_response=$(curl -s -w "\n%{http_code}" -X POST \
  "$VEKTIS_API_URL/api/admin/api-keys" \
  -H "Authorization: Bearer $access_token" \
  -H "Content-Type: application/json" \
  -d "{\"label\":\"vektis-install ($framework)\",\"environment\":\"development\"}")

status=$(echo "$api_key_response" | tail -n 1)
body=$(echo "$api_key_response" | sed '$d')

if [ "$status" != "201" ]; then
  echo "Failed to create SDK API key (HTTP $status)."
  echo "Response: $body"
  exit 1
fi

raw_key=$(echo "$body" | jq -r '.rawKey')
events_url=$(echo "$body" | jq -r '.eventsUrl // "https://events.vektis.io"')
```

Default `environment` is **`development`** for v1. Print:

```
Created a DEVELOPMENT API key (vk_dev_*). Rotate to a staging or production key
in app.vektis.io/settings/api-usage before deploying.
```

The `raw_key` (a `vk_dev_*` string) flows into Step 5. **Never print it to the terminal.**

---

## Step 5 — Write env var

Choose env vars per framework:

| Framework              | API key env var          | Events URL env var              | File         |
| ---------------------- | ------------------------ | ------------------------------- | ------------ |
| Next.js (App Router)   | `NEXT_PUBLIC_VEKTIS_KEY` | `NEXT_PUBLIC_VEKTIS_EVENTS_URL` | `.env.local` |
| Next.js (Pages Router) | `NEXT_PUBLIC_VEKTIS_KEY` | `NEXT_PUBLIC_VEKTIS_EVENTS_URL` | `.env.local` |
| Vite + React           | `VITE_VEKTIS_KEY`        | `VITE_VEKTIS_EVENTS_URL`        | `.env.local` |
| Nuxt 3                 | `NUXT_PUBLIC_VEKTIS_KEY` | `NUXT_PUBLIC_VEKTIS_EVENTS_URL` | `.env`       |
| SvelteKit              | `PUBLIC_VEKTIS_KEY`      | `PUBLIC_VEKTIS_EVENTS_URL`      | `.env`       |
| CRA                    | `REACT_APP_VEKTIS_KEY`   | `REACT_APP_VEKTIS_EVENTS_URL`   | `.env.local` |
| Vanilla CDN            | (clipboard paste)        | (printed to terminal — not a secret) | n/a    |

For non-vanilla frameworks:

1. Read the target env file. Check both env vars independently: same value → skip, different value → prompt `${envVar} is already set to a different value. Overwrite? [y/N]`.
2. Show **one unified diff** appending both lines (API key and events URL). Confirm before writing.
3. Append (do not overwrite the file).

Vanilla CDN: no env vars to write — skip to Step 6.

After write, **audit `.gitignore`**: read the file (if it exists) and check whether `.env.local` (or `.env` for Nuxt/SvelteKit) is matched by any line. Match generously — common patterns include the literal filename, `.env*`, `*.local`, and glob variants like `**/.env.local`. If no pattern matches, prompt: `<file> is not gitignored. Add it? [Y/n]`. On Y, show diff and append (ensure trailing newline first).

---

## Step 6 — Insert init code

Per framework. **Always show a unified diff and confirm before writing.**

> **`endpoint` rule:** Every `init()` call must reference the events URL env var written in Step 5. Never hardcode the URL — it must change per environment or promotion breaks event routing.

### Next.js (App Router)

Create `app/_vektis-init.tsx` (small client component) and import it from `app/layout.tsx`:

```tsx
// app/_vektis-init.tsx
"use client";
import { useEffect } from "react";
import { init, identify } from "@vektis-io/tracker";

export function VektisInit() {
  useEffect(() => {
    init({ apiKey: process.env.NEXT_PUBLIC_VEKTIS_KEY!, endpoint: process.env.NEXT_PUBLIC_VEKTIS_EVENTS_URL! });
    // Replace these IDs with your real customer/user identifiers.
    // identify({ customer_id: "acct_REPLACE_ME", user_id: "user_REPLACE_ME" });
  }, []);
  return null;
}
```

Then add `<VektisInit />` inside `<body>` of `app/layout.tsx` and add the matching import.

### Next.js (Pages Router)

Insert at the top of `pages/_app.tsx` (or create one if absent):

```tsx
import { useEffect } from "react";
import { init } from "@vektis-io/tracker";

export default function App({ Component, pageProps }: AppProps) {
  useEffect(() => {
    init({ apiKey: process.env.NEXT_PUBLIC_VEKTIS_KEY!, endpoint: process.env.NEXT_PUBLIC_VEKTIS_EVENTS_URL! });
  }, []);
  return <Component {...pageProps} />;
}
```

### Vite + React

Insert in `src/main.tsx` (or `src/main.jsx`) before the `ReactDOM.createRoot(...).render(...)` call:

```tsx
import { init } from "@vektis-io/tracker";

init({ apiKey: import.meta.env.VITE_VEKTIS_KEY, endpoint: import.meta.env.VITE_VEKTIS_EVENTS_URL });
```

### Nuxt 3

Create `plugins/vektis.client.ts`:

```ts
import { init } from "@vektis-io/tracker";

export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig();
  init({ apiKey: config.public.vektisKey as string, endpoint: config.public.vektisEventsUrl as string });
});
```

Add the runtime config to `nuxt.config.ts`. The complete file fragment (Prettier-stable):

```ts
export default defineNuxtConfig({
  runtimeConfig: {
    public: {
      vektisKey: process.env.NUXT_PUBLIC_VEKTIS_KEY,
      vektisEventsUrl: process.env.NUXT_PUBLIC_VEKTIS_EVENTS_URL,
    },
  },
});
```

### SvelteKit

Create `src/hooks.client.ts`:

```ts
import { init } from "@vektis-io/tracker";
import { PUBLIC_VEKTIS_KEY, PUBLIC_VEKTIS_EVENTS_URL } from "$env/static/public";

init({ apiKey: PUBLIC_VEKTIS_KEY, endpoint: PUBLIC_VEKTIS_EVENTS_URL });
```

### CRA

Insert at the top of `src/index.tsx` (or `src/index.js`):

```tsx
import { init } from "@vektis-io/tracker";

init({ apiKey: process.env.REACT_APP_VEKTIS_KEY!, endpoint: process.env.REACT_APP_VEKTIS_EVENTS_URL! });
```

### Vanilla CDN

Vanilla HTML has no env-var system, so SDK keys cannot be injected at build time.
**Do NOT auto-write the raw API key into HTML** — committing a `vk_dev_*` / `vk_stg_*` / `vk_prd_*` key to a tracked file is a secret leak.

Instead: show the customer the script-tag template with a placeholder, copy the `raw_key` to clipboard via `pbcopy` (macOS) / `xclip` (Linux) / `clip` (Windows), and instruct them to paste it manually. The skill writes the template (no real key) into `<head>` of `index.html`, then surfaces:

```html
<script src="https://unpkg.com/@vektis-io/tracker@1/dist/vektis-tracker.iife.js"></script>
<script>
  vektis.init({ apiKey: "REPLACE_WITH_YOUR_KEY", endpoint: "$events_url" });
</script>
```

After diff confirmation, print: `API key copied to clipboard. Events URL: $events_url. Replace REPLACE_WITH_YOUR_KEY in index.html. Do NOT commit the key — inject it at deploy time via your hosting provider's env or template substitution.`

Note: unpkg accepts major-pin (`@1`) but not semver ranges (`@^1.0.0`) in URLs.

### Install the SDK package

For all frameworks except vanilla CDN, run:

```bash
npm install @vektis-io/tracker@^1.1.0
```

(Or `pnpm add` / `yarn add` / `bun add` based on the customer's lockfile detection.)

---

## Step 7 — Pointer to optional steps (do NOT auto-edit)

For non-vanilla frameworks, substitute `<EVENTS_URL_VAR>` and `<API_KEY_VAR>` with the framework-specific var names from the Step 5 table, then print:

```
Optional next steps (manual):

  1. Set production env vars before deploying
     Add the following to your production environment (Vercel, Netlify, etc.):
       <EVENTS_URL_VAR>=https://events.vektis.io
       <API_KEY_VAR>=(create a production key in app.vektis.io/settings/api-usage)
     Your .env.local holds development values only and is not deployed.

  2. Content Security Policy
     If your app has a CSP config (e.g. next.config.ts headers, vercel.json, _headers,
     Express middleware), add your events URL hostname to your `connect-src` directive.
     Guide: https://docs.vektis.io/integrations/tracker/csp

  3. Reset on logout
     Call `reset()` (imported from `@vektis-io/tracker`) in your logout handler so events
     stop attributing to the previous user.
     Guide: https://docs.vektis.io/integrations/tracker/reset-on-logout
```

v1 does NOT auto-detect or auto-edit these — fragile detection across CSP variants and auth providers. The docs links cover the 5+ CSP platforms and 6+ auth providers.

---

## Step 8 — Verification

Print:

```
Install complete. To verify:

  1. Start your dev server (e.g. `npm run dev`).
  2. Open your app in a browser and open DevTools → Network tab.
  3. Filter by your events hostname (the value of your events URL env var).
  4. Interact with your app (navigate pages, click around).

Expected: POST requests appear with non-401 status codes.

If you see 401: your API key or events URL env var is misconfigured.
If you see no requests: init() did not run — verify your init file is imported.
If requests are blocked (CORS or net::ERR_BLOCKED): check your CSP.
  Guide: https://docs.vektis.io/integrations/tracker/csp

Once you call identify() in your app code, a customer.identified event will
arrive in your analytics dashboard within a few seconds.
```

---

## Failure modes

- **OAuth polling fails for 10 minutes (device_code TTL)** — restart from `_shared/cli-auth.md` Step C.1, OR offer the customer to switch to `--paste-token`.
- **API key creation returns 403** — the customer is not an admin. The role check in `_shared/cli-auth.md` Step E should have caught this before reaching Step 4. If it surfaces here anyway, surface "Ask your admin to run this skill."
- **`.env.local` write fails (permission denied)** — print the diff and the path, instruct the customer to create the file manually.
- **Init code site not found** (e.g. unusual project structure) — prompt the customer for the correct path.
- **Customer cancels mid-flow** — leave `~/.vektis/credentials.json` intact (auth persists), no application files modified yet (all writes are diff-confirmed).

---

## Geico-simple gate (validation)

A non-engineer runs `claude /vektis-install` against a fresh Next.js scaffold:

1. Skill detects Next.js App Router.
2. Skill opens browser; customer clicks Authorize once.
3. Skill creates SDK API key in test env (customer never sees the value).
4. Skill writes `NEXT_PUBLIC_VEKTIS_KEY` and `NEXT_PUBLIC_VEKTIS_EVENTS_URL` to `.env.local` (one diff confirmed).
5. Skill writes `<VektisInit />` to `app/layout.tsx` (diff confirmed).
6. Customer starts dev server, opens DevTools → Network tab, sees POST requests arrive.
7. Customer adds `identify(...)` and sees `customer.identified` arrive in their analytics dashboard.

Total customer actions: 1 browser button click + 3 diff approvals (env vars, init code, optional `.gitignore` add). Time-to-first-event: under 15 minutes.
