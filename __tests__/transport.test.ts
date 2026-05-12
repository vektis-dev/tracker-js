import {
  sendViaFetch,
  sendViaBeacon,
  sendViaKeepaliveFetch,
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

  test("production-mode stays silent on network errors (no host-app console spam)", async () => {
    const fetchFn = jest.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    await sendViaFetch(PAYLOAD, { ...OPTS, debug: false, fetchFn: fetchFn as any });
    await sendViaFetch(PAYLOAD, { ...OPTS, debug: false, fetchFn: fetchFn as any });
    const networkLogs = [
      ...(console.warn as jest.Mock).mock.calls,
      ...(console.error as jest.Mock).mock.calls,
    ].filter((c) => String(c[0]).includes("VEK_TRK_NETWORK_ERROR"));
    expect(networkLogs.length).toBe(0);
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

  test("puts api key in JSON body, not URL", () => {
    const beacon = jest.fn().mockReturnValue(true);
    Object.defineProperty(navigator, "sendBeacon", {
      value: beacon,
      configurable: true,
    });
    // Capture the body string passed to the Blob constructor (jsdom's Blob
    // doesn't expose .text() reliably).
    const originalBlob = global.Blob;
    let capturedBody: string | null = null;
    let capturedType: string | null = null;
    (global as any).Blob = function (parts: unknown[], options: { type?: string }) {
      capturedBody = String(parts[0]);
      capturedType = options?.type ?? null;
      return new originalBlob(parts as BlobPart[], options);
    };
    try {
      const ok = sendViaBeacon(PAYLOAD, OPTS);
      expect(ok).toBe(true);
      expect(beacon).toHaveBeenCalledTimes(1);
      const [url] = beacon.mock.calls[0];
      expect(url).toBe(OPTS.endpoint);
      expect(url).not.toContain("?key=");
      expect(capturedType).toBe("application/json");
      const parsed = JSON.parse(capturedBody!);
      expect(parsed.key).toBe("vk_test_abc");
      expect(parsed.events).toEqual(PAYLOAD.events);
    } finally {
      (global as any).Blob = originalBlob;
    }
  });
});

describe("transport.sendViaKeepaliveFetch", () => {
  test("fires fetch with keepalive: true and key in body", () => {
    const fetchSpy = jest.fn().mockResolvedValue(mockResponse(202));
    (global as any).fetch = fetchSpy;
    sendViaKeepaliveFetch(PAYLOAD, OPTS);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(OPTS.endpoint);
    expect(init.method).toBe("POST");
    expect(init.keepalive).toBe(true);
    expect(init.headers["X-Vektis-SDK"]).toBe("js/1.0.0");
    expect(init.headers["Content-Type"]).toBe("application/json");
    const parsed = JSON.parse(init.body);
    expect(parsed.key).toBe("vk_test_abc");
    expect(parsed.events).toEqual(PAYLOAD.events);
  });

  test("swallows fetch rejection (fire-and-forget)", () => {
    const fetchSpy = jest.fn().mockRejectedValue(new Error("network down"));
    (global as any).fetch = fetchSpy;
    // Must not throw synchronously
    expect(() => sendViaKeepaliveFetch(PAYLOAD, OPTS)).not.toThrow();
  });

  test("no-op when fetch is undefined", () => {
    const originalFetch = (global as any).fetch;
    (global as any).fetch = undefined;
    try {
      expect(() => sendViaKeepaliveFetch(PAYLOAD, OPTS)).not.toThrow();
    } finally {
      (global as any).fetch = originalFetch;
    }
  });
});
