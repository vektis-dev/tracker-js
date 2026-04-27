import { Tracker } from "../src/tracker";
import { _resetCspHintForTests } from "../src/transport";

function mockResponse(status: number, headers: Record<string, string> = {}): Response {
  return {
    status,
    headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
  } as unknown as Response;
}

function makeFetch(status: number = 202) {
  return jest.fn().mockResolvedValue(mockResponse(status));
}

beforeEach(() => {
  _resetCspHintForTests();
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe("tracker.init / state machine", () => {
  test("starts UNINITIALIZED, transitions to READY on init", () => {
    const t = new Tracker({ fetchFn: makeFetch() as any });
    expect(t.getStatus().state).toBe("UNINITIALIZED");
    t.init({ apiKey: "vk_test_abc" });
    expect(t.getStatus().state).toBe("READY");
  });

  test("init twice is a no-op and warns in debug", () => {
    const t = new Tracker({ fetchFn: makeFetch() as any });
    t.init({ apiKey: "vk_test_abc", debug: true });
    t.init({ apiKey: "vk_test_xyz", debug: true });
    expect(
      (console.warn as jest.Mock).mock.calls.some((c) =>
        String(c[0]).includes("VEK_TRK_INIT_TWICE")
      )
    ).toBe(true);
  });

  test("init without apiKey throws", () => {
    const t = new Tracker();
    expect(() => t.init({} as any)).toThrow(/apiKey/);
  });

  test("auto session.active fires on init by default", async () => {
    const fetchFn = makeFetch();
    const t = new Tracker({ fetchFn: fetchFn as any });
    t.init({ apiKey: "vk_test_abc" });
    t.identify({ customer_id: "cust_a" });
    await t.flush();
    // session.active first, customer.identified second
    const allEvents = fetchFn.mock.calls
      .filter((c) => (c[1] as any).method === "POST")
      .flatMap((c) => JSON.parse((c[1] as any).body).events);
    expect(allEvents.some((e: any) => e.event_type === "session.active")).toBe(true);
  });

  test("autoSessionActive: false suppresses the auto event", async () => {
    const fetchFn = makeFetch();
    const t = new Tracker({ fetchFn: fetchFn as any });
    t.init({ apiKey: "vk_test_abc", autoSessionActive: false });
    t.identify({ customer_id: "cust_a" });
    await t.flush();
    const allEvents = fetchFn.mock.calls
      .filter((c) => (c[1] as any).method === "POST")
      .flatMap((c) => JSON.parse((c[1] as any).body).events);
    expect(allEvents.some((e: any) => e.event_type === "session.active")).toBe(false);
  });

  test("reset returns state to UNINITIALIZED and clears identity", () => {
    const t = new Tracker({ fetchFn: makeFetch() as any });
    t.init({ apiKey: "vk_test_abc" });
    t.identify({ customer_id: "cust_a", user_id: "u1" });
    expect(t.getStatus().identityCustomerId).toBe("cust_a");
    t.reset();
    const s = t.getStatus();
    expect(s.state).toBe("UNINITIALIZED");
    expect(s.identityCustomerId).toBeNull();
    expect(s.identityUserId).toBeNull();
  });

  test("401 transitions to DISABLED", async () => {
    const fetchFn = makeFetch(401);
    const t = new Tracker({ fetchFn: fetchFn as any });
    t.init({ apiKey: "vk_test_bad" });
    t.identify({ customer_id: "cust_a" });
    t.track("feature.used", { feature_id: "f1" });
    await t.flush();
    expect(t.getStatus().state).toBe("DISABLED");
    expect(
      (console.error as jest.Mock).mock.calls.some((c) =>
        String(c[0]).includes("VEK_TRK_INVALID_API_KEY")
      )
    ).toBe(true);
  });

  test("DISABLED state silently drops further track calls", async () => {
    const fetchFn = makeFetch(401);
    const t = new Tracker({ fetchFn: fetchFn as any });
    t.init({ apiKey: "vk_test_bad" });
    t.identify({ customer_id: "cust_a" });
    t.track("feature.used", { feature_id: "f1" });
    await t.flush();
    fetchFn.mockClear();
    t.track("feature.used", { feature_id: "f2" });
    await t.flush();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("tracker.identify", () => {
  test("identify sets customer_id + user_id and enqueues customer.identified", async () => {
    const fetchFn = makeFetch();
    const t = new Tracker({ fetchFn: fetchFn as any });
    t.init({ apiKey: "vk_test_abc", autoSessionActive: false });
    t.identify({ customer_id: "cust_a", user_id: "u1" });
    expect(t.getStatus().identityCustomerId).toBe("cust_a");
    expect(t.getStatus().identityUserId).toBe("u1");
    await t.flush();
    const events = fetchFn.mock.calls
      .filter((c) => (c[1] as any).method === "POST")
      .flatMap((c) => JSON.parse((c[1] as any).body).events);
    expect(events.some((e: any) => e.event_type === "customer.identified")).toBe(true);
  });

  test("identify without customer_id throws", () => {
    const t = new Tracker({ fetchFn: makeFetch() as any });
    t.init({ apiKey: "vk_test_abc" });
    expect(() => t.identify({} as any)).toThrow(/customer_id/);
  });
});

describe("tracker.track / customer_id injection", () => {
  test("track injects customer_id from identify context", async () => {
    const fetchFn = makeFetch();
    const t = new Tracker({ fetchFn: fetchFn as any });
    t.init({ apiKey: "vk_test_abc", autoSessionActive: false });
    t.identify({ customer_id: "cust_xyz" });
    t.track("feature.used", { feature_id: "f1" });
    await t.flush();
    const events = fetchFn.mock.calls
      .filter((c) => (c[1] as any).method === "POST")
      .flatMap((c) => JSON.parse((c[1] as any).body).events);
    const featureEvent = events.find((e: any) => e.event_type === "feature.used");
    expect(featureEvent.customer_id).toBe("cust_xyz");
    expect(featureEvent.feature_id).toBe("f1");
    expect(featureEvent.event_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(featureEvent.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("track before identify drops with MISSING_IDENTITY warn", () => {
    const fetchFn = makeFetch();
    const t = new Tracker({ fetchFn: fetchFn as any });
    t.init({ apiKey: "vk_test_abc", autoSessionActive: false });
    t.track("feature.used", { feature_id: "f1" });
    expect(
      (console.warn as jest.Mock).mock.calls.some((c) =>
        String(c[0]).includes("VEK_TRK_MISSING_IDENTITY")
      )
    ).toBe(true);
    expect(t.getStatus().queueLength).toBe(0);
  });

  test("debug-mode warns when feature.* event missing feature_id", () => {
    const t = new Tracker({ fetchFn: makeFetch() as any });
    t.init({ apiKey: "vk_test_abc", debug: true, autoSessionActive: false });
    t.identify({ customer_id: "cust_a" });
    t.track("feature.used", {});
    expect(
      (console.warn as jest.Mock).mock.calls.some(
        (c) =>
          String(c[0]).includes("VEK_TRK_VALIDATION_FAILED") &&
          String(c[2]?.reason ?? "").includes("missing feature_id")
      )
    ).toBe(true);
  });
});

describe("tracker.applyKeyHeuristics (debug mode only)", () => {
  test("vk_test_ on non-local hostname warns", () => {
    const t = new Tracker({
      fetchFn: makeFetch() as any,
      getHostname: () => "app.example.com",
    });
    t.init({ apiKey: "vk_test_abc", debug: true });
    expect(
      (console.warn as jest.Mock).mock.calls.some((c) =>
        String(c[0]).includes("VEK_TRK_TEST_KEY_NON_LOCAL")
      )
    ).toBe(true);
  });

  test("vk_live_ on localhost warns", () => {
    const t = new Tracker({
      fetchFn: makeFetch() as any,
      getHostname: () => "localhost",
    });
    t.init({ apiKey: "vk_live_abc", debug: true });
    expect(
      (console.warn as jest.Mock).mock.calls.some((c) =>
        String(c[0]).includes("VEK_TRK_LIVE_KEY_LOCAL")
      )
    ).toBe(true);
  });

  test("vk_test_ on localhost is silent", () => {
    const t = new Tracker({
      fetchFn: makeFetch() as any,
      getHostname: () => "localhost",
    });
    t.init({ apiKey: "vk_test_abc", debug: true });
    expect(
      (console.warn as jest.Mock).mock.calls.some(
        (c) =>
          String(c[0]).includes("VEK_TRK_TEST_KEY_NON_LOCAL") ||
          String(c[0]).includes("VEK_TRK_LIVE_KEY_LOCAL")
      )
    ).toBe(false);
  });

  test("debug=false suppresses both heuristics", () => {
    const t = new Tracker({
      fetchFn: makeFetch() as any,
      getHostname: () => "app.example.com",
    });
    t.init({ apiKey: "vk_test_abc", debug: false });
    expect(
      (console.warn as jest.Mock).mock.calls.some((c) =>
        String(c[0]).includes("VEK_TRK_TEST_KEY_NON_LOCAL")
      )
    ).toBe(false);
  });
});

describe("tracker.getStatus", () => {
  test("returns shape with state, queueLength, identity fields", () => {
    const t = new Tracker({ fetchFn: makeFetch() as any });
    expect(t.getStatus()).toEqual({
      state: "UNINITIALIZED",
      queueLength: 0,
      identityCustomerId: null,
      identityUserId: null,
    });
    t.init({ apiKey: "vk_test_abc", autoSessionActive: false });
    t.identify({ customer_id: "cust_x", user_id: "u_y" });
    const s = t.getStatus();
    expect(s.state).toBe("READY");
    expect(s.identityCustomerId).toBe("cust_x");
    expect(s.identityUserId).toBe("u_y");
  });

  test("queueLength reflects pending events", () => {
    // Use a fetch that never resolves so events stay queued
    const t = new Tracker({
      fetchFn: jest.fn().mockReturnValue(new Promise(() => undefined)) as any,
    });
    t.init({ apiKey: "vk_test_abc", autoSessionActive: false });
    t.identify({ customer_id: "cust_a" });
    // Identify fires customer.identified; track fires another. flush threshold = 10.
    expect(t.getStatus().queueLength).toBe(1);
    t.track("feature.used", { feature_id: "f1" });
    expect(t.getStatus().queueLength).toBe(2);
  });
});

describe("tracker.flushBeacon (unload path)", () => {
  test("drains queue via sendBeacon", () => {
    const beacon = jest.fn().mockReturnValue(true);
    Object.defineProperty(navigator, "sendBeacon", {
      value: beacon,
      configurable: true,
    });
    const t = new Tracker({
      fetchFn: jest.fn().mockReturnValue(new Promise(() => undefined)) as any,
    });
    t.init({ apiKey: "vk_test_abc", autoSessionActive: false });
    t.identify({ customer_id: "cust_a" });
    t.track("feature.used", { feature_id: "f1" });
    expect(t.getStatus().queueLength).toBeGreaterThan(0);
    const sent = t.flushBeacon();
    expect(sent).toBe(true);
    expect(beacon).toHaveBeenCalledTimes(1);
    expect(t.getStatus().queueLength).toBe(0);
  });

  test("returns false when queue is empty", () => {
    const t = new Tracker({ fetchFn: makeFetch() as any });
    t.init({ apiKey: "vk_test_abc", autoSessionActive: false });
    // queue should be empty after init w/o auto session
    expect(t.flushBeacon()).toBe(false);
  });
});
