// Script-tag auto-init. Reads `data-vektis-*` attributes from the currently
// executing <script> tag and calls init() / identify() automatically. Zero
// customer code beyond a single <script> tag.
//
// For ESM consumers, `document.currentScript` is null at import time, so this
// is a silent no-op — they still call init() themselves.

import type { VektisConfig, VektisIdentity } from "./types.js";

type InitFn = (config: VektisConfig) => void;
type IdentifyFn = (id: VektisIdentity) => void;

function trimOrUndefined(v: string | null | undefined): string | undefined {
  if (!v) return undefined;
  const trimmed = v.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

export function tryAutoInit(init: InitFn, identify: IdentifyFn): void {
  if (typeof document === "undefined") return;
  // `currentScript` is set during script-tag evaluation. ESM/CJS module loads
  // through bundlers come back null — those consumers init() themselves.
  const script = document.currentScript as HTMLScriptElement | null;
  if (!script) return;

  const apiKey = trimOrUndefined(script.getAttribute("data-vektis-key"));
  if (!apiKey) return;

  const debugAttr = script.getAttribute("data-vektis-debug");
  const endpoint = trimOrUndefined(script.getAttribute("data-vektis-endpoint"));
  const customerId = trimOrUndefined(script.getAttribute("data-vektis-customer-id"));
  const userId = trimOrUndefined(script.getAttribute("data-vektis-user-id"));

  const config: VektisConfig = { apiKey };
  if (endpoint) config.endpoint = endpoint;
  if (debugAttr !== null) {
    // Any presence other than literal "false" is truthy — matches HTML's loose
    // boolean attribute convention (`data-vektis-debug` alone enables it).
    config.debug = debugAttr.toLowerCase() !== "false";
  }
  init(config);

  if (customerId) {
    const identity: VektisIdentity = { customer_id: customerId };
    if (userId) identity.user_id = userId;
    identify(identity);
  }
}
