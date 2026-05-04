// Copies the bundled skills (dist/skills/) from inside this package into the
// consumer's <project-root>/.claude/skills/ directory. Idempotent via marker
// file, preserves customer edits, non-fatal on every failure.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  copyFileSync,
  writeFileSync,
} from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DOC_LINK = "https://docs.vektis.io/integrations/tracker/skills";
const MARKER_FILE = ".vektis-managed";
const LOCKFILES = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb"];

function findProjectRoot(start) {
  let dir = resolve(start);
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, "package.json"))) {
      const hasLock = LOCKFILES.some((lf) => existsSync(join(dir, lf)));
      if (hasLock) return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function findBundledSkillsDir(scriptUrl) {
  // bin/install-skills.mjs is always one level inside the package root, with
  // dist/skills/MANIFEST.json a sibling of bin/.
  const pkgRoot = dirname(dirname(fileURLToPath(scriptUrl)));
  const skillsDir = join(pkgRoot, "dist", "skills");
  return existsSync(join(skillsDir, "MANIFEST.json")) ? skillsDir : null;
}

function copyDirRecursive(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const s = join(src, entry.name);
    const d = join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(s, d);
    } else if (entry.isFile()) {
      copyFileSync(s, d);
    }
  }
}

function readMarker(skillTargetDir) {
  const path = join(skillTargetDir, MARKER_FILE);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function writeMarker(skillTargetDir, { version, sha256 }) {
  writeFileSync(
    join(skillTargetDir, MARKER_FILE),
    JSON.stringify({ version, sha256 }, null, 2) + "\n",
  );
}

function parseFlags(argv) {
  const flags = { create: false, force: false };
  for (const arg of argv) {
    if (arg === "--create") flags.create = true;
    else if (arg === "--force") flags.force = true;
  }
  return flags;
}

export async function installSkills({ argv = [], env = process.env, cwd = process.cwd(), scriptUrl = import.meta.url } = {}) {
  const flags = parseFlags(argv);

  const startCwd = env.INIT_CWD || cwd;
  let projectRoot = findProjectRoot(startCwd);
  if (!projectRoot) {
    console.warn(
      `vektis: could not find project root from ${startCwd} (no package.json + lockfile in ancestors); using ${cwd}`,
    );
    projectRoot = cwd;
  }

  const bundleDir = findBundledSkillsDir(scriptUrl);
  if (!bundleDir) {
    console.error(
      "vektis: skills bundle missing from this install of @vektis-io/tracker. Reinstall the package and try again.",
    );
    return 0;
  }

  const manifest = JSON.parse(readFileSync(join(bundleDir, "MANIFEST.json"), "utf8"));

  const claudeDir = join(projectRoot, ".claude");
  const skillsDir = join(claudeDir, "skills");

  if (!existsSync(claudeDir) && !flags.create) {
    console.log(
      `vektis: ${claudeDir} does not exist. Re-run with --create, or create a .claude/ directory in your project. See ${DOC_LINK}`,
    );
    return 0;
  }
  try {
    mkdirSync(skillsDir, { recursive: true });
  } catch (err) {
    console.error(
      `vektis: could not create ${skillsDir} (${err.code || err.message}). See ${DOC_LINK}`,
    );
    return 0;
  }

  let installed = 0;
  let unchanged = 0;
  let skippedCustomized = 0;

  // First copy `_shared/` if present in the bundle (no marker — it's a
  // vendor-controlled dependency directory, always overwritten).
  const sharedSrc = join(bundleDir, "_shared");
  if (existsSync(sharedSrc)) {
    const sharedDest = join(skillsDir, "_shared");
    try {
      copyDirRecursive(sharedSrc, sharedDest);
    } catch (err) {
      console.error(`vektis: could not copy _shared/ (${err.code || err.message}). See ${DOC_LINK}`);
    }
  }

  for (const skill of manifest.skills) {
    const src = join(bundleDir, skill.name);
    const dest = join(skillsDir, skill.name);

    if (existsSync(dest)) {
      const marker = readMarker(dest);
      if (marker && marker.sha256 === skill.sha256) {
        unchanged++;
        continue;
      }
      if (!marker && !flags.force) {
        console.log(
          `vektis: skipped customized ${skill.name} (no ${MARKER_FILE} marker; pass --force to overwrite)`,
        );
        skippedCustomized++;
        continue;
      }
    }

    try {
      copyDirRecursive(src, dest);
      writeMarker(dest, { version: manifest.version, sha256: skill.sha256 });
      installed++;
    } catch (err) {
      console.error(
        `vektis: could not install ${skill.name} (${err.code || err.message}). See ${DOC_LINK}`,
      );
    }
  }

  console.log(
    `vektis: installed ${installed}, unchanged ${unchanged}, skipped ${skippedCustomized} (customized) into ${skillsDir}`,
  );
  return 0;
}
