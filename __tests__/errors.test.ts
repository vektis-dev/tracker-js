import { ERROR_CATALOG, logFromCatalog, type ErrorCode } from "../src/errors";

describe("errors catalog", () => {
  test("every ErrorCode has a registered catalog entry", () => {
    const codes: ErrorCode[] = [
      "VEK_TRK_INVALID_API_KEY",
      "VEK_TRK_VALIDATION_FAILED",
      "VEK_TRK_RATE_LIMITED",
      "VEK_TRK_SERVER_ERROR",
      "VEK_TRK_BATCH_TOO_LARGE",
      "VEK_TRK_NETWORK_ERROR",
      "VEK_TRK_MISSING_IDENTITY",
      "VEK_TRK_INIT_TWICE",
      "VEK_TRK_IDENTIFY_BEFORE_INIT",
      "VEK_TRK_PROPS_CAP_EXCEEDED",
      "VEK_TRK_TEST_KEY_NON_LOCAL",
      "VEK_TRK_LIVE_KEY_LOCAL",
      "VEK_TRK_PREWARM_FAILED",
      "VEK_TRK_PRE_INIT_QUEUE_OVERFLOW",
    ];
    for (const code of codes) {
      const entry = ERROR_CATALOG[code];
      expect(entry).toBeDefined();
      expect(entry.code).toBe(code);
      expect(entry.message.length).toBeGreaterThan(0);
      expect(entry.actionItem.length).toBeGreaterThan(0);
      expect(entry.docsAnchor).toMatch(/^https:\/\/docs\.vektis\.io\//);
      expect(Array.isArray(entry.hypotheses)).toBe(true);
      expect(entry.hypotheses.length).toBeGreaterThan(0);
    }
  });

  test("catalog is frozen (no runtime mutation)", () => {
    expect(Object.isFrozen(ERROR_CATALOG)).toBe(true);
  });

  test("logFromCatalog routes through console.warn or console.error", () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

    logFromCatalog("VEK_TRK_INIT_TWICE", "warn");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain("VEK_TRK_INIT_TWICE");

    logFromCatalog("VEK_TRK_INVALID_API_KEY", "error", { httpStatus: 401 });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toContain("VEK_TRK_INVALID_API_KEY");
    expect(errorSpy.mock.calls[0][2]).toEqual({ httpStatus: 401 });

    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
