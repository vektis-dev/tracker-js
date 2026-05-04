// Copies the source `skills/` tree into a destination (typically `dist/skills/`)
// and writes MANIFEST.json with per-skill sha256 hashes. Hashes are used by
// the install-skills marker file to distinguish "we shipped this" from
// "customer edited this" without needing to read every file at install time.

import { createHash } from "node:crypto";
import {
  readdirSync,
  readFileSync,
  rmSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  statSync,
} from "node:fs";
import { join, relative } from "node:path";

function listFilesRecursive(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue; // skip dotfiles (.DS_Store, etc.)
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFilesRecursive(full));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function hashSkillDir(skillDir) {
  // Deterministic hash: sort files by relative path, concatenate "<relpath>:<bytes>"
  // for each. Same output bytes ⇒ same hash, regardless of OS readdir order.
  const files = listFilesRecursive(skillDir).sort();
  const h = createHash("sha256");
  for (const f of files) {
    h.update(relative(skillDir, f));
    h.update("\0");
    h.update(readFileSync(f));
    h.update("\0");
  }
  return h.digest("hex");
}

function copyDirRecursive(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const s = join(src, entry.name);
    const d = join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(s, d);
    } else if (entry.isFile()) {
      copyFileSync(s, d);
    }
  }
}

function readPackageVersion(packageJsonPath) {
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  return pkg.version;
}

export async function bundleSkills({ src, dest, packageJsonPath }) {
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });

  const version = readPackageVersion(packageJsonPath);
  const skills = [];

  let entries;
  try {
    entries = readdirSync(src, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new Error(`bundle-skills: source directory not found: ${src}`);
    }
    throw err;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue;
    const srcSkill = join(src, entry.name);
    const destSkill = join(dest, entry.name);
    copyDirRecursive(srcSkill, destSkill);
    if (entry.name === "_shared") continue; // _shared travels with the bundle but is not a skill
    skills.push({ name: entry.name, sha256: hashSkillDir(srcSkill) });
  }

  skills.sort((a, b) => a.name.localeCompare(b.name));
  const manifest = { version, skills };
  writeFileSync(join(dest, "MANIFEST.json"), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}
