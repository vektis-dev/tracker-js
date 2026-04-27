// Core tracker — state machine + identity + customer_id injection + debug
// heuristics + getStatus introspection. Transport-agnostic: uses an injected
// `sender` callback so tests can substitute easily.

import {
  DEFAULT_ENDPOINT,
  FLUSH_INTERVAL_MS,
  FLUSH_THRESHOLD,
  LOCAL_HOSTNAME_PATTERNS,
} from "./constants.js";
import { logFromCatalog } from "./errors.js";
import { EventQueue, type FlushSender } from "./queue.js";
import {
  prewarmOptions,
  sendViaBeacon,
  sendViaFetch,
  type TransportOptions,
} from "./transport.js";
import type {
  EventType,
  State,
  TrackData,
  TrackingEvent,
  VektisConfig,
  VektisIdentity,
  VektisStatus,
} from "./types.js";
import { uuidv4 } from "./uuid.js";
import { debugValidateProps } from "./validate.js";

interface TrackerDeps {
  /** Override fetch for tests. */
  fetchFn?: typeof fetch;
  /** Override sleep for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Override hostname-detection for tests. */
  getHostname?: () => string | null;
}

export class Tracker {
  private state: State = "UNINITIALIZED";
  private config: Required<VektisConfig> | null = null;
  private identity: VektisIdentity | null = null;
  private queue: EventQueue | null = null;
  private deps: TrackerDeps;

  constructor(deps: TrackerDeps = {}) {
    this.deps = deps;
  }

  init(config: VektisConfig): void {
    if (this.state !== "UNINITIALIZED") {
      logFromCatalog("VEK_TRK_INIT_TWICE", "warn");
      return;
    }
    if (!config?.apiKey || typeof config.apiKey !== "string") {
      throw new Error("Vektis SDK: init() requires { apiKey: string }");
    }
    this.config = {
      apiKey: config.apiKey,
      endpoint: config.endpoint ?? DEFAULT_ENDPOINT,
      flushIntervalMs: config.flushIntervalMs ?? FLUSH_INTERVAL_MS,
      flushThreshold: config.flushThreshold ?? FLUSH_THRESHOLD,
      autoSessionActive: config.autoSessionActive ?? true,
      debug: config.debug ?? false,
    };

    this.applyKeyHeuristics();

    const transportOpts: TransportOptions = {
      endpoint: this.config.endpoint,
      apiKey: this.config.apiKey,
      debug: this.config.debug,
    };
    if (this.deps.fetchFn) transportOpts.fetchFn = this.deps.fetchFn;
    if (this.deps.sleep) transportOpts.sleep = this.deps.sleep;

    const sender: FlushSender = async (batch) => {
      const result = await sendViaFetch({ events: batch }, transportOpts);
      if (result.ok) return { ok: true };
      if (result.kind === "auth") {
        this.state = "DISABLED";
        return { ok: false, auth: true };
      }
      if (result.kind === "drop") {
        return { ok: false, drop: true };
      }
      return { ok: false };
    };

    this.queue = new EventQueue(sender, {
      flushIntervalMs: this.config.flushIntervalMs,
      flushThreshold: this.config.flushThreshold,
    });

    this.state = "READY";

    // Fire-and-forget OPTIONS prewarm so the first sendBeacon-on-unload doesn't
    // miss the CORS preflight cache.
    void prewarmOptions(transportOpts);

    if (this.config.autoSessionActive) {
      this.enqueueEvent("session.active");
    }
  }

  identify(id: VektisIdentity): void {
    if (!id?.customer_id) {
      throw new Error("Vektis SDK: identify() requires { customer_id: string }");
    }
    if (this.state === "DISABLED") return;
    this.identity = { customer_id: id.customer_id };
    if (id.user_id) this.identity.user_id = id.user_id;

    if (this.state !== "READY") {
      // Pre-init: index.ts queues the call; this branch is defensive.
      logFromCatalog("VEK_TRK_IDENTIFY_BEFORE_INIT", "warn");
      return;
    }
    this.enqueueEvent("customer.identified");
  }

