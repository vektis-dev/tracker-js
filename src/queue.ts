// Event queue with batching, flushing lock, byte-size-aware splitting, and
// offline buffering. Hands batches off to a transport-callback supplied by the
// tracker layer (so this module stays transport-agnostic and easy to test).

import { MAX_BATCH_BYTES, MAX_BATCH_SIZE } from "./constants.js";
import type { TrackingEvent } from "./types.js";

export type FlushSender = (
  batch: TrackingEvent[]
) => Promise<{ ok: boolean; drop?: boolean; auth?: boolean }>;

export interface QueueOptions {
  flushIntervalMs: number;
  flushThreshold: number;
  /** Override navigator.onLine for tests. */
  isOnline?: () => boolean;
}

export class EventQueue {
  private events: TrackingEvent[] = [];
  private flushing = false;
  private flushPromise: Promise<void> | null = null;
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private onlineHandler: (() => void) | null = null;

  constructor(
    private readonly sender: FlushSender,
    private readonly opts: QueueOptions
  ) {
    // Re-flush when the browser comes back online.
    this.onlineHandler = () => {
      if (!this.destroyed && this.events.length > 0) {
        void this.flush();
      }
    };
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.onlineHandler);
    }
  }

  enqueue(event: TrackingEvent): void {
    if (this.destroyed) return;
    this.events.push(event);

    if (this.events.length >= this.opts.flushThreshold) {
      void this.flush();
    } else {
      this.scheduleFlush();
    }
  }

  size(): number {
    return this.events.length;
  }

  /**
   * Synchronously drain everything in the queue (for the unload sendBeacon
   * path). Returns the events that WERE in the queue.
   */
  drain(): TrackingEvent[] {
    const drained = this.events;
    this.events = [];
    this.clearTimer();
    return drained;
  }

  /**
   * Trigger a flush. Concurrent calls share the same in-flight promise so the
   * `flushing` lock prevents double-send.
   */
  flush(): Promise<void> {
    if (this.flushing && this.flushPromise) {
      return this.flushPromise;
    }
    this.flushPromise = this.runFlush().finally(() => {
      this.flushing = false;
      this.flushPromise = null;
    });
    this.flushing = true;
    return this.flushPromise;
  }

  destroy(): void {
    this.destroyed = true;
    this.clearTimer();
    if (this.onlineHandler && typeof window !== "undefined") {
      window.removeEventListener("online", this.onlineHandler);
    }
    this.onlineHandler = null;
  }

  private isOnline(): boolean {
    if (this.opts.isOnline) return this.opts.isOnline();
    if (typeof navigator !== "undefined" && typeof navigator.onLine === "boolean") {
      return navigator.onLine;
    }
    return true;
  }

  private scheduleFlush(): void {
    if (this.timerId !== null) return;
    this.timerId = setTimeout(() => {
      this.timerId = null;
      void this.flush();
    }, this.opts.flushIntervalMs);
  }

  private clearTimer(): void {
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  private async runFlush(): Promise<void> {
    this.clearTimer();
    if (!this.isOnline()) {
      // Hold the events for the online handler.
      return;
    }
    if (this.events.length === 0) return;

    // Take everything, then splinter into batches that respect both the
    // per-batch event count and the byte-size guard.
    const taken = this.events;
    this.events = [];

    const batches = splitIntoBatches(taken);

    for (const batch of batches) {
      const result = await this.sender(batch);
      if (result.auth) {
        // Tracker will transition to DISABLED — drop the rest of this drain.
        return;
      }
      if (result.drop || result.ok) {
        // batch consumed (success or unrecoverable drop); next batch
        continue;
      }
      // retries exhausted — re-queue the unsent batches at the head so we
      // try again on next flush trigger (interval, online, manual).
      const remaining = batches.slice(batches.indexOf(batch));
      this.events = [...remaining.flat(), ...this.events];
      return;
    }
  }
}

/**
 * Split a flat list of events into batches that respect:
 *   - max events per batch (MAX_BATCH_SIZE = 100)
 *   - max byte size per batch (MAX_BATCH_BYTES = 480_000)
 * If a single event somehow exceeds the byte cap on its own, it goes in its
 * own batch (server may 413; that's the catalog's BATCH_TOO_LARGE path).
 */
export function splitIntoBatches(events: TrackingEvent[]): TrackingEvent[][] {
  if (events.length === 0) return [];
  const batches: TrackingEvent[][] = [];
  let current: TrackingEvent[] = [];
  let currentBytes = 2; // brackets of "[]"

  for (const evt of events) {
    const evtBytes = JSON.stringify(evt).length + 1; // +1 for comma
    const wouldExceedSize = current.length >= MAX_BATCH_SIZE;
    const wouldExceedBytes = current.length > 0 && currentBytes + evtBytes > MAX_BATCH_BYTES;

    if (wouldExceedSize || wouldExceedBytes) {
      batches.push(current);
      current = [evt];
      currentBytes = 2 + evtBytes;
    } else {
      current.push(evt);
      currentBytes += evtBytes;
    }
  }
  if (current.length > 0) batches.push(current);
  return batches;
}
