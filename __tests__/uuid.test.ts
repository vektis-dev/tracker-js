import { uuidv4, isUuidV4 } from "../src/uuid";

describe("uuid", () => {
  test("uuidv4 returns a valid v4 string when crypto.randomUUID is available", () => {
    const id = uuidv4();
    expect(isUuidV4(id)).toBe(true);
  });

  test("isUuidV4 rejects non-v4 strings", () => {
    expect(isUuidV4("not-a-uuid")).toBe(false);
    expect(isUuidV4("00000000-0000-0000-0000-000000000000")).toBe(false); // version digit 0
    expect(isUuidV4("00000000-0000-4000-8000-000000000000")).toBe(true);
  });

  test("uuidv4 fallback produces valid v4 when randomUUID is missing", () => {
    const original = crypto.randomUUID;
    // Simulate older browser by removing randomUUID
    Object.defineProperty(crypto, "randomUUID", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    try {
      const id = uuidv4();
      expect(isUuidV4(id)).toBe(true);
    } finally {
      Object.defineProperty(crypto, "randomUUID", {
        value: original,
        configurable: true,
        writable: true,
      });
    }
  });
});
