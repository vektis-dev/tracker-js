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

> **This path needs a classic `<script>` tag.** `document.currentScript` is `null` for `<script type="module">`, so the SDK cannot find its own attributes in an ESM host (Rails importmap, or any no-build module setup). The SDK warns with `VEK_TRK_AUTOINIT_UNAVAILABLE` when it sees the attributes but can't use them. Load the SDK as a module and bootstrap it explicitly instead — see [Quick start — Rails + importmap](#quick-start--rails--importmap).

## Quick start — Rails + importmap

Rails (importmap-rails + Propshaft) has no build step — every script on the page is a `<script type="module">`. The SDK ships a standalone ESM bundle for exactly this shape, so no bundler, transpiler, or `node_modules` is involved.

### Install

Vendor the SDK into your app:

```bash
bin/importmap pin @vektis-io/tracker --download
```

That downloads `dist/vektis-tracker.esm.js` into `vendor/javascript/`, writes the pin into `config/importmap.rb`, and lets Propshaft serve it. Commit the vendored file. It resolves cleanly because `exports["."]` lists `import` ahead of `browser` — so ESM wins over the IIFE — and the ESM bundle is genuinely standalone: zero runtime dependencies, no bare specifiers, a plain `export { ... }` at the end.

> **Don't vendor the IIFE build.** `dist/vektis-tracker.iife.js` assigns a `window.vektis` global and is not an ES module — importing it gives you no exports at all.

**The `./errors` sub-export needs its own pin.** Importmaps do not resolve subpaths from a parent pin, so `import { ERROR_CATALOG } from "@vektis-io/tracker/errors"` 404s unless you also run:

```bash
bin/importmap pin @vektis-io/tracker/errors --download
```

You can pin from a CDN instead:

```ruby
pin "@vektis-io/tracker", to: "https://ga.jspm.io/npm:@vektis-io/tracker@1.3.0/dist/vektis-tracker.esm.js"
```

Pin an exact version — JSPM URLs don't accept ranges. The trade-off: nothing to commit and nothing to re-vendor on upgrade, but you take a runtime dependency on a third-party origin, lose offline development, and need a `script-src` CSP entry that the vendored path doesn't require.

### Bootstrap — a Stimulus controller

A Stimulus controller is the idiomatic place to start the SDK. Pass the configuration in from your layout as Stimulus values so the key and endpoint stay server-rendered:

```erb
<%# app/views/layouts/application.html.erb %>
<body
  data-controller="vektis"
  data-vektis-api-key-value="<%= Rails.configuration.x.vektis.publishable_key %>"
  data-vektis-endpoint-value="<%= Rails.configuration.x.vektis.endpoint %>"
  data-vektis-customer-id-value="<%= Current.customer_id %>"
  data-vektis-user-id-value="<%= Current.user&.id %>"
  data-vektis-debug-value="<%= Rails.env.development? %>"
>
```

```js
// app/javascript/controllers/vektis_controller.js
import { Controller } from "@hotwired/stimulus";
import { init, identify, getStatus } from "@vektis-io/tracker";

export default class extends Controller {
  static values = {
    apiKey: String,
    endpoint: String,
    customerId: String,
    userId: String,
    debug: Boolean,
  };

  connect() {
    if (getStatus().state !== "UNINITIALIZED") return;
    if (!this.apiKeyValue || !this.customerIdValue) return;

    try {
      init({
        apiKey: this.apiKeyValue,
        endpoint: this.endpointValue || undefined,
        debug: this.debugValue,
      });
      identify({
        customer_id: this.customerIdValue,
        user_id: this.userIdValue || undefined,
      });
    } catch (error) {
      console.warn("Vektis init failed", error);
    }
  }
}
```

Pass `endpoint` as `this.endpointValue || undefined` — an unset Stimulus `String` value is `""`, and the SDK only falls back to its default endpoint on `null`/`undefined`, so an empty string would be used verbatim and every request would fail.

The `try/catch` is not decoration — `init()` throws if `apiKey` is missing or isn't a string, and an uncaught exception in `connect()` takes down every other controller on that element.

If you'd rather use the attribute contract, `initFromDataset(el)` reads the same `data-vektis-*` attributes documented above off any element — in a Stimulus controller, `this.element` — and calls `init()` and `identify()` for you. It's the ESM equivalent of the script-tag path. Use one form or the other, not both.

### Ordering

`init()` first, then `identify()`, and only then `track()`. Once `init()` has run, a `track()` with no identity is dropped with a `VEK_TRK_MISSING_IDENTITY` warning — there is no anonymous fallback.

