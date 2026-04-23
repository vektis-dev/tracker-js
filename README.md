# @vektis-io/tracker

Browser JavaScript SDK for sending engagement events to VEKTIS.

> **Under construction.** This package is not yet published. Implementation tracked in [VEK-282](https://linear.app/vektis/issue/VEK-282). Repository setup tracked in [VEK-341](https://linear.app/vektis/issue/VEK-341).
>
> Until v1.0.0 ships, this repo contains only scaffolding.

## What this will be

A zero-dependency, <5KB gzipped browser SDK that customers install via npm or CDN:

```js
import * as vektis from '@vektis-io/tracker';

vektis.init({ apiKey: 'vk_live_...' });
vektis.identify({ customer_id: 'acct_A1' });
vektis.track('feature.used', { feature_id: 'reports-dashboard' });
```

Events POST to the VEKTIS analytics ingestion API at `https://events.vektis.io/api/v1/events`.

## About `@vektis-io`

[VEKTIS](https://vektis.io) helps software teams measure which engineering work actually delivers customer impact. `@vektis-io/tracker` is the browser-side half of the Impact Tracking data path. See also: [`@vektis-io/events-schema`](https://www.npmjs.com/package/@vektis-io/events-schema) — the shared Zod schemas both tracker-js and the server use to validate event payloads.

## License

MIT. See [LICENSE](./LICENSE).
