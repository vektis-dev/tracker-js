// Contract test — validates SDK-generated payloads against the canonical
// @vektis-io/events-schema. Catches schema drift between SDK and server before
// a release ships. Per VEK-282 + events-schema/README.md release-coordination.

import { trackEventsSchema } from "@vektis-io/events-schema";
import { validBatchFixture } from "@vektis-io/events-schema/fixtures";
import * as vektis from "../src/index";

function mockResponse(): Response {
  return { status: 202, headers: { get: () => null } } as unknown as Response;
}

beforeEach(() => {
  vektis._resetForTests();
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  jest.restoreAllMocks();
  vektis._resetForTests();
});

describe("contract: @vektis-io/events-schema", () => {
  test("validBatchFixture from events-schema parses successfully", () => {
    const result = trackEventsSchema.safeParse(validBatchFixture(3));
    expect(result.success).toBe(true);
  });

  test("SDK-generated payload conforms to trackEventsSchema", async () => {
    const sentPayloads: unknown[] = [];
    (global as any).fetch = jest.fn().mockImplementation((_url: string, init: RequestInit) => {
      if (init?.method === "POST" && init.body) {
        sentPayloads.push(JSON.parse(init.body as string));
      }
      return Promise.resolve(mockResponse());
    });

    vektis.init({ apiKey: "vk_test_abc", autoSessionActive: false });
    vektis.identify({ customer_id: "cust_contract" });
    vektis.track("feature.used", { feature_id: "f1" });
    vektis.track("feature.engagement", {
      feature_id: "f1",
      action: "clicked",
      properties: { source: "header", count: 3, active: true },
    });
    await vektis.flush();

    expect(sentPayloads.length).toBeGreaterThan(0);
    for (const payload of sentPayloads) {
      const parsed = trackEventsSchema.safeParse(payload);
      if (!parsed.success) {
        // Surface validation errors for easier debugging
        // eslint-disable-next-line no-console
        console.log("contract failure:", JSON.stringify(parsed.error.issues, null, 2));
      }
      expect(parsed.success).toBe(true);
    }
  });

  test("every SDK event_id is a valid UUID v4", async () => {
    const sentPayloads: any[] = [];
    (global as any).fetch = jest.fn().mockImplementation((_u: string, init: RequestInit) => {
      if (init?.method === "POST" && init.body) {
        sentPayloads.push(JSON.parse(init.body as string));
      }
      return Promise.resolve(mockResponse());
    });

    vektis.init({ apiKey: "vk_test_abc", autoSessionActive: false });
    vektis.identify({ customer_id: "cust_a" });
    for (let i = 0; i < 5; i++) vektis.track("feature.used", { feature_id: `f${i}` });
    await vektis.flush();

    const allEvents = sentPayloads.flatMap((p) => p.events);
    expect(allEvents.length).toBeGreaterThan(0);
    const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    for (const e of allEvents) {
      expect(e.event_id).toMatch(uuidV4);
    }
  });

  test("SDK timestamps fall within the schema's accepted window", async () => {
    const sentPayloads: any[] = [];
    (global as any).fetch = jest.fn().mockImplementation((_u: string, init: RequestInit) => {
      if (init?.method === "POST" && init.body) {
        sentPayloads.push(JSON.parse(init.body as string));
      }
      return Promise.resolve(mockResponse());
    });

    vektis.init({ apiKey: "vk_test_abc", autoSessionActive: false });
    vektis.identify({ customer_id: "cust_a" });
    vektis.track("feature.used", { feature_id: "f1" });
    await vektis.flush();

    const events = sentPayloads.flatMap((p) => p.events);
    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const oneHourAhead = now + 60 * 60 * 1000;
    for (const e of events) {
      const ts = new Date(e.timestamp).getTime();
      expect(ts).toBeGreaterThanOrEqual(sevenDaysAgo);
      expect(ts).toBeLessThanOrEqual(oneHourAhead);
    }
  });

  test("feature.* events always include feature_id", async () => {
    const sentPayloads: any[] = [];
    (global as any).fetch = jest.fn().mockImplementation((_u: string, init: RequestInit) => {
      if (init?.method === "POST" && init.body) {
        sentPayloads.push(JSON.parse(init.body as string));
      }
      return Promise.resolve(mockResponse());
    });

    vektis.init({ apiKey: "vk_test_abc", autoSessionActive: false });
    vektis.identify({ customer_id: "cust_a" });
    vektis.track("feature.used", { feature_id: "f1" });
    vektis.track("feature.engagement", { feature_id: "f1", action: "click" });
    vektis.track("feature.first_use", { feature_id: "f1" });
    await vektis.flush();

    const events = sentPayloads.flatMap((p) => p.events);
    const featureEvents = events.filter((e: any) => e.event_type.startsWith("feature."));
    expect(featureEvents.length).toBeGreaterThanOrEqual(3);
    for (const e of featureEvents) {
      expect(e.feature_id).toBeDefined();
      expect(e.feature_id.length).toBeGreaterThan(0);
    }
  });
});
