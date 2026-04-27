import * as vektis from "../src/index";
import { _resetCspHintForTests } from "../src/transport";

function mockResponse(status: number = 202): Response {
  return {
    status,
    headers: { get: () => null },
  } as unknown as Response;
}

beforeEach(() => {
  vektis._resetForTests();
  _resetCspHintForTests();
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  // Inject a default fetch via global so the singleton picks it up
  (global as any).fetch = jest.fn().mockResolvedValue(mockResponse(202));
});

afterEach(() => {
  jest.restoreAllMocks();
  vektis._resetForTests();
});

describe("public API surface", () => {
  test("exports init, identify, track, flush, reset, getStatus", () => {
    expect(typeof vektis.init).toBe("function");
    expect(typeof vektis.identify).toBe("function");
    expect(typeof vektis.track).toBe("function");
    expect(typeof vektis.flush).toBe("function");
    expect(typeof vektis.reset).toBe("function");
    expect(typeof vektis.getStatus).toBe("function");
  });

  test("getStatus before init returns UNINITIALIZED with null identity", () => {
    expect(vektis.getStatus()).toEqual({
      state: "UNINITIALIZED",
      queueLength: 0,
      identityCustomerId: null,
      identityUserId: null,
    });
  });
});

describe("pre-init queue", () => {
  test("identify before init queues + replays after init", async () => {
    vektis.identify({ customer_id: "cust_a", user_id: "u1" });
    expect(vektis.getStatus().state).toBe("UNINITIALIZED");
    expect(vektis.getStatus().queueLength).toBe(1);

    vektis.init({ apiKey: "vk_test_abc", autoSessionActive: false });
    // After init, identity should be applied
    expect(vektis.getStatus().identityCustomerId).toBe("cust_a");
    expect(vektis.getStatus().identityUserId).toBe("u1");
    await vektis.flush();
  });

  test("track before identify queues + replays in order", async () => {
    vektis.identify({ customer_id: "cust_a" });
    vektis.track("feature.used", { feature_id: "f1" });
    vektis.track("feature.used", { feature_id: "f2" });
    expect(vektis.getStatus().queueLength).toBe(3);

    vektis.init({ apiKey: "vk_test_abc", autoSessionActive: false });
    await vektis.flush();

    const fetchFn = (global as any).fetch as jest.Mock;
    const events = fetchFn.mock.calls
      .filter((c: any[]) => (c[1] as any).method === "POST")
      .flatMap((c: any[]) => JSON.parse((c[1] as any).body).events);
    const featureIds = events.filter((e: any) => e.event_type === "feature.used").map((e: any) => e.feature_id);
    expect(featureIds).toEqual(["f1", "f2"]);
  });

  test("pre-init queue caps at MAX_PRE_INIT_QUEUE (1000) — drops oldest", async () => {
    for (let i = 0; i < 1010; i++) {
      vektis.track("feature.used", { feature_id: `f${i}` });
    }
    // queue capped at 1000 (10 oldest dropped)
    expect(vektis.getStatus().queueLength).toBe(1000);
    expect(
      (console.warn as jest.Mock).mock.calls.some((c) =>
        String(c[0]).includes("VEK_TRK_PRE_INIT_QUEUE_OVERFLOW")
      )
    ).toBe(true);
  });
});

describe("reset", () => {
  test("reset clears identity and pre-init queue, returns to UNINITIALIZED", async () => {
    vektis.init({ apiKey: "vk_test_abc", autoSessionActive: false });
    vektis.identify({ customer_id: "cust_a" });
    vektis.track("feature.used", { feature_id: "f1" });
    expect(vektis.getStatus().state).toBe("READY");
    vektis.reset();
    expect(vektis.getStatus().state).toBe("UNINITIALIZED");
    expect(vektis.getStatus().identityCustomerId).toBeNull();
    expect(vektis.getStatus().queueLength).toBe(0);
  });
});

describe("page-unload listeners", () => {
  test("visibilitychange:hidden triggers sendBeacon flush", () => {
    const beacon = jest.fn().mockReturnValue(true);
    Object.defineProperty(navigator, "sendBeacon", {
      value: beacon,
      configurable: true,
    });
    vektis.init({ apiKey: "vk_test_abc", autoSessionActive: false });
    vektis.identify({ customer_id: "cust_a" });
    vektis.track("feature.used", { feature_id: "f1" });

    // Simulate visibilitychange:hidden
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));

    expect(beacon).toHaveBeenCalled();
  });

  test("pagehide triggers sendBeacon flush", () => {
    const beacon = jest.fn().mockReturnValue(true);
    Object.defineProperty(navigator, "sendBeacon", {
      value: beacon,
      configurable: true,
    });
    vektis.init({ apiKey: "vk_test_abc", autoSessionActive: false });
    vektis.identify({ customer_id: "cust_a" });
    vektis.track("feature.used", { feature_id: "f1" });

    window.dispatchEvent(new Event("pagehide"));

    expect(beacon).toHaveBeenCalled();
  });

  test("listeners are attached only once across multiple init calls", () => {
    const beacon = jest.fn().mockReturnValue(true);
    Object.defineProperty(navigator, "sendBeacon", {
      value: beacon,
      configurable: true,
    });
    vektis.init({ apiKey: "vk_test_abc", autoSessionActive: false });
    // Second init is a no-op (warns about INIT_TWICE) so the listener should
    // not double-attach.
    vektis.init({ apiKey: "vk_test_xyz", autoSessionActive: false });
    vektis.identify({ customer_id: "cust_a" });
    vektis.track("feature.used", { feature_id: "f1" });
    window.dispatchEvent(new Event("pagehide"));
    // beacon called exactly once even if listeners were attached twice
    expect(beacon).toHaveBeenCalledTimes(1);
  });
});
