// SDK defaults. Tweaking any of these requires careful thought about server
// behavior (see vanalytics validators/event.schema.ts for the wire contract).

export const SDK_VERSION = "1.0.0";
export const SDK_HEADER = `js/${SDK_VERSION}`;

export const DEFAULT_ENDPOINT = "https://events.vektis.io/api/v1/events";

export const FLUSH_INTERVAL_MS = 5_000;
export const FLUSH_THRESHOLD = 10;

// Server limits (mirror these in validate.ts; sourced from
// @vektis-io/events-schema's trackingEventSchema).
export const MAX_BATCH_SIZE = 100; // events per request
export const MAX_BATCH_BYTES = 480_000; // pre-split guard; server limit is 512KB
export const MAX_PROP_KEYS = 50;
export const MAX_PROP_KEY_LEN = 64;
export const MAX_PROP_VALUE_LEN = 1024;
export const MAX_PROPS_BYTES = 8192;

export const MAX_RETRIES = 5;
export const MAX_PRE_INIT_QUEUE = 1000;

// Local-hostname patterns for the test/live key heuristics.
export const LOCAL_HOSTNAME_PATTERNS = [
  /^localhost$/i,
  /^127\.0\.0\.1$/,
  /\.local$/i,
];
