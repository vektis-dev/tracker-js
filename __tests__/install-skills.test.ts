/**
 * @jest-environment node
 *
 * Black-box tests for bin/install-skills.mjs (via bin/tracker.mjs). Each test
 * spawns `node bin/tracker.mjs install-skills [...flags]` against a tmp
 * project root + tmp bundle, asserts on filesystem state and stdout/stderr.
 */
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REPO_ROOT = resolve(__dirname, "..");
const INSTALL_LIB = resolve(REPO_ROOT, "bin/install-skills.mjs");

const SKILL_A_SHA = "a".repeat(64);
const SKILL_B_SHA = "b".repeat(64);

const skillsFixture = [
  {
    name: "skill-a",
    sha256: SKILL_A_SHA,
    files: [
      { path: "SKILL.md", content: "# skill-a v1\n" },
      { path: "EXTRA.md", content: "extra\n" },
    ],
  },
  {
    name: "skill-b",
    sha256: SKILL_B_SHA,
    files: [{ path: "SKILL.md", content: "# skill-b v1\n" }],
  },
];

interface FixtureSkill {
  name: string;
  sha256: string;
  files: { path: string; content: string }[];
}

function makeBundle(bundleDir: string, skills: FixtureSkill[], version = "1.2.3") {
  mkdirSync(bundleDir, { recursive: true });
  for (const skill of skills) {
    const skillDir = join(bundleDir, skill.name);
    mkdirSync(skillDir, { recursive: true });
    for (const f of skill.files) {
      writeFileSync(join(skillDir, f.path), f.content);
    }
  }
  const manifest = {
    version,
    skills: skills.map((s) => ({ name: s.name, sha256: s.sha256 })),
  };
  writeFileSync(join(bundleDir, "MANIFEST.json"), JSON.stringify(manifest, null, 2));
}

// Builds a fake package layout so install-skills' findBundledSkillsDir walk
// resolves into our test fixture (NOT the real dist/skills/ at repo root).
function makeFakePackage(tmp: string) {
  const pkgRoot = join(tmp, "pkg");
  const distSkills = join(pkgRoot, "dist", "skills");
  const bin = join(pkgRoot, "bin");
  mkdirSync(distSkills, { recursive: true });
  mkdirSync(bin, { recursive: true });
  const fakeBinPath = join(bin, "install-skills.mjs");
  writeFileSync(fakeBinPath, "// stub for resolving scriptUrl\n");
  return { pkgRoot, distSkills, scriptUrl: pathToFileURL(fakeBinPath).toString() };
}

function makeProjectRoot(tmp: string, withClaudeDir = true) {
  const proj = join(tmp, "proj");
  mkdirSync(proj, { recursive: true });
  writeFileSync(join(proj, "package.json"), JSON.stringify({ name: "proj" }));
  writeFileSync(join(proj, "package-lock.json"), "{}");
  if (withClaudeDir) {
    mkdirSync(join(proj, ".claude"), { recursive: true });
  }
  return proj;
}

interface RunOpts {
  scriptUrl: string;
  projectRoot: string;
  initCwd?: string;
  flags?: string[];
}

function runInstall(opts: RunOpts): SpawnSyncReturns<string> {
  const { scriptUrl, projectRoot, initCwd, flags = [] } = opts;
  // Inline driver imports the real install-skills with a custom scriptUrl,
  // bypassing bin/tracker.mjs (we test the dispatcher separately).
  const driver = `
    import { installSkills } from ${JSON.stringify(INSTALL_LIB)};
    const code = await installSkills({
      argv: ${JSON.stringify(flags)},
      env: { INIT_CWD: ${JSON.stringify(initCwd ?? projectRoot)} },
      cwd: ${JSON.stringify(projectRoot)},
      scriptUrl: ${JSON.stringify(scriptUrl)},
    });
    process.exit(code);
  `;
  return spawnSync("node", ["--input-type=module", "-e", driver], {
    encoding: "utf8",
  });
}

