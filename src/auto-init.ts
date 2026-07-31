// Dataset bootstrap. Reads `data-vektis-*` attributes off an element and calls
// init() / identify() from them.
//
// Two entry points share the same attribute contract:
//   - tryAutoInit() — classic <script> tags, driven by document.currentScript.
//   - applyDataset() — any element, used by the public initFromDataset() export.
//
// `document.currentScript` is null for <script type="module">, so module hosts
// (Rails importmap, any no-build ESM setup) cannot use the currentScript path
// at all — they call initFromDataset(element) instead. See VEK-576.

import { logFromCatalog } from "./errors.js";
import type { VektisConfig, VektisIdentity } from "./types.js";

type InitFn = (config: VektisConfig) => void;
type IdentifyFn = (id: VektisIdentity) => void;

function trimOrUndefined(v: string | null | undefined): string | undefined {
  if (!v) return undefined;
  const trimmed = v.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/**
 * Read `data-vektis-*` attributes off `el` and bootstrap from them. Returns
 * false (without calling init) when there's no usable `data-vektis-key`.
 */
export function applyDataset(
  el: Element,
  init: InitFn,
  identify: IdentifyFn
): boolean {
  const apiKey = trimOrUndefined(el.getAttribute("data-vektis-key"));
  if (!apiKey) return false;

  const debugAttr = el.getAttribute("data-vektis-debug");
  const endpoint = trimOrUndefined(el.getAttribute("data-vektis-endpoint"));
  const customerId = trimOrUndefined(el.getAttribute("data-vektis-customer-id"));
  const userId = trimOrUndefined(el.getAttribute("data-vektis-user-id"));

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
  return true;
}

export function tryAutoInit(init: InitFn, identify: IdentifyFn): void {
  if (typeof document === "undefined") return;
  // `currentScript` is set during classic script-tag evaluation. Module scripts
  // and bundler-driven imports come back null.
  const script = document.currentScript as HTMLScriptElement | null;
  if (script) {
    applyDataset(script, init, identify);
    return;
  }

  // No currentScript. If the page carries data-vektis-* attributes anyway, the
  // host followed the script-tag docs in a module context and would otherwise
  // get total silence — every track() dropped with no diagnostic. Warn
  // unconditionally: this can only fire on a page already wired for Vektis.
  if (document.querySelector("[data-vektis-key]")) {
    logFromCatalog("VEK_TRK_AUTOINIT_UNAVAILABLE", "warn");
  }
}
