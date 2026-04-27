import { validateProperties, debugValidateProps } from "../src/validate";

describe("validate.validateProperties", () => {
  test("undefined props is ok", () => {
    expect(validateProperties(undefined).ok).toBe(true);
  });

  test("under all caps is ok", () => {
    expect(validateProperties({ feature: "reports", count: 3, active: true }).ok).toBe(
      true
    );
  });

  test("rejects > 50 keys", () => {
    const props: Record<string, number> = {};
    for (let i = 0; i < 51; i++) props[`k${i}`] = i;
    const res = validateProperties(props);
    expect(res.ok).toBe(false);
    expect(res.reason).toContain("more than 50 keys");
  });

  test("rejects key longer than 64 chars", () => {
    const longKey = "a".repeat(65);
    const res = validateProperties({ [longKey]: 1 });
    expect(res.ok).toBe(false);
    expect(res.reason).toContain("exceeds 64 chars");
  });

  test("rejects string value longer than 1024 chars", () => {
    const longVal = "x".repeat(1025);
    const res = validateProperties({ description: longVal });
    expect(res.ok).toBe(false);
    expect(res.reason).toContain("exceeds 1024 chars");
  });

  test("rejects whole-blob > 8KB even with no individual cap broken", () => {
    const props: Record<string, string> = {};
    // 50 keys × 200 chars = 10000 bytes total in values, well over 8192
    for (let i = 0; i < 50; i++) props[`k${i.toString().padStart(2, "0")}`] = "x".repeat(200);
    const res = validateProperties(props);
    expect(res.ok).toBe(false);
    expect(res.reason).toContain("8192 bytes");
  });
});

describe("validate.debugValidateProps", () => {
  test("does nothing when debug is false", () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    debugValidateProps({ ["x".repeat(65)]: 1 }, false);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  test("warns via catalog when debug is true and props invalid", () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    debugValidateProps({ ["x".repeat(65)]: 1 }, true);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain("VEK_TRK_PROPS_CAP_EXCEEDED");
    warnSpy.mockRestore();
  });
});
