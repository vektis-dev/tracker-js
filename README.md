# @vektis-io/tracker

Browser JavaScript SDK for sending engagement events to VEKTIS. Zero runtime dependencies. <8KB gzipped.

**Full documentation:** [docs.vektis.io/integrations/tracker](https://docs.vektis.io/integrations/tracker) — per-framework guides, CSP setup, reset-on-logout snippets, and the complete error catalog.

[VEKTIS](https://vektis.io) helps software teams measure which engineering work actually delivers customer impact. `@vektis-io/tracker` is the browser-side half of the Impact Tracking data path. The SDK is **explicit-call-only** — it never auto-captures clicks, page views, errors, or anything else. The only events on the wire are the ones your code asks it to send. See also: [`@vektis-io/events-schema`](https://www.npmjs.com/package/@vektis-io/events-schema) — the shared schemas the SDK and the server validate against.

## Quick start — script tag (zero customer code)

Generate a **publishable** key (`vk_pub_*`) in the VEKTIS dashboard and drop a single tag into your `<head>`:

```html
<script
  src="https://unpkg.com/@vektis-io/tracker/dist/vektis-tracker.iife.js"
  data-vektis-key="vk_pub_prd_..."
  data-vektis-customer-id="acct_A1"
  data-vektis-user-id="user_123"
  async
></script>
```

The SDK reads its own `data-vektis-*` attributes at load time, calls `init()` and (if `data-vektis-customer-id` is set) `identify()` for you, and exposes a global `vektis` for `track()` calls anywhere in your page code.

Available attributes:

| Attribute | Purpose |
| --- | --- |
| `data-vektis-key` *(required)* | Your publishable key (`vk_pub_*`). |
| `data-vektis-endpoint` | Override the ingest URL. Defaults to `https://events.vektis.io/api/v1/events`. |
| `data-vektis-debug` | Presence enables debug-mode console warnings. `"false"` disables. |
| `data-vektis-customer-id` | If set, triggers `identify({ customer_id })` automatically. |
| `data-vektis-user-id` | Included on `identify()` when `data-vektis-customer-id` is set. |

## Quick start — npm

```bash
npm install @vektis-io/tracker
```

```ts
import { init, identify, track } from "@vektis-io/tracker";

init({ apiKey: process.env.NEXT_PUBLIC_VEKTIS_KEY! });
identify({ customer_id: "acct_A1", user_id: "user_123" });
```

Then call `track()` wherever the user does something you want to measure. The SDK supports being called before `init()` — events are buffered and replayed when `init()` runs.

### React / Next.js (the explicit-init pattern)

If you don't want to import the SDK into every component, initialize once in your app root:

```ts
// app/layout.tsx
"use client";
import { useEffect } from "react";
import * as vektis from "@vektis-io/tracker";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    vektis.init({ apiKey: process.env.NEXT_PUBLIC_VEKTIS_KEY! });
  }, []);
  return <html><body>{children}</body></html>;
}
```

Per-framework guides (Vite, Nuxt, SvelteKit, vanilla CDN) live at [docs.vektis.io/integrations/tracker](https://docs.vektis.io/integrations/tracker).

## Tracking events

VEKTIS uses a constrained event taxonomy — every event maps to one of five `event_type` values. The customer (you) chooses the `feature_id`, which is the identifier you'll see in the VEKTIS dashboard. Pick stable, hyphen- or underscore-separated identifiers (`checkout-button`, `report_builder`).

### Button click — `feature.used`

Fire `feature.used` at the moment the action completes. Use `action` to describe *what* happened and `properties` for context.

```tsx
<button
  onClick={() => {
    vektis.track("feature.used", {
      feature_id: "checkout-button",
      action: "clicked",
      properties: { plan: user.plan, cart_total_cents: cart.totalCents },
    });
    handleCheckout();
  }}
>
  Checkout
</button>
```

### Form submission — `feature.used`

```ts
async function onSubmit(values: ReportFormValues) {
  await api.createReport(values);
  vektis.track("feature.used", {
    feature_id: "report-builder",
    action: "report_generated",
    properties: {
      report_type: values.type,
      num_filters: values.filters.length,
    },
  });
}
```

### Sustained engagement — `feature.engagement`

For "the user is actively using this feature" — dwell time on a dashboard, repeated use within a session, etc. Use `feature.engagement` (not `feature.used`) when you want to distinguish "they invoked it once" from "they're meaningfully using it."

```ts
useEffect(() => {
  if (!isVisible) return;
  const t = setTimeout(() => {
    vektis.track("feature.engagement", {
      feature_id: "dashboard",
      properties: { dwell_time_ms: 30000 },
    });
  }, 30_000);
  return () => clearTimeout(t);
}, [isVisible]);
```

### When to use which event type

| `event_type` | When to send | Required fields |
| --- | --- | --- |
| `feature.used` | A discrete completed action (click, submit, command). One event per invocation. | `feature_id` |
| `feature.engagement` | Sustained use of a feature (dwell time threshold, repeated interaction, prolonged session). | `feature_id` |
| `feature.first_use` | A user's first-ever interaction with this feature. Send once per (customer, user, feature). | `feature_id` |
| `session.active` | Optional. Send once per session if you want session counts in your VEKTIS dashboard. | — |
| `customer.identified` | Emitted automatically by `identify()` — you don't typically call this directly. | — |

### Property caps

`properties` must be a flat record of `string | number | boolean`. The server (and the SDK in debug mode) enforce:

- Max 50 keys
- Key length ≤ 64 chars
- String value length ≤ 1024 chars
- Total JSON ≤ 8 KB

Nested objects, arrays, DOM nodes, and functions are rejected. In debug mode the SDK warns via `VEK_TRK_PROPS_CAP_EXCEEDED` before sending; in production the server validates and returns 400 on violation.

## The queue-before-init contract

`identify()` and `track()` are safe to call before `init()`. The SDK buffers up to 1000 events; when `init()` runs they are replayed in order. If the buffer fills before `init()` is called, the oldest events are dropped and a `VEK_TRK_PRE_INIT_QUEUE_OVERFLOW` warning fires.

This is the contract that makes the script-tag integration work: the global `vektis` exists immediately, but `init()` is deferred until the bundle finishes downloading. Any `vektis.track()` calls during that window are queued and flushed once setup completes.

## Reset on logout

Call `vektis.reset()` when the user logs out so subsequent events aren't attributed to their identity:

```ts
import * as vektis from "@vektis-io/tracker";
// after your auth provider's signOut() resolves:
vektis.reset();
```

Per-auth-provider snippets (Clerk, Auth0, NextAuth, Supabase, Firebase, custom) live at [docs.vektis.io/integrations/tracker/reset-on-logout](https://docs.vektis.io/integrations/tracker/reset-on-logout).

## Configuration reference

```ts
init({
  apiKey: "vk_pub_prd_...",          // required; publishable key
  endpoint: "https://...",            // optional; defaults to events.vektis.io
  flushIntervalMs: 5000,              // optional; auto-flush cadence
  flushThreshold: 10,                 // optional; events queued before forced flush
  allowFullScopeKey: true,            // optional; see below
  debug: false,                       // optional; enables console warnings
});
```

**Publishable keys (`vk_pub_*`) are required for browser use.** Anything else is a server-side key that grants more than ingest access — exposing it to the browser is a leak. The SDK refuses to initialize with a non-publishable key when `allowFullScopeKey: false`. Today the default is `true` (the SDK warns once and continues) so existing customers can roll their integrations forward without breaking. The default will flip to hard refusal in a future major.

### Verifying install

```js
vektis.getStatus();
// → { state: 'READY', queueLength: 0, identityCustomerId: 'acct_A1', identityUserId: 'user_123' }
```

States: `UNINITIALIZED` (no `init()` yet — or refused), `READY` (operating), `DISABLED` (server rejected the key with 401 — generate a new key and call `init()` again).

### Debug mode

```ts
init({ apiKey: "...", debug: true });
```

Adds console warnings for property cap violations, env/hostname mismatches on full-scope keys, and network/CSP failures. **Off by default.** Production stays quiet so flaky networks don't spam the host app's console.

### CSP

If your app uses Content Security Policy, allow the analytics endpoint:

```
connect-src 'self' https://events.vektis.io;
```

## Error reference

Every error the SDK surfaces is registered in a public sub-export:

```ts
import { ERROR_CATALOG, type ErrorCode } from "@vektis-io/tracker/errors";
```

Each entry carries `{ code, message, actionItem, docsAnchor, hypotheses }`. The catalog drives the troubleshooting matrix at [docs.vektis.io/integrations/tracker/troubleshooting](https://docs.vektis.io/integrations/tracker/troubleshooting) and the `claude /vektis-troubleshoot` skill.

## Installing the Claude Code skills

VEKTIS ships a set of [Claude Code skills](https://docs.anthropic.com/en/docs/claude-code) (`vektis-install`, `vektis-troubleshoot`, `vektis-discover`, `vektis-instrument`) that automate end-to-end SDK setup, debug failed events, and instrument analytics calls in your codebase:

```bash
npx @vektis-io/tracker install-skills
```

After install, run `claude /vektis-install` (or any other `/vektis-*` skill) from your project root.

- **`--create`** — create `.claude/skills/` if it doesn't exist.
- **`--force`** — overwrite skills you've edited locally.

Re-running is safe; the script tracks vendor-managed files via a `.vektis-managed` marker and only updates them when this package ships new content.

## What changed recently

- **`session.active` is no longer fired automatically.** Calling `init()` no longer enqueues a `session.active` event behind the scenes. If you want session counts in your VEKTIS dashboard, call `vektis.track("session.active")` explicitly after `identify()`. The `autoSessionActive` config option has been removed.
- **The API key now travels in the request body on the `sendBeacon` (page-unload) path** — no more `?key=` in the URL. Keys never appear in browser history or server access logs.
- **Publishable keys (`vk_pub_*`) are now first-class.** Non-publishable keys still work but trigger a `VEK_TRK_NON_PUBLISHABLE_KEY` warning. Set `allowFullScopeKey: false` to make the warning a hard error.
- **`fetch(..., { keepalive: true })` fallback on unload.** If `sendBeacon` rejects the batch (over-size, throttled), the SDK retries via `fetch` with `keepalive: true` so unload events don't silently disappear.
- **OPTIONS prewarm and production-mode CSP-hint logging have been removed.** Vanalytics caches CORS preflight responses, so the prewarm was redundant; the production CSP-hint was noisy for users on flaky networks. Debug mode still surfaces network errors via `VEK_TRK_NETWORK_ERROR`.

## CDN

For non-bundled / `<script>` usage you can pin to an exact version:

```html
<script src="https://unpkg.com/@vektis-io/tracker@1.2.0/dist/vektis-tracker.iife.js" async></script>
```

jsDelivr is also supported: `https://cdn.jsdelivr.net/npm/@vektis-io/tracker@1.2.0/dist/vektis-tracker.iife.js`.

## API reference

| Method | Description |
| --- | --- |
| `init({ apiKey, endpoint?, flushIntervalMs?, flushThreshold?, allowFullScopeKey?, debug? })` | Initialize the SDK. Call once at app startup, or omit entirely if using the script-tag `data-vektis-*` path. |
| `identify({ customer_id, user_id? })` | Set the identity for subsequent events. Required before `track()`. |
| `track(event_type, { feature_id?, action?, properties? })` | Send an engagement event. `feature.*` events require `feature_id`. |
| `flush()` | Force-flush the queue. Returns `Promise<void>`. |
| `reset()` | Flush, clear identity, return to UNINITIALIZED. Call on logout. |
| `getStatus()` | Inspect state machine + queue + identity. Used by the install skill. |

Event types: `feature.used`, `feature.engagement`, `feature.first_use`, `session.active`, `customer.identified`.

## License

MIT. See [LICENSE](./LICENSE).