  track(eventType: EventType, data: TrackData = {}): void {
    if (this.state === "DISABLED") return;
    if (this.state !== "READY") {
      // Should not be reachable — index.ts pre-init queue catches calls before init.
      return;
    }
    if (!this.identity) {
      logFromCatalog("VEK_TRK_MISSING_IDENTITY", "warn", { eventType });
      return;
    }
    if (eventType.startsWith("feature.") && !data.feature_id) {
      // Server will 400; warn early in debug.
      if (this.config?.debug) {
        logFromCatalog("VEK_TRK_VALIDATION_FAILED", "warn", {
          reason: "feature.* event missing feature_id",
        });
      }
    }
    debugValidateProps(data.properties, this.config?.debug ?? false);
    this.enqueueEvent(eventType, data);
  }

  flush(): Promise<void> {
    if (!this.queue) return Promise.resolve();
    return this.queue.flush();
  }

  /**
   * Synchronously drain the queue and emit it via sendBeacon. Used by the
   * page-unload listeners. Returns true if at least one beacon was sent.
   */
  flushBeacon(): boolean {
    if (!this.queue || !this.config) return false;
    const events = this.queue.drain();
    if (events.length === 0) return false;
    return sendViaBeacon(
      { events },
      {
        endpoint: this.config.endpoint,
        apiKey: this.config.apiKey,
        debug: this.config.debug,
      }
    );
  }

  reset(): void {
    if (this.queue) {
      void this.queue.flush().catch(() => undefined);
      this.queue.destroy();
      this.queue = null;
    }
    this.identity = null;
    this.config = null;
    this.state = "UNINITIALIZED";
  }

  getStatus(): VektisStatus {
    return {
      state: this.state,
      queueLength: this.queue?.size() ?? 0,
      identityCustomerId: this.identity?.customer_id ?? null,
      identityUserId: this.identity?.user_id ?? null,
    };
  }

  // ---- Internal helpers ----

  private enqueueEvent(eventType: EventType, data: TrackData = {}): void {
    if (!this.queue) return;
    if (!this.identity && eventType !== "session.active") {
      // session.active enqueued at init may run before identify; skip the
      // identity check ONLY for session.active. Other events require identity.
      logFromCatalog("VEK_TRK_MISSING_IDENTITY", "warn", { eventType });
      return;
    }
    const event: TrackingEvent = {
      event_id: uuidv4(),
      event_type: eventType,
      // identity may be null for session.active at init; server requires
      // customer_id, so we use a placeholder that the customer's identify()
      // call will overwrite for subsequent events.
      customer_id: this.identity?.customer_id ?? "anonymous",
      timestamp: new Date().toISOString(),
    };
    if (this.identity?.user_id) event.user_id = this.identity.user_id;
    if (data.feature_id) event.feature_id = data.feature_id;
    if (data.action) event.action = data.action;
    if (data.properties) event.properties = data.properties;
    this.queue.enqueue(event);
  }

  private applyKeyHeuristics(): void {
    if (!this.config?.debug) return;
    const hostname = this.getHostname();
    if (!hostname) return;
    const isLocal = LOCAL_HOSTNAME_PATTERNS.some((p) => p.test(hostname));
    const key = this.config.apiKey;
    if (key.startsWith("vk_test_") && !isLocal) {
      logFromCatalog("VEK_TRK_TEST_KEY_NON_LOCAL", "warn", { hostname });
    }
    if (key.startsWith("vk_live_") && isLocal) {
      logFromCatalog("VEK_TRK_LIVE_KEY_LOCAL", "warn", { hostname });
    }
  }

  private getHostname(): string | null {
    if (this.deps.getHostname) return this.deps.getHostname();
    if (typeof window !== "undefined" && window.location?.hostname) {
      return window.location.hostname;
    }
    return null;
  }

  // Tests-only accessor.
  _stateForTests(): State {
    return this.state;
  }
}
