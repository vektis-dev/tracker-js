import { EventQueue, splitIntoBatches, type FlushSender } from "../src/queue";
import type { TrackingEvent } from "../src/types";

function makeEvent(overrides: Partial<TrackingEvent> = {}): TrackingEvent {
  return {
    event_id: "00000000-0000-4000-8000-000000000001",
    event_type: "feature.used",
    customer_id: "cust_test",
    feature_id: "feat",
    ...overrides,
  };
}

function makeQueue(sender: FlushSender, online = true): EventQueue {
  return new EventQueue(sender, {
    flushIntervalMs: 5000,
    flushThreshold: 10,
    isOnline: () => online,
  });
}

describe("queue.splitIntoBatches", () => {
  test("empty input → empty output", () => {
    expect(splitIntoBatches([])).toEqual([]);
  });

  test("under both caps → single batch", () => {
    const events = Array.from({ length: 5 }, () => makeEvent());
    expect(splitIntoBatches(events)).toHaveLength(1);
  });

  test("more than 100 events → splits at MAX_BATCH_SIZE", () => {
    const events = Array.from({ length: 250 }, () => makeEvent());
    const batches = splitIntoBatches(events);
    expect(batches).toHaveLength(3);
    expect(batches[0]).toHaveLength(100);
    expect(batches[1]).toHaveLength(100);
    expect(batches[2]).toHaveLength(50);
  });

  test("byte-size cap splits even when event count is under 100", () => {
    // Each event with a 100KB property; 5 events would be ~500KB total.
    const big = "x".repeat(100_000);
    const events = Array.from({ length: 5 }, () =>
      makeEvent({ properties: { blob: big } })
    );
    const batches = splitIntoBatches(events);
    // Should split into multiple batches because total > 480KB
    expect(batches.length).toBeGreaterThanOrEqual(2);
    // Each batch's serialized size should be ≤ 480_000 (with small slack)
    for (const b of batches) {
      expect(JSON.stringify(b).length).toBeLessThanOrEqual(500_000);
    }
  });
});

describe("queue.EventQueue", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test("flushes when threshold (10) is reached", async () => {
    const sender = jest.fn(async () => ({ ok: true }));
    const q = makeQueue(sender);
    for (let i = 0; i < 10; i++) q.enqueue(makeEvent());
    // flush is triggered synchronously via void; await microtasks
    await Promise.resolve();
    await Promise.resolve();
    expect(sender).toHaveBeenCalledTimes(1);
    expect((sender.mock.calls[0] as unknown[])[0]).toHaveLength(10);
    q.destroy();
  });

  test("flushes after flushIntervalMs even below threshold", async () => {
    const sender = jest.fn(async () => ({ ok: true }));
    const q = makeQueue(sender);
    q.enqueue(makeEvent());
    expect(sender).not.toHaveBeenCalled();
    jest.advanceTimersByTime(5000);
    await Promise.resolve();
    await Promise.resolve();
    expect(sender).toHaveBeenCalledTimes(1);
    q.destroy();
  });

  test("flushing lock dedupes concurrent flush() calls", async () => {
    let resolveSender: (v: { ok: true }) => void;
    const sender = jest.fn(
      () =>
        new Promise<{ ok: true }>((resolve) => {
          resolveSender = resolve;
        })
    );
    const q = makeQueue(sender);
    q.enqueue(makeEvent());
    const a = q.flush();
    const b = q.flush();
    expect(a).toBe(b); // same promise
    resolveSender!({ ok: true });
    await a;
    expect(sender).toHaveBeenCalledTimes(1);
    q.destroy();
  });

  test("manual flush() drains pending events", async () => {
    const sender = jest.fn(async () => ({ ok: true }));
    const q = makeQueue(sender);
    q.enqueue(makeEvent());
    q.enqueue(makeEvent());
    await q.flush();
    expect(sender).toHaveBeenCalledTimes(1);
    expect((sender.mock.calls[0] as unknown[])[0]).toHaveLength(2);
    q.destroy();
  });

  test("offline: does not flush, keeps events for online event", async () => {
    const sender = jest.fn(async () => ({ ok: true }));
    const q = makeQueue(sender, false);
    for (let i = 0; i < 10; i++) q.enqueue(makeEvent());
    await Promise.resolve();
    await Promise.resolve();
    expect(sender).not.toHaveBeenCalled();
    expect(q.size()).toBe(10);
    q.destroy();
  });

  test("drain() empties the queue and returns events", () => {
    const sender = jest.fn(async () => ({ ok: true }));
    const q = makeQueue(sender);
    q.enqueue(makeEvent());
    q.enqueue(makeEvent());
    const drained = q.drain();
    expect(drained).toHaveLength(2);
    expect(q.size()).toBe(0);
    q.destroy();
  });

  test("retries-exhausted re-queues events for next flush", async () => {
    const sender = jest
      .fn()
      .mockResolvedValueOnce({ ok: false }) // first attempt: not ok, not drop, not auth → re-queue
      .mockResolvedValueOnce({ ok: true });
    const q = makeQueue(sender);
    q.enqueue(makeEvent());
    await q.flush();
    expect(q.size()).toBe(1);
    await q.flush();
    expect(sender).toHaveBeenCalledTimes(2);
    expect(q.size()).toBe(0);
    q.destroy();
  });

  test("auth failure short-circuits the rest of the drain", async () => {
    const sender = jest.fn(async () => ({ ok: false, auth: true }));
    const q = makeQueue(sender);
    for (let i = 0; i < 200; i++) q.enqueue(makeEvent());
    await q.flush();
    // Only the first batch attempted; the rest are dropped (tracker DISABLED path)
    expect(sender).toHaveBeenCalledTimes(1);
    q.destroy();
  });

  test("drop result still proceeds to next batch", async () => {
    const sender = jest.fn(async () => ({ ok: false, drop: true }));
    // High threshold + far-future timer so enqueue never auto-flushes; only
    // the explicit flush() call drains.
    const q = new EventQueue(sender, {
      flushIntervalMs: 999_999_999,
      flushThreshold: 999_999,
      isOnline: () => true,
    });
    for (let i = 0; i < 250; i++) q.enqueue(makeEvent());
    expect(q.size()).toBe(250);
    await q.flush();
    // 3 batches (100 + 100 + 50), all "drop" but still attempted
    expect(sender).toHaveBeenCalledTimes(3);
    q.destroy();
  });

  test("destroy stops accepting new events", () => {
    const sender = jest.fn(async () => ({ ok: true }));
    const q = makeQueue(sender);
    q.destroy();
    q.enqueue(makeEvent());
    expect(q.size()).toBe(0);
  });
});
