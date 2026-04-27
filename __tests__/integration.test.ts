/**
 * @jest-environment node
 *
 * Integration test against a locally-running vanalytics. Skipped by default;
 * run with TRACKER_INTEGRATION=1 (handled by jest.config.js) AND a vanalytics
 * stack on localhost:3333 (vanalytics/docker-compose.yml + dev:full).
 *
 * Uses the `node` environment (not jsdom) because jest-environment-jsdom
 * strips Node's native `fetch` global. The SDK's window/document/navigator
 * usages are all guarded with `typeof === 'undefined'` checks, so it runs
 * cleanly in the node env — at the cost of not exercising the unload
 * listeners (those are covered by index.test.ts in the jsdom env).
 *
 * Optional: TRACKER_VANALYTICS_INTERNAL_SECRET enables the deep verification
 * path that GETs /api/v1/internal/events/verify to confirm rows landed in DB.
 * Without it, the test confirms the SDK→ingest 202 path only.
 */

import * as vektis from "../src/index";

const VANALYTICS_BASE = process.env.TRACKER_VANALYTICS_URL ?? "http://localhost:3333";
const TEST_API_KEY = process.env.TRACKER_VANALYTICS_TEST_KEY ?? "vek_test_pk_local_playground";
const TEST_ORG_ID =
  process.env.TRACKER_VANALYTICS_ORG_ID ?? "00000000-0000-4000-8000-000000000001";
const INTERNAL_SECRET = process.env.TRACKER_VANALYTICS_INTERNAL_SECRET;

beforeEach(() => {
  vektis._resetForTests();
});
afterEach(() => {
  vektis._resetForTests();
});

describe("integration: tracker-js → local vanalytics", () => {
  test("end-to-end: init → identify → track 5 → flush returns no errors", async () => {
    // Real fetch (jsdom shim is used; node 20+ has native fetch).
    vektis.init({
      apiKey: TEST_API_KEY,
      endpoint: `${VANALYTICS_BASE}/api/v1/events`,
      autoSessionActive: false,
    });
    const customerId = `cust_int_${Date.now()}`;
    vektis.identify({ customer_id: customerId, user_id: "u_int_test" });
    for (let i = 0; i < 5; i++) {
      vektis.track("feature.used", { feature_id: `int_test_${i}` });
    }
    await expect(vektis.flush()).resolves.toBeUndefined();
    // Status should still be READY (not flipped to DISABLED on a 401)
    expect(vektis.getStatus().state).toBe("READY");

    if (INTERNAL_SECRET) {
      // Deep verification — query internal endpoint
      // Allow some lag for queue worker to insert rows
      await new Promise((r) => setTimeout(r, 1000));
      const verifyUrl =
        `${VANALYTICS_BASE}/api/v1/internal/events/verify?organizationId=${TEST_ORG_ID}` +
        `&since=${new Date(Date.now() - 60_000).toISOString()}`;
      const verifyRes = await fetch(verifyUrl, {
        headers: { Authorization: `Bearer ${INTERNAL_SECRET}` },
      });
      expect(verifyRes.status).toBe(200);
      const body = (await verifyRes.json()) as { count: number };
      // 5 feature.used + 1 customer.identified = 6 events
      expect(body.count).toBeGreaterThanOrEqual(6);
    }
  }, 30_000);

  test("reset clears identity; subsequent track without re-identify drops", async () => {
    vektis.init({
      apiKey: TEST_API_KEY,
      endpoint: `${VANALYTICS_BASE}/api/v1/events`,
      autoSessionActive: false,
    });
    vektis.identify({ customer_id: "cust_int_reset" });
    vektis.track("feature.used", { feature_id: "before_reset" });
    await vektis.flush();

    vektis.reset();
    expect(vektis.getStatus().state).toBe("UNINITIALIZED");

    // After reset, init/identify again must be called for tracking to resume
    vektis.init({
      apiKey: TEST_API_KEY,
      endpoint: `${VANALYTICS_BASE}/api/v1/events`,
      autoSessionActive: false,
    });
    // No identify yet
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    vektis.track("feature.used", { feature_id: "after_reset_no_id" });
    expect(
      warnSpy.mock.calls.some((c) => String(c[0]).includes("VEK_TRK_MISSING_IDENTITY"))
    ).toBe(true);
    warnSpy.mockRestore();
  }, 30_000);

  test("invalid API key returns 401 and disables the SDK", async () => {
    vektis.init({
      apiKey: "vk_test_definitely_not_real_xxx",
      endpoint: `${VANALYTICS_BASE}/api/v1/events`,
      autoSessionActive: false,
    });
    vektis.identify({ customer_id: "cust_int_401" });
    vektis.track("feature.used", { feature_id: "should_401" });
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    await vektis.flush();
    expect(vektis.getStatus().state).toBe("DISABLED");
    expect(
      errorSpy.mock.calls.some((c) => String(c[0]).includes("VEK_TRK_INVALID_API_KEY"))
    ).toBe(true);
    errorSpy.mockRestore();
  }, 30_000);
});
