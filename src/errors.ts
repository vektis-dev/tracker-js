// Canonical error catalog. Single source of truth for every error customers can see.
// Consumed by the SDK (internal logging), the vektis-troubleshoot Claude Code skill
// (VEK-349), and the docs.vektis.io troubleshooting matrix (VEK-350). Codes are
// SemVer-stable: removing or renaming requires a major version bump.

export type ErrorCode =
  | "VEK_TRK_INVALID_API_KEY"
  | "VEK_TRK_VALIDATION_FAILED"
  | "VEK_TRK_RATE_LIMITED"
  | "VEK_TRK_SERVER_ERROR"
  | "VEK_TRK_BATCH_TOO_LARGE"
  | "VEK_TRK_NETWORK_ERROR"
  | "VEK_TRK_MISSING_IDENTITY"
  | "VEK_TRK_INIT_TWICE"
  | "VEK_TRK_IDENTIFY_BEFORE_INIT"
  | "VEK_TRK_PROPS_CAP_EXCEEDED"
  | "VEK_TRK_TEST_KEY_NON_LOCAL"
  | "VEK_TRK_LIVE_KEY_LOCAL"
  | "VEK_TRK_PREWARM_FAILED"
  | "VEK_TRK_PRE_INIT_QUEUE_OVERFLOW";

export interface VektisErrorEntry {
  code: ErrorCode;
  message: string;
  actionItem: string;
  docsAnchor: string;
  hypotheses: readonly string[];
}

const DOCS_BASE = "https://docs.vektis.io/integrations/tracker/troubleshooting";

