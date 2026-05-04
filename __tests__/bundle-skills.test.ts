/**
 * @jest-environment node
 *
 * Black-box tests for scripts/bundle-skills.mjs. Tests spawn `node` against
 * a tmp source tree + tmp package.json, then assert on filesystem effects.
 * Avoids importing the .mjs module directly (which would require ESM jest
 * configuration changes that touch every other test file).
 */
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..");
const BUNDLE_SCRIPT_LIB = resolve(REPO_ROOT, "scripts/lib/bundle-skills.mjs");

function runBundle(src: string, dest: string, packageJsonPath: string) {
  // Inline driver: imports bundle-skills.mjs and invokes it. Stdout/stderr +
  // exit code returned for assertions.
  const driver = `
    import { bundleSkills } from ${JSON.stringify(BUNDLE_SCRIPT_LIB)};
    const m = await bundleSkills({
      src: ${JSON.stringify(src)},
      dest: ${JSON.stringify(dest)},
      packageJsonPath: ${JSON.stringify(packageJsonPath)},
    });
    process.stdout.write(JSON.stringify(m));
  `;
  return spawnSync("node", ["--input-type=module", "-e", driver], {
    encoding: "utf8",
  });
}

function makeSourceTree(root: string) {
  mkdirSync(join(root, "skill-a"), { recursive: true });
  writeFileSync(join(root, "skill-a", "SKILL.md"), "# skill-a\n");
  writeFileSync(join(root, "skill-a", "EXTRA.md"), "extra\n");

  mkdirSync(join(root, "skill-b"), { recursive: true });
  writeFileSync(join(root, "skill-b", "SKILL.md"), "# skill-b\n");

  mkdirSync(join(root, "_shared"), { recursive: true });
  writeFileSync(join(root, "_shared", "lib.md"), "shared\n");

  writeFileSync(join(root, "skill-a", ".DS_Store"), "junk");
}

function makePackageJson(path: string, version = "9.9.9") {
  writeFileSync(path, JSON.stringify({ name: "test-pkg", version }));
}

describe("bundle-skills", () => {
  let tmp: string;
  let src: string;
  let dest: string;
  let pkgPath: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "vek-bundle-"));
    src = join(tmp, "skills");
    dest = join(tmp, "dist", "skills");
    pkgPath = join(tmp, "package.json");
    mkdirSync(src, { recursive: true });
    makePackageJson(pkgPath);
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test("copies skill directories with sibling files preserved", () => {
    makeSourceTree(src);
    const r = runBundle(src, dest, pkgPath);
    expect(r.status).toBe(0);

    expect(existsSync(join(dest, "skill-a", "SKILL.md"))).toBe(true);
    expect(existsSync(join(dest, "skill-a", "EXTRA.md"))).toBe(true);
    expect(existsSync(join(dest, "skill-b", "SKILL.md"))).toBe(true);
  });

  test("copies _shared/ directory", () => {
    makeSourceTree(src);
    runBundle(src, dest, pkgPath);
    expect(existsSync(join(dest, "_shared", "lib.md"))).toBe(true);
  });

  test("MANIFEST.json contains version + skill entries with sha256, _shared excluded from skill list", () => {
    makeSourceTree(src);
    runBundle(src, dest, pkgPath);

    const manifest = JSON.parse(readFileSync(join(dest, "MANIFEST.json"), "utf8"));
    expect(manifest.version).toBe("9.9.9");
    expect(manifest.skills.map((s: { name: string }) => s.name).sort()).toEqual([
      "skill-a",
      "skill-b",
    ]);
    for (const s of manifest.skills) {
      expect(s.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  test("dotfiles are ignored (no .DS_Store in dest)", () => {
    makeSourceTree(src);
    runBundle(src, dest, pkgPath);
    expect(existsSync(join(dest, "skill-a", ".DS_Store"))).toBe(false);
  });

  test("source content change produces different sha256 (deterministic per skill)", () => {
    makeSourceTree(src);
    const first = JSON.parse(runBundle(src, dest, pkgPath).stdout);
    rmSync(dest, { recursive: true, force: true });

    writeFileSync(join(src, "skill-a", "SKILL.md"), "# skill-a CHANGED\n");
    const second = JSON.parse(runBundle(src, dest, pkgPath).stdout);

    const aFirst = first.skills.find((s: { name: string }) => s.name === "skill-a");
    const aSecond = second.skills.find((s: { name: string }) => s.name === "skill-a");
    expect(aSecond.sha256).not.toBe(aFirst.sha256);

    const bFirst = first.skills.find((s: { name: string }) => s.name === "skill-b");
    const bSecond = second.skills.find((s: { name: string }) => s.name === "skill-b");
    expect(bSecond.sha256).toBe(bFirst.sha256);
  });

  test("empty source dir → empty skill list, MANIFEST written", () => {
    runBundle(src, dest, pkgPath);
    const manifest = JSON.parse(readFileSync(join(dest, "MANIFEST.json"), "utf8"));
    expect(manifest.skills).toEqual([]);
    expect(manifest.version).toBe("9.9.9");
  });

  test("missing source dir → exits non-zero with error mentioning source", () => {
    rmSync(src, { recursive: true });
    const r = runBundle(src, dest, pkgPath);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/source directory not found/);
  });
});
