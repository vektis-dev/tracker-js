// Public entry point. Wraps the Tracker class with a singleton instance, a
// pre-init queue (so identify/track called before init are replayed), and the
// page-unload listeners that drive sendBeacon flush.

import { MAX_PRE_INIT_QUEUE } from "./constants.js";
import { logFromCatalog } from "./errors.js";
import { Tracker } from "./tracker.js";
import type {
  EventType,
  TrackData,
  VektisConfig,
  VektisIdentity,
  VektisStatus,
} from "./types.js";

type PreInitCall =
  | { kind: "identify"; id: VektisIdentity }
  | { kind: "track"; eventType: EventType; data: TrackData };

let instance: Tracker | null = null;
let preInitQueue: PreInitCall[] = [];
let listenersAttached = false;

function getInstance(): Tracker {
  if (!instance) instance = new Tracker();
  return instance;
}

function attachUnloadListeners(): void {
  if (listenersAttached) return;
  if (typeof document === "undefined" || typeof window === "undefined") return;

  const handler = () => {
    if (!instance) return;
    // queue.flush() lock means double-fire is safe — sendBeacon path drains
    // synchronously and the lock prevents the fetch path from racing.
    instance.flushBeacon();
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") handler();
  });
  window.addEventListener("pagehide", handler);
  listenersAttached = true;
}

export function init(config: VektisConfig): void {
  const t = getInstance();
  t.init(config);
  attachUnloadListeners();

  // Replay pre-init queue.
  const replay = preInitQueue;
  preInitQueue = [];
  for (const call of replay) {
    if (call.kind === "identify") {
      t.identify(call.id);
    } else {
      t.track(call.eventType, call.data);
    }
  }
}

export function identify(id: VektisIdentity): void {
  if (!instance || instance.getStatus().state === "UNINITIALIZED") {
    enqueuePreInit({ kind: "identify", id });
    logFromCatalog("VEK_TRK_IDENTIFY_BEFORE_INIT", "warn");
    return;
  }
  instance.identify(id);
}

export function track(eventType: EventType, data: TrackData = {}): void {
  if (!instance || instance.getStatus().state === "UNINITIALIZED") {
    enqueuePreInit({ kind: "track", eventType, data });
    return;
  }
  instance.track(eventType, data);
}

export function flush(): Promise<void> {
  if (!instance) return Promise.resolve();
  return instance.flush();
}

export function reset(): void {
  if (!instance) return;
  instance.reset();
  preInitQueue = [];
}

export function getStatus(): VektisStatus {
  if (!instance) {
    return {
      state: "UNINITIALIZED",
      queueLength: preInitQueue.length,
      identityCustomerId: null,
      identityUserId: null,
    };
  }
  const s = instance.getStatus();
  if (s.state === "UNINITIALIZED" && preInitQueue.length > 0) {
    return { ...s, queueLength: preInitQueue.length };
  }
  return s;
}

function enqueuePreInit(call: PreInitCall): void {
  if (preInitQueue.length >= MAX_PRE_INIT_QUEUE) {
    preInitQueue.shift();
    logFromCatalog("VEK_TRK_PRE_INIT_QUEUE_OVERFLOW", "warn", {
      cap: MAX_PRE_INIT_QUEUE,
    });
  }
  preInitQueue.push(call);
}

// Test-only reset (clears module state between tests). Not exported in IIFE
// global since it's prefixed with `_`.
export function _resetForTests(): void {
  if (instance) instance.reset();
  instance = null;
  preInitQueue = [];
  listenersAttached = false;
}

export type { VektisConfig, VektisIdentity, TrackData, VektisStatus, EventType };
