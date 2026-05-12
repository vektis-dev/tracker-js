// Transport layer. Two paths: fetch (normal) and sendBeacon (page unload).
// Both target the same endpoint and same payload shape.

import { MAX_RETRIES, SDK_HEADER } from "./constants.js";
import { logFromCatalog, type ErrorCode } from "./errors.js";
import type { TrackEventsPayload } from "./types.js";

export type SendResult =
  | { ok: true; status: number }
  | { ok: false; kind: "auth"; status: 401 } // 401 → caller transitions to DISABLED
  | { ok: false; kind: "drop"; status: number; code: ErrorCode } // 400/413 → caller drops batch
  | { ok: false; kind: "retries_exhausted"; status: number | null }; // gave up after MAX_RETRIES

export interface TransportOptions {
  endpoint: string;
  apiKey: string;
  debug: boolean;
  /** override sleep for tests; default uses setTimeout */
  sleep?: (ms: number) => Promise<void>;
  /** override fetch for tests */
  fetchFn?: typeof fetch;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function backoffDelay(attempt: number, retryAfterSeconds: number | null): number {
  if (retryAfterSeconds !== null && retryAfterSeconds > 0) {
    return Math.min(retryAfterSeconds * 1000, 60_000);
  }
  // Exponential backoff with jitter: base 1s, cap 30s.
  const base = Math.min(1000 * Math.pow(2, attempt), 30_000);
  const jitter = Math.random() * base * 0.3;
  return Math.floor(base + jitter);
}

function parseRetryAfter(headers: Headers): number | null {
  const raw = headers.get("retry-after");
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  if (Number.isFinite(n) && n >= 0) return n;
  return null;
}

/**
 * Send a batch via fetch with retry on 429 / 503. Caller handles 401/400/413.
 */
export async function sendViaFetch(
  payload: TrackEventsPayload,
  opts: TransportOptions
): Promise<SendResult> {
  const sleep = opts.sleep ?? defaultSleep;
  const fetchFn = opts.fetchFn ?? fetch;

  let lastStatus: number | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let response: Response;
    try {
      response = await fetchFn(opts.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Vektis-Key": opts.apiKey,
          "X-Vektis-SDK": SDK_HEADER,
        },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      lastStatus = null;
      // Network-level failure (CSP block, offline, DNS, etc.). Logged in debug
      // mode only — production stays quiet so flaky networks don't spam the
      // host app's console.
      if (opts.debug) {
        logFromCatalog("VEK_TRK_NETWORK_ERROR", "warn", { error: String(err) });
      }
      // Try again with backoff (no Retry-After since we never got headers).
      if (attempt < MAX_RETRIES) {
        await sleep(backoffDelay(attempt, null));
        continue;
      }
      return { ok: false, kind: "retries_exhausted", status: null };
    }

    lastStatus = response.status;

    if (response.status >= 200 && response.status < 300) {
      return { ok: true, status: response.status };
    }
    if (response.status === 401) {
      logFromCatalog("VEK_TRK_INVALID_API_KEY", "error");
      return { ok: false, kind: "auth", status: 401 };
    }
    if (response.status === 400) {
      logFromCatalog("VEK_TRK_VALIDATION_FAILED", "warn", {
        attempt,
        endpoint: opts.endpoint,
      });
      return { ok: false, kind: "drop", status: 400, code: "VEK_TRK_VALIDATION_FAILED" };
    }
    if (response.status === 413) {
      logFromCatalog("VEK_TRK_BATCH_TOO_LARGE", "warn", { attempt });
      return { ok: false, kind: "drop", status: 413, code: "VEK_TRK_BATCH_TOO_LARGE" };
    }
    if (response.status === 429) {
      const ra = parseRetryAfter(response.headers);
      logFromCatalog("VEK_TRK_RATE_LIMITED", "warn", { attempt, retryAfter: ra });
      if (attempt < MAX_RETRIES) {
        await sleep(backoffDelay(attempt, ra));
        continue;
      }
    }
    if (response.status >= 500 && response.status < 600) {
      logFromCatalog("VEK_TRK_SERVER_ERROR", "warn", {
        attempt,
        status: response.status,
      });
      if (attempt < MAX_RETRIES) {
        await sleep(backoffDelay(attempt, parseRetryAfter(response.headers)));
        continue;
      }
    }
    // Other unexpected status — give up after retries.
    if (attempt < MAX_RETRIES) {
      await sleep(backoffDelay(attempt, null));
      continue;
    }
  }

  return { ok: false, kind: "retries_exhausted", status: lastStatus };
}

/**
 * Send a batch via sendBeacon — the page-unload path. API key rides in the
 * request body (sendBeacon doesn't support custom headers); the URL stays clean
 * so the key never ends up in browser history / server access logs.
 * Returns whether the browser accepted the beacon for queuing; we cannot tell
 * whether the server actually received it.
 */
export function sendViaBeacon(
  payload: TrackEventsPayload,
  opts: TransportOptions
): boolean {
  if (typeof navigator === "undefined" || typeof navigator.sendBeacon !== "function") {
    return false;
  }
  const body = JSON.stringify({ ...payload, key: opts.apiKey });
  const blob = new Blob([body], { type: "application/json" });
  return navigator.sendBeacon(opts.endpoint, blob);
}

/**
 * Last-resort unload-path fallback. Used when sendBeacon returns false (over-size
 * payload, browser-side beacon throttling, sendBeacon unavailable). Fire-and-forget
 * fetch with `keepalive: true` — survives page unload up to the browser's keepalive
 * cap (~64KB per request in Chromium). No retry, no error propagation.
 */
export function sendViaKeepaliveFetch(
  payload: TrackEventsPayload,
  opts: TransportOptions
): void {
  if (typeof fetch === "undefined") return;
  const body = JSON.stringify({ ...payload, key: opts.apiKey });
  try {
    void fetch(opts.endpoint, {
      method: "POST",
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
        "X-Vektis-SDK": SDK_HEADER,
      },
      body,
    }).catch(() => undefined);
  } catch {
    // Some browsers throw synchronously when keepalive payload exceeds the cap.
    // Nothing more we can do at unload; events are lost.
  }
}
