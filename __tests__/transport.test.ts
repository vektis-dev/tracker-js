import {
  sendViaFetch,
  sendViaBeacon,
  prewarmOptions,
  _resetCspHintForTests,
} from "../src/transport";
import type { TrackEventsPayload } from "../src/types";

const PAYLOAD: TrackEventsPayload = {
  events: [
    {
      event_id: "00000000-0000-4000-8000-000000000001",
      event_type: "feature.used",
      customer_id: "cust_test",
      feature_id: "feat_test",
    },
  ],
};

const OPTS = {
  endpoint: "https://events.vektis.io/api/v1/events",
  apiKey: "vk_test_abc",
  debug: false,
  sleep: () => Promise.resolve(),
};

function mockResponse(status: number, headers: Record<string, string> = {}): Response {
  return {
    status,
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    },
  } as unknown as Response;
}

beforeEach(() => {
  _resetCspHintForTests();
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("transport.sendViaFetch", () => {
  test("happy path: 202 returns ok", async () => {
    const fetchFn = jest.fn().mockResolvedValue(mockResponse(202));
    const res = await sendViaFetch(PAYLOAD, { ...OPTS, fetchFn: fetchFn as any });
    expect(res.ok).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const init = fetchFn.mock.calls[0][1];
    expect(init.headers["X-Vektis-Key"]).toBe("vk_test_abc");
    expect(init.headers["X-Vektis-SDK"]).toBe("js/1.0.0");
    expect(init.headers["Content-Type"]).toBe("application/json");
  });

  test("401 returns auth, no retry", async () => {
    const fetchFn = jest.fn().mockResolvedValue(mockResponse(401));
    const res = await sendViaFetch(PAYLOAD, { ...OPTS, fetchFn: fetchFn as any });
    expect(res).toEqual({ ok: false, kind: "auth", status: 401 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  test("400 returns drop with VALIDATION_FAILED, no retry", async () => {
    const fetchFn = jest.fn().mockResolvedValue(mockResponse(400));
    const res = await sendViaFetch(PAYLOAD, { ...OPTS, fetchFn: fetchFn as any });
    expect(res).toMatchObject({ ok: false, kind: "drop", status: 400 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  test("413 returns drop with BATCH_TOO_LARGE, no retry", async () => {
    const fetchFn = jest.fn().mockResolvedValue(mockResponse(413));
    const res = await sendViaFetch(PAYLOAD, { ...OPTS, fetchFn: fetchFn as any });
    expect(res).toMatchObject({ ok: false, kind: "drop", status: 413 });
  });

  test("429 retries up to MAX_RETRIES, respects Retry-After", async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(mockResponse(429, { "retry-after": "0" }))
      .mockResolvedValueOnce(mockResponse(429, { "retry-after": "0" }))
      .mockResolvedValueOnce(mockResponse(202));
    const res = await sendViaFetch(PAYLOAD, { ...OPTS, fetchFn: fetchFn as any });
    expect(res.ok).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  test("429 returns retries_exhausted after MAX_RETRIES", async () => {
    const fetchFn = jest.fn().mockResolvedValue(mockResponse(429, { "retry-after": "0" }));
    const res = await sendViaFetch(PAYLOAD, { ...OPTS, fetchFn: fetchFn as any });
    expect(res).toMatchObject({ ok: false, kind: "retries_exhausted" });
    // attempt 0..MAX_RETRIES inclusive = 6 calls
    expect(fetchFn).toHaveBeenCalledTimes(6);
  });

  test("503 retries with backoff", async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(mockResponse(503))
      .mockResolvedValueOnce(mockResponse(202));
    const res = await sendViaFetch(PAYLOAD, { ...OPTS, fetchFn: fetchFn as any });
    expect(res.ok).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  test("network error retries; debug-mode logs each failure", async () => {
    const fetchFn = jest
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(mockResponse(202));
    const res = await sendViaFetch(PAYLOAD, {
      ...OPTS,
      debug: true,
      fetchFn: fetchFn as any,
    });
    expect(res.ok).toBe(true);
    // Network error logged via catalog warn (debug mode)
    expect((console.warn as jest.Mock).mock.calls.some((c) => String(c[0]).includes("VEK_TRK_NETWORK_ERROR"))).toBe(true);
  });

  test("production-mode CSP hint logs once per page-load", async () => {
    const fetchFn = jest.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    await sendViaFetch(PAYLOAD, { ...OPTS, debug: false, fetchFn: fetchFn as any });
    await sendViaFetch(PAYLOAD, { ...OPTS, debug: false, fetchFn: fetchFn as any });
    const errorCalls = (console.error as jest.Mock).mock.calls.filter((c) =>
      String(c[0]).includes("VEK_TRK_NETWORK_ERROR")
    );
    expect(errorCalls.length).toBe(1);
  });
});

describe("transport.sendViaBeacon", () => {
  test("returns false when sendBeacon is unavailable", () => {
    const original = navigator.sendBeacon;
    Object.defineProperty(navigator, "sendBeacon", {
      value: undefined,
      configurable: true,
    });
    try {
      expect(sendViaBeacon(PAYLOAD, OPTS)).toBe(false);
    } finally {
      Object.defineProperty(navigator, "sendBeacon", {
        value: original,
        configurable: true,
      });
    }
  });

  test("uses ?key= query param and JSON Blob body", () => {
    const beacon = jest.fn().mockReturnValue(true);
    Object.defineProperty(navigator, "sendBeacon", {
      value: beacon,
      configurable: true,
    });
    const ok = sendViaBeacon(PAYLOAD, OPTS);
    expect(ok).toBe(true);
    expect(beacon).toHaveBeenCalledTimes(1);
    const [url, body] = beacon.mock.calls[0];
    expect(url).toContain("?key=vk_test_abc");
    expect(body).toBeInstanceOf(Blob);
    expect((body as Blob).type).toBe("application/json");
  });
});

describe("transport.prewarmOptions", () => {
  test("fires fetch with method OPTIONS, ignores success", async () => {
    const fetchFn = jest.fn().mockResolvedValue(mockResponse(204));
    await prewarmOptions({ ...OPTS, fetchFn: fetchFn as any });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [, init] = fetchFn.mock.calls[0];
    expect(init.method).toBe("OPTIONS");
    expect(init.mode).toBe("cors");
  });

  test("failure logs only in debug mode", async () => {
    const fetchFn = jest.fn().mockRejectedValue(new Error("net"));
    await prewarmOptions({ ...OPTS, debug: false, fetchFn: fetchFn as any });
    expect(
      (console.warn as jest.Mock).mock.calls.some((c) =>
        String(c[0]).includes("VEK_TRK_PREWARM_FAILED")
      )
    ).toBe(false);

    await prewarmOptions({ ...OPTS, debug: true, fetchFn: fetchFn as any });
    expect(
      (console.warn as jest.Mock).mock.calls.some((c) =>
        String(c[0]).includes("VEK_TRK_PREWARM_FAILED")
      )
    ).toBe(true);
  });
});
