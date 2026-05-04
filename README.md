# @vektis-io/tracker

Browser JavaScript SDK for sending engagement events to VEKTIS. Zero runtime dependencies. <5KB gzipped.

[VEKTIS](https://vektis.io) helps software teams measure which engineering work actually delivers customer impact. `@vektis-io/tracker` is the browser-side half of the Impact Tracking data path. See also: [`@vektis-io/events-schema`](https://www.npmjs.com/package/@vektis-io/events-schema) — the shared schemas the SDK and the server validate against.

## Quick Start (Next.js)

```bash
npm install @vektis-io/tracker
```

Add your key to `.env.local`:

```
NEXT_PUBLIC_VEKTIS_KEY=vk_test_...
```

Initialize once in your root layout, identify on auth, and call `track` for engagement events:

```ts
// app/layout.tsx
import { useEffect } from "react";
import * as vektis from "@vektis-io/tracker";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    vektis.init({ apiKey: process.env.NEXT_PUBLIC_VEKTIS_KEY! });
  }, []);
  return <html><body>{children}</body></html>;
}
```

```ts
// somewhere in your auth flow
vektis.identify({ customer_id: "acct_A1", user_id: "user_123" });

// somewhere in a feature handler
vektis.track("feature.used", { feature_id: "reports-dashboard" });
```

**Other frameworks** (Vite, CRA, Nuxt, SvelteKit, vanilla CDN) — see the per-framework guides at [docs.vektis.io/integrations/tracker](https://docs.vektis.io/integrations/tracker) or use the install skill (below) for an automated setup.

## Installing the Claude Code skills

VEKTIS ships a set of [Claude Code skills](https://docs.anthropic.com/en/docs/claude-code) (`vektis-install`, `vektis-troubleshoot`, `vektis-discover`, `vektis-instrument`) that automate end-to-end SDK setup, debug failed events, and instrument analytics calls in your codebase. To get them into your project's `.claude/skills/` directory:

```bash
npx @vektis-io/tracker install-skills
```

After install, run `claude /vektis-install` (or any other `/vektis-*` skill) from your project root.

- **`--create`** — create `.claude/skills/` if it doesn't exist (default behavior is to skip when there's no `.claude/`, with a hint).
- **`--force`** — overwrite skills you've edited locally (by default, the script preserves any skill file you've modified).

Re-running is safe: the script tracks which files came from this package via a `.vektis-managed` marker and only updates them when this package ships new content. Works under npm, pnpm, yarn, and bun. Failure modes (no `.claude/`, permission denied, no project root found) all exit zero with a one-line hint.

The `_shared/` directory under `.claude/skills/` is vendor-controlled — `install-skills` always overwrites it. Don't edit those files; they'll be replaced on the next run. A Claude Code plugin marketplace install path is coming soon as an alternative to this command.

## Test vs Live keys

- `vk_test_…` — for setup verification and local development. Events are tagged `test` server-side and don't count toward production analytics.
- `vk_live_…` — for production. Tagged `live`.

In debug mode, the SDK warns if you mix these (e.g., `vk_live_` on `localhost`, or `vk_test_` on a non-local hostname). Both directions catch a different class of mistake — pay attention to either warning.

## CSP

If your app uses Content Security Policy, allow the analytics endpoint:

```
connect-src 'self' https://events.vektis.io;
```

## Reset on logout

Call `vektis.reset()` when the user logs out so subsequent events aren't attributed to their identity:

```ts
import * as vektis from "@vektis-io/tracker";
// after your auth provider's signOut() resolves:
vektis.reset();
```

Per-auth-provider snippets (Clerk, Auth0, NextAuth, Supabase, Firebase, custom) live at [docs.vektis.io/integrations/tracker/reset-on-logout](https://docs.vektis.io/integrations/tracker/reset-on-logout).

## Verifying install

Open the browser dev console after `init()` and `identify()` and call:

```js
vektis.getStatus();
// → { state: 'READY', queueLength: 0, identityCustomerId: 'acct_A1', identityUserId: 'user_123' }
```

If `state` is `READY` and `identityCustomerId` matches what you passed, the SDK is wired correctly. Other states:
- `UNINITIALIZED` — `init()` was never called
- `DISABLED` — your API key was rejected (401); generate a new one and call `init()` again

## Debug mode

```ts
vektis.init({ apiKey: "...", debug: true });
```

Surfaces extra console messages: property cap violations, key/hostname mismatches, network failures with CSP hints, and CORS preflight failures. Off in production.

## Error catalog

Every error the SDK surfaces is registered in a public sub-export:

```ts
import { ERROR_CATALOG, type ErrorCode } from "@vektis-io/tracker/errors";
```

Each entry has `{ code, message, actionItem, docsAnchor, hypotheses }`. The same catalog drives the troubleshooting matrix at [docs.vektis.io/integrations/tracker/troubleshooting](https://docs.vektis.io/integrations/tracker/troubleshooting) and the `claude /vektis-troubleshoot` skill.

## CDN

For non-bundled / `<script>` usage:

```html
<script src="https://unpkg.com/@vektis-io/tracker@1.0.0/dist/vektis-tracker.iife.js"></script>
<script>
  vektis.init({ apiKey: "vk_live_..." });
  vektis.identify({ customer_id: "acct_A1" });
  vektis.track("feature.used", { feature_id: "reports-dashboard" });
</script>
```

The IIFE bundle exposes the SDK on the global `vektis`. Pin to an exact version in production. jsDelivr is also supported: `https://cdn.jsdelivr.net/npm/@vektis-io/tracker@1.0.0/dist/vektis-tracker.iife.js`.

## API reference

| Method | Description |
| --- | --- |
| `init({ apiKey, endpoint?, flushIntervalMs?, flushThreshold?, autoSessionActive?, debug? })` | Initialize the SDK. Call once at app startup. |
| `identify({ customer_id, user_id? })` | Set the identity for subsequent events. Required before `track()`. |
| `track(event_type, { feature_id?, action?, properties? })` | Send an engagement event. `feature.*` events require `feature_id`. |
| `flush()` | Force-flush the queue. Returns a `Promise<void>`. |
| `reset()` | Flush, clear identity, return to UNINITIALIZED. Call on logout. |
| `getStatus()` | Inspect state machine + queue + identity. Used by the install skill. |

Event types: `feature.used`, `feature.engagement`, `feature.first_use`, `session.active`, `customer.identified`.

## License

MIT. See [LICENSE](./LICENSE).
