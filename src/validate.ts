// Debug-mode-only props validator. Mirrors caps in @vektis-io/events-schema so
// we surface server-side rejection causes earlier (in dev console) instead of
// only seeing them as 400 errors in production.

import {
  MAX_PROP_KEYS,
  MAX_PROP_KEY_LEN,
  MAX_PROP_VALUE_LEN,
  MAX_PROPS_BYTES,
} from "./constants.js";
import { logFromCatalog } from "./errors.js";
import type { PropertyValue } from "./types.js";

export interface ValidationResult {
  ok: boolean;
  reason?: string;
}

export function validateProperties(
  props: Record<string, PropertyValue> | undefined
): ValidationResult {
  if (!props) return { ok: true };

  const keys = Object.keys(props);
  if (keys.length > MAX_PROP_KEYS) {
    return { ok: false, reason: `more than ${MAX_PROP_KEYS} keys` };
  }
  for (const k of keys) {
    if (k.length > MAX_PROP_KEY_LEN) {
      return { ok: false, reason: `key "${k}" exceeds ${MAX_PROP_KEY_LEN} chars` };
    }
    const v = props[k];
    if (typeof v === "string" && v.length > MAX_PROP_VALUE_LEN) {
      return {
        ok: false,
        reason: `value at "${k}" exceeds ${MAX_PROP_VALUE_LEN} chars`,
      };
    }
  }
  // Whole-blob byte check — mirror server's JSON.stringify check.
  if (JSON.stringify(props).length > MAX_PROPS_BYTES) {
    return { ok: false, reason: `properties total exceeds ${MAX_PROPS_BYTES} bytes` };
  }
  return { ok: true };
}

// Debug-mode entry point: validate and warn (via catalog) if invalid. The SDK
// still sends the batch — the server is the authoritative validator; this is
// just an early warning system.
export function debugValidateProps(
  props: Record<string, PropertyValue> | undefined,
  debug: boolean
): void {
  if (!debug) return;
  const result = validateProperties(props);
  if (!result.ok) {
    logFromCatalog("VEK_TRK_PROPS_CAP_EXCEEDED", "warn", { reason: result.reason });
  }
}
