// UUID v4 generator. Primary: crypto.randomUUID. Fallback: crypto.getRandomValues
// for non-secure contexts (HTTP, older Safari iframes) where randomUUID is absent.

export function uuidv4(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  // Fallback per RFC 4122 §4.4 using crypto.getRandomValues.
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    // Set version (4) and variant (10xx) bits.
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex: string[] = [];
    for (let i = 0; i < 16; i++) {
      hex.push(bytes[i].toString(16).padStart(2, "0"));
    }
    return (
      hex.slice(0, 4).join("") +
      "-" +
      hex.slice(4, 6).join("") +
      "-" +
      hex.slice(6, 8).join("") +
      "-" +
      hex.slice(8, 10).join("") +
      "-" +
      hex.slice(10, 16).join("")
    );
  }

  throw new Error(
    "Vektis SDK: no crypto.randomUUID or crypto.getRandomValues available. " +
      "Browser must support Web Crypto API."
  );
}

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuidV4(s: string): boolean {
  return UUID_V4_REGEX.test(s);
}
