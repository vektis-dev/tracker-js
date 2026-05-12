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

// Property values must be primitive (string | number | boolean). Anything else
// (objects, arrays, DOM nodes, functions, symbols) is a bug — JSON.stringify
// could hang on a deep / circular subtree, so bail BEFORE stringify.
function describeNonPrimitive(v: unknown): string | null {
  const t = typeof v;
  if (t === "string" || t === "number" || t === "boolean") return null;
  if (v === null) return "null";
  if (t === "function") return "function";
  if (t === "symbol") return "symbol";
  if (t === "bigint") return "bigint";
  if (t === "undefined") return "undefined";
  if (Array.isArray(v)) return "array";
  if (typeof Node !== "undefined" && v instanceof Node) return "DOM node";
  if (typeof v === "object" && v !== null) return "object";
  return t;
}

export function validateProperties(
  props: Record<string, PropertyValue> | undefined
): ValidationResult {
  if (!props) return { ok: true };

  const keys = Object.keys(props);
  // Cheap short-circuit. Bail before stringify so a 100MB DOM tree as a value
  // can't hang the main thread in debug mode.
  if (keys.length > MAX_PROP_KEYS) {
    return { ok: false, reason: `more than ${MAX_PROP_KEYS} keys` };
  }
  for (const k of keys) {
    if (k.length > MAX_PROP_KEY_LEN) {
      return { ok: false, reason: `key "${k}" exceeds ${MAX_PROP_KEY_LEN} chars` };
    }
    const v = props[k];
    const nonPrimitive = describeNonPrimitive(v);
    if (nonPrimitive !== null) {
      return {
        ok: false,
        reason: `value at "${k}" is a ${nonPrimitive}; properties must be string | number | boolean`,
      };
    }
    if (typeof v === "string" && v.length > MAX_PROP_VALUE_LEN) {
      return {
        ok: false,
        reason: `value at "${k}" exceeds ${MAX_PROP_VALUE_LEN} chars`,
      };
    }
  }
  // Only now is it safe to stringify — values are confirmed primitive and key
  // count is bounded.
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