export const ERROR_CATALOG: Readonly<Record<ErrorCode, VektisErrorEntry>> = Object.freeze({
  VEK_TRK_INVALID_API_KEY: {
    code: "VEK_TRK_INVALID_API_KEY",
    message: "Vektis SDK disabled: API key was rejected (401).",
    actionItem:
      "Generate a new key at vektis.io/settings/api-keys and call vektis.init() again.",
    docsAnchor: `${DOCS_BASE}#invalid-api-key`,
    hypotheses: [
      "API key was revoked or rotated in vektis.io",
      "Wrong key for the environment (vk_test_ vs vk_live_)",
      "Typo or truncation in the env var that holds the key",
    ],
  },
  VEK_TRK_VALIDATION_FAILED: {
    code: "VEK_TRK_VALIDATION_FAILED",
    message: "Server rejected the event batch with a 400 (validation failed).",
    actionItem:
      "Inspect the rejected batch in debug mode; check property caps and feature_id requirements.",
    docsAnchor: `${DOCS_BASE}#validation-failed`,
    hypotheses: [
      "feature.* event missing required feature_id",
      "Properties exceed caps (50 keys, 64-char keys, 1024-char string values, 8KB total)",
      "Timestamp outside the 7-days-past to 1-hour-future window",
      "SDK version drift from server schema",
    ],
  },
  VEK_TRK_RATE_LIMITED: {
    code: "VEK_TRK_RATE_LIMITED",
    message: "Rate limited by the server (429). Backing off and retrying.",
    actionItem:
      "If this persists, reduce flush frequency or check for runaway track() calls.",
    docsAnchor: `${DOCS_BASE}#rate-limited`,
    hypotheses: [
      "Bursty event volume exceeded the per-key limit (10000/min)",
      "Multiple SDK instances on the same page",
      "Upstream IP-level limit (1000/min) hit by shared infra",
    ],
  },
  VEK_TRK_SERVER_ERROR: {
    code: "VEK_TRK_SERVER_ERROR",
    message: "Server returned 5xx. Backing off and retrying.",
    actionItem:
      "Check status.vektis.io for incidents. Events are queued and retried with backoff.",
    docsAnchor: `${DOCS_BASE}#server-error`,
    hypotheses: [
      "Transient server error",
      "Ongoing vanalytics deploy",
      "Upstream dependency (Postgres, Redis) degraded",
    ],
  },
  VEK_TRK_BATCH_TOO_LARGE: {
    code: "VEK_TRK_BATCH_TOO_LARGE",
    message: "Server rejected the batch with 413 (too large). Batch dropped.",
    actionItem:
      "Reduce property payload sizes. The SDK pre-splits at 480KB; hitting this is a defect signal.",
    docsAnchor: `${DOCS_BASE}#batch-too-large`,
    hypotheses: [
      "Single event has properties exceeding 8KB cap",
      "Batch byte-size guard miscounted (file a bug)",
    ],
  },
  VEK_TRK_NETWORK_ERROR: {
    code: "VEK_TRK_NETWORK_ERROR",
    message: "Network request to events.vektis.io failed.",
    actionItem:
      "Verify CSP allows connect-src https://events.vektis.io. Check ad blockers and corporate proxies.",
    docsAnchor: `${DOCS_BASE}#network-error`,
    hypotheses: [
      "Content Security Policy blocks the request",
      "Ad blocker or browser extension blocking analytics",
      "Corporate proxy or firewall",
      "Offline (will auto-retry on online event)",
    ],
  },
  VEK_TRK_MISSING_IDENTITY: {
    code: "VEK_TRK_MISSING_IDENTITY",
    message: "track() called before identify(). Event dropped.",
    actionItem: "Call vektis.identify({ customer_id }) before any track() calls.",
    docsAnchor: `${DOCS_BASE}#missing-identity`,
    hypotheses: [
      "identify() never called",
      "track() fired in an early lifecycle hook before identify resolved",
      "reset() was called and identify() was not re-issued",
    ],
  },
  VEK_TRK_INIT_TWICE: {
    code: "VEK_TRK_INIT_TWICE",
    message: "init() called twice. Subsequent calls are ignored.",
    actionItem:
      "Initialize the SDK once at app startup. Use reset() to clear state between sessions.",
    docsAnchor: `${DOCS_BASE}#init-twice`,
    hypotheses: [
      "Component re-renders triggering init in an effect",
      "HMR re-running init in dev",
      "Multiple bundles importing the SDK independently",
    ],
  },
  VEK_TRK_IDENTIFY_BEFORE_INIT: {
    code: "VEK_TRK_IDENTIFY_BEFORE_INIT",
    message: "identify() called before init(). Queued for replay.",
    actionItem:
      "This is non-fatal — the call is replayed once init() runs. Reorder if you can.",
    docsAnchor: `${DOCS_BASE}#identify-before-init`,
    hypotheses: [
      "Auth provider resolves before app-level init",
      "Race between SSR hydration and client init",
    ],
  },
  VEK_TRK_PROPS_CAP_EXCEEDED: {
    code: "VEK_TRK_PROPS_CAP_EXCEEDED",
    message: "Event properties exceed validation caps.",
    actionItem:
      "Caps: 50 keys max, 64-char keys, 1024-char string values, 8KB total. Trim before sending.",
    docsAnchor: `${DOCS_BASE}#props-cap-exceeded`,
    hypotheses: [
      "Logging an entire object as a property (stringify exceeds 1024)",
      "Too many dynamic keys (e.g., per-item flags)",
      "Properties total exceeds 8KB",
    ],
  },
  VEK_TRK_TEST_KEY_NON_LOCAL: {
    code: "VEK_TRK_TEST_KEY_NON_LOCAL",
    message: "Test API key (vk_test_) used on a non-local hostname.",
    actionItem:
      "Use vk_live_ on production hostnames; vk_test_ is for setup verification on localhost.",
    docsAnchor: `${DOCS_BASE}#test-key-non-local`,
    hypotheses: [
      "Wrong env var wired in production",
      "Stale .env.production committed",
      "Preview deploy using staging key on a non-local URL",
    ],
  },
  VEK_TRK_LIVE_KEY_LOCAL: {
    code: "VEK_TRK_LIVE_KEY_LOCAL",
    message: "Live API key (vk_live_) used on a local hostname.",
    actionItem:
      "Use vk_test_ for local development to avoid dirtying production analytics.",
    docsAnchor: `${DOCS_BASE}#live-key-local`,
    hypotheses: [
      "Production .env loaded in local dev",
      "Forgot to override the env var locally",
    ],
  },
  VEK_TRK_PREWARM_FAILED: {
    code: "VEK_TRK_PREWARM_FAILED",
    message: "OPTIONS preflight prewarm failed. sendBeacon may degrade on first unload.",
    actionItem:
      "Verify CSP and that the endpoint is reachable. Fetch path still works; only first-session unload events are at risk.",
    docsAnchor: `${DOCS_BASE}#prewarm-failed`,
    hypotheses: [
      "Endpoint not reachable yet (DNS, proxy)",
      "CSP blocks OPTIONS",
      "Network glitch at init time",
    ],
  },
  VEK_TRK_PRE_INIT_QUEUE_OVERFLOW: {
    code: "VEK_TRK_PRE_INIT_QUEUE_OVERFLOW",
    message: "Pre-init queue exceeded 1000 entries. Oldest events dropped.",
    actionItem: "Call init() earlier in the app lifecycle.",
    docsAnchor: `${DOCS_BASE}#pre-init-queue-overflow`,
    hypotheses: [
      "Tracking events fired in a long pre-init bootstrap path",
      "init() never called (orphan SDK)",
    ],
  },
});

// Internal logging helper. Routes every SDK warning/error through the catalog
// so consumers (and our own troubleshoot skill) see consistent text.
export type LogLevel = "warn" | "error";

export function logFromCatalog(
  code: ErrorCode,
  level: LogLevel = "warn",
  ctx?: Record<string, unknown>
): void {
  const entry = ERROR_CATALOG[code];
  const prefix = `[Vektis SDK ${code}]`;
  const body = `${entry.message} ${entry.actionItem} (docs: ${entry.docsAnchor})`;
  const args: unknown[] = [prefix, body];
  if (ctx && Object.keys(ctx).length > 0) {
    args.push(ctx);
  }
  if (level === "error") {
    console.error(...args);
  } else {
    console.warn(...args);
  }
}
