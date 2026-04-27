// Smoke test against the built ESM bundle. Verifies the dist artifacts load
// in Node, expose the public API, and the errors sub-export resolves.
// Runs after `npm run build`.

import * as vektis from "../dist/vektis-tracker.esm.js";
import { ERROR_CATALOG } from "../dist/errors.js";

const required = ["init", "identify", "track", "flush", "reset", "getStatus"];
for (const name of required) {
  if (typeof vektis[name] !== "function") {
    console.error(`smoke FAIL: ${name} is not a function on the public API`);
    process.exit(1);
  }
}

if (typeof ERROR_CATALOG !== "object" || ERROR_CATALOG === null) {
  console.error("smoke FAIL: ERROR_CATALOG sub-export missing");
  process.exit(1);
}
const expectedCodes = [
  "VEK_TRK_INVALID_API_KEY",
  "VEK_TRK_VALIDATION_FAILED",
  "VEK_TRK_NETWORK_ERROR",
  "VEK_TRK_MISSING_IDENTITY",
];
for (const code of expectedCodes) {
  if (!ERROR_CATALOG[code]) {
    console.error(`smoke FAIL: error code ${code} missing from catalog`);
    process.exit(1);
  }
}

const status = vektis.getStatus();
if (status.state !== "UNINITIALIZED") {
  console.error(`smoke FAIL: expected UNINITIALIZED before init, got ${status.state}`);
  process.exit(1);
}

console.log("smoke OK — public API + error catalog importable from dist");
console.log("  state:", status.state);
console.log("  catalog codes:", Object.keys(ERROR_CATALOG).length);