Calls made *before* `init()` are buffered rather than dropped (see [The queue-before-init contract](#the-queue-before-init-contract)), but they replay in the order they were made. So `track()` → `identify()` → `init()` still drops that first event: the replay reaches `track()` while the tracker has no identity yet. If other controllers can fire `track()` while the page is still booting, make sure `identify()` is queued ahead of them.

### Turbo Drive

Turbo replaces `<body>` without a full page load, so already-evaluated modules are never re-evaluated. The SDK is a module-level singleton, which means the tracker instance, its in-memory identity, the pending queue, and the flush timer all **survive in-app navigation**.

- **Don't re-`init()` on every visit.** `connect()` fires again on each Turbo visit, and a second `init()` logs `VEK_TRK_INIT_TWICE` and **discards the new config** — the original one keeps running. The `getStatus().state !== "UNINITIALIZED"` guard above is what keeps this quiet.
- **You don't need to re-`identify()`.** Identity persists across Turbo visits for the same reason.
- **The unload flush is unaffected.** `init()` attaches `visibilitychange` (on hidden) and `pagehide` listeners once, on `document` and `window` — objects Turbo doesn't replace. They fire on real navigation and tab close, not on Turbo visits. In between, queued events go out on the normal cadence: every 5 seconds, or immediately once 10 events are queued.
- **Call `reset()` on logout.** Identity is in memory only — the SDK writes no cookie, no `localStorage`, no session ID, and no anonymous ID. Wire `reset()` into your sign-out path so the next user on the same browser doesn't inherit the previous identity. `reset()` also clears the stored config, including the API key, and returns the state machine to `UNINITIALIZED`, so the next login needs a fresh `init()` — which the `connect()` guard handles for you.

### Local and self-hosted endpoints

`endpoint` defaults to production (`https://events.vektis.io/api/v1/events`). If you run the ingest server locally or self-host it, you must pass `endpoint` explicitly — the SDK does no environment detection:

```ruby
# config/initializers/vektis.rb
Rails.configuration.x.vektis.endpoint =
  ENV.fetch("VEKTIS_ENDPOINT", "https://events.vektis.io/api/v1/events")
```

### CSP in Rails

If `config/initializers/content_security_policy.rb` is enabled, allow the ingest endpoint:

```
connect-src 'self' https://events.vektis.io;
```

Vendoring via `pin --download` needs no `script-src` change, since the SDK is served from your own origin. A CDN pin does: add `https://ga.jspm.io` (or whichever origin you pinned) to `script-src`.

Nonces need no special handling. `javascript_importmap_tags` already passes `content_security_policy_nonce` to the tags it emits, so the importmap and its module preloads are covered by Rails' own nonce plumbing.

## Quick start — npm

```bash
npm install @vektis-io/tracker
```

Generate a key at [**Settings → API Keys**](https://app.vektis.io/settings/api-keys) in the VEKTIS dashboard, set it as `NEXT_PUBLIC_VEKTIS_KEY` (or the equivalent public env var for your framework), then:

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

Each entry carries `{ code, message, actionItem, docsAnchor, hypotheses }`. The catalog drives the troubleshooting matrix at [docs.vektis.io/integrations/tracker/troubleshooting](https://docs.vektis.io/integrations/tracker/troubleshooting).

## What changed recently

- **`initFromDataset(el?)` bootstraps ESM / importmap hosts.** Script-tag auto-init relies on `document.currentScript`, which is `null` for module scripts — so `data-vektis-*` attributes were silently ignored in Rails importmap and similar no-build ESM setups. The SDK now warns with `VEK_TRK_AUTOINIT_UNAVAILABLE` when it sees the attributes but can't use them, and `initFromDataset()` gives those hosts the same one-liner bootstrap.
- **`session.active` is no longer fired automatically.** Calling `init()` no longer enqueues a `session.active` event behind the scenes. If you want session counts in your VEKTIS dashboard, call `vektis.track("session.active")` explicitly after `identify()`. The `autoSessionActive` config option has been removed.
- **The API key now travels in the request body on the `sendBeacon` (page-unload) path** — no more `?key=` in the URL. Keys never appear in browser history or server access logs.
- **Publishable keys (`vk_pub_*`) are now first-class.** Non-publishable keys still work but trigger a `VEK_TRK_NON_PUBLISHABLE_KEY` warning. Set `allowFullScopeKey: false` to make the warning a hard error.
- **`fetch(..., { keepalive: true })` fallback on unload.** If `sendBeacon` rejects the batch (over-size, throttled), the SDK retries via `fetch` with `keepalive: true` so unload events don't silently disappear.
- **OPTIONS prewarm and production-mode CSP-hint logging have been removed.** Vanalytics caches CORS preflight responses, so the prewarm was redundant; the production CSP-hint was noisy for users on flaky networks. Debug mode still surfaces network errors via `VEK_TRK_NETWORK_ERROR`.

## CDN

For non-bundled / `<script>` usage you can pin to an exact version:

```html
<script src="https://unpkg.com/@vektis-io/tracker@1/dist/vektis-tracker.iife.js" async></script>
```

jsDelivr is also supported: `https://cdn.jsdelivr.net/npm/@vektis-io/tracker@1/dist/vektis-tracker.iife.js`.

## API reference

| Method | Description |
| --- | --- |
| `init({ apiKey, endpoint?, flushIntervalMs?, flushThreshold?, allowFullScopeKey?, debug? })` | Initialize the SDK. Call once at app startup, or omit entirely if using the script-tag `data-vektis-*` path. |
| `initFromDataset(el?)` | Initialize from `data-vektis-*` attributes on `el` (defaults to the first `[data-vektis-key]` element). The ESM/importmap equivalent of the script-tag path. |
| `identify({ customer_id, user_id? })` | Set the identity for subsequent events. Required before `track()`. |
| `track(event_type, { feature_id?, action?, properties? })` | Send an engagement event. `feature.*` events require `feature_id`. |
| `flush()` | Force-flush the queue. Returns `Promise<void>`. |
| `reset()` | Flush, clear identity, return to UNINITIALIZED. Call on logout. |
| `getStatus()` | Inspect state machine + queue + identity. |

Event types: `feature.used`, `feature.engagement`, `feature.first_use`, `session.active`, `customer.identified`.

## License

MIT. See [LICENSE](./LICENSE).