describe("install-skills", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "vek-install-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test("fresh install copies all skills + writes markers", () => {
    const { distSkills, scriptUrl } = makeFakePackage(tmp);
    makeBundle(distSkills, skillsFixture);
    const proj = makeProjectRoot(tmp);

    const r = runInstall({ scriptUrl, projectRoot: proj });
    expect(r.status).toBe(0);

    expect(existsSync(join(proj, ".claude/skills/skill-a/SKILL.md"))).toBe(true);
    expect(existsSync(join(proj, ".claude/skills/skill-a/EXTRA.md"))).toBe(true);
    expect(existsSync(join(proj, ".claude/skills/skill-b/SKILL.md"))).toBe(true);

    const marker = JSON.parse(
      readFileSync(join(proj, ".claude/skills/skill-a/.vektis-managed"), "utf8"),
    );
    expect(marker.sha256).toBe(SKILL_A_SHA);
    expect(marker.version).toBe("1.2.3");
  });

  test("rerun with matching marker is a no-op (unchanged count)", () => {
    const { distSkills, scriptUrl } = makeFakePackage(tmp);
    makeBundle(distSkills, skillsFixture);
    const proj = makeProjectRoot(tmp);

    runInstall({ scriptUrl, projectRoot: proj });
    const r = runInstall({ scriptUrl, projectRoot: proj });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/installed 0/);
    expect(r.stdout).toMatch(/unchanged 2/);
  });

  test("manifest sha changes → overwrites existing skill + updates marker", () => {
    const { distSkills, scriptUrl } = makeFakePackage(tmp);
    makeBundle(distSkills, skillsFixture);
    const proj = makeProjectRoot(tmp);
    runInstall({ scriptUrl, projectRoot: proj });

    rmSync(distSkills, { recursive: true, force: true });
    const newSha = "c".repeat(64);
    makeBundle(
      distSkills,
      [
        {
          name: "skill-a",
          sha256: newSha,
          files: [{ path: "SKILL.md", content: "# skill-a v2\n" }],
        },
        skillsFixture[1],
      ],
      "2.0.0",
    );

    runInstall({ scriptUrl, projectRoot: proj });

    expect(readFileSync(join(proj, ".claude/skills/skill-a/SKILL.md"), "utf8")).toBe(
      "# skill-a v2\n",
    );
    const marker = JSON.parse(
      readFileSync(join(proj, ".claude/skills/skill-a/.vektis-managed"), "utf8"),
    );
    expect(marker.sha256).toBe(newSha);
    expect(marker.version).toBe("2.0.0");
  });

  test("customer-edited file (no marker) is skipped, edit preserved", () => {
    const { distSkills, scriptUrl } = makeFakePackage(tmp);
    makeBundle(distSkills, skillsFixture);
    const proj = makeProjectRoot(tmp);
    runInstall({ scriptUrl, projectRoot: proj });

    writeFileSync(
      join(proj, ".claude/skills/skill-a/SKILL.md"),
      "# customized\n",
    );
    rmSync(join(proj, ".claude/skills/skill-a/.vektis-managed"));

    const r = runInstall({ scriptUrl, projectRoot: proj });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/skipped customized skill-a/);
    expect(r.stdout).toMatch(/skipped 1 \(customized\)/);
    expect(readFileSync(join(proj, ".claude/skills/skill-a/SKILL.md"), "utf8")).toBe(
      "# customized\n",
    );
  });

  test("--force overwrites customer edits + writes marker", () => {
    const { distSkills, scriptUrl } = makeFakePackage(tmp);
    makeBundle(distSkills, skillsFixture);
    const proj = makeProjectRoot(tmp);
    runInstall({ scriptUrl, projectRoot: proj });

    writeFileSync(
      join(proj, ".claude/skills/skill-a/SKILL.md"),
      "# customized\n",
    );
    rmSync(join(proj, ".claude/skills/skill-a/.vektis-managed"));

    runInstall({ scriptUrl, projectRoot: proj, flags: ["--force"] });

    expect(readFileSync(join(proj, ".claude/skills/skill-a/SKILL.md"), "utf8")).toBe(
      "# skill-a v1\n",
    );
    expect(existsSync(join(proj, ".claude/skills/skill-a/.vektis-managed"))).toBe(true);
  });

  test("missing .claude/ + no --create → logs hint, exits 0, no writes", () => {
    const { distSkills, scriptUrl } = makeFakePackage(tmp);
    makeBundle(distSkills, skillsFixture);
    const proj = makeProjectRoot(tmp, /* withClaudeDir */ false);

    const r = runInstall({ scriptUrl, projectRoot: proj });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/--create/);
    expect(existsSync(join(proj, ".claude"))).toBe(false);
  });

  test("missing .claude/ + --create → creates and copies", () => {
    const { distSkills, scriptUrl } = makeFakePackage(tmp);
    makeBundle(distSkills, skillsFixture);
    const proj = makeProjectRoot(tmp, /* withClaudeDir */ false);

    const r = runInstall({ scriptUrl, projectRoot: proj, flags: ["--create"] });
    expect(r.status).toBe(0);
    expect(existsSync(join(proj, ".claude/skills/skill-a/SKILL.md"))).toBe(true);
  });

  test("INIT_CWD inside node_modules walks up to project root", () => {
    const { distSkills, scriptUrl } = makeFakePackage(tmp);
    makeBundle(distSkills, skillsFixture);
    const proj = makeProjectRoot(tmp);
    const deep = join(proj, "node_modules", "@vektis-io", "tracker", "bin");
    mkdirSync(deep, { recursive: true });

    const r = runInstall({ scriptUrl, projectRoot: deep, initCwd: deep });
    expect(r.status).toBe(0);
    expect(existsSync(join(proj, ".claude/skills/skill-a/SKILL.md"))).toBe(true);
  });

  test("project root not findable → falls back to cwd with warning", () => {
    const { distSkills, scriptUrl } = makeFakePackage(tmp);
    makeBundle(distSkills, skillsFixture);
    const orphan = join(tmp, "orphan");
    mkdirSync(join(orphan, ".claude"), { recursive: true });

    const r = runInstall({ scriptUrl, projectRoot: orphan, initCwd: orphan });
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/could not find project root/);
    expect(existsSync(join(orphan, ".claude/skills/skill-a/SKILL.md"))).toBe(true);
  });

  test("bundle missing → logs error, exits 0", () => {
    const pkgRoot = join(tmp, "pkg");
    const bin = join(pkgRoot, "bin");
    mkdirSync(bin, { recursive: true });
    const fakeBinPath = join(bin, "install-skills.mjs");
    writeFileSync(fakeBinPath, "// stub\n");
    const scriptUrl = pathToFileURL(fakeBinPath).toString();
    const proj = makeProjectRoot(tmp);

    const r = runInstall({ scriptUrl, projectRoot: proj });
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/skills bundle missing/);
    expect(r.stderr).toMatch(/Reinstall the package/);
  });

  test("EACCES on a target subdirectory → logs and continues with remaining skills", () => {
    if (process.getuid && process.getuid() === 0) return; // root bypasses chmod
    const { distSkills, scriptUrl } = makeFakePackage(tmp);
    makeBundle(distSkills, skillsFixture);
    const proj = makeProjectRoot(tmp);

    // Pre-create skill-a target with a STALE marker (sha differs from manifest).
    // Install will try to overwrite, but the dir is read-only — copy will EACCES.
    const blocked = join(proj, ".claude/skills/skill-a");
    mkdirSync(blocked, { recursive: true });
    writeFileSync(
      join(blocked, ".vektis-managed"),
      JSON.stringify({ version: "0.0.1", sha256: "0".repeat(64) }),
    );
    chmodSync(blocked, 0o500);

    try {
      const r = runInstall({ scriptUrl, projectRoot: proj });
      expect(r.status).toBe(0);
      expect(existsSync(join(proj, ".claude/skills/skill-b/SKILL.md"))).toBe(true);
      expect(r.stderr).toMatch(/could not install skill-a/);
    } finally {
      chmodSync(blocked, 0o700);
    }
  });
});

describe("tracker bin (dispatcher)", () => {
  const TRACKER_BIN = resolve(REPO_ROOT, "bin/tracker.mjs");

  test("--help prints usage and exits 0", () => {
    const r = spawnSync("node", [TRACKER_BIN, "--help"], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/install-skills/);
  });

  test("no args prints usage", () => {
    const r = spawnSync("node", [TRACKER_BIN], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/install-skills/);
  });

  test("unknown subcommand exits 2 with error", () => {
    const r = spawnSync("node", [TRACKER_BIN, "bogus"], { encoding: "utf8" });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/unknown subcommand/);
  });
});
