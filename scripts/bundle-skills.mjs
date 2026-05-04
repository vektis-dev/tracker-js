// Entry: bundles tracker-js/skills/ into dist/skills/ during `npm run build`.
// See scripts/lib/bundle-skills.mjs for the actual copy + manifest logic.

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { bundleSkills } from "./lib/bundle-skills.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

const manifest = await bundleSkills({
  src: resolve(repoRoot, "skills"),
  dest: resolve(repoRoot, "dist/skills"),
  packageJsonPath: resolve(repoRoot, "package.json"),
});

const names = manifest.skills.map((s) => s.name).join(", ");
console.log(
  `bundle-skills: bundled ${manifest.skills.length} skill(s) at v${manifest.version}: ${names}`,
);
