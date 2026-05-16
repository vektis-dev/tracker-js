/**
 * @jest-environment node
 *
 * Guards against shipping internal Vektis terminology to customers via the
 * skill bundle. Customers install skills/* onto their machines via `npx
 * @vektis-io/tracker install-skills` and the model reads + paraphrases them.
 * Linear ticket IDs, internal repo names, and bare internal markdown filenames
 * in prose leak into customer-facing model output.
 *
 * Scans every *.md under skills/ for banned patterns. To fix a failure, edit
 * the skill content to use customer-facing terminology — never silence the
 * test.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..");
const SKILLS_DIR = resolve(REPO_ROOT, "skills");

function listMarkdownFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listMarkdownFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      out.push(full);
    }
  }
  return out;
}

type Finding = { file: string; line: number; match: string; rule: string };

function scanFile(file: string, content: string): Finding[] {
  const findings: Finding[] = [];
  const lines = content.split("\n");

  const ruleRegexes: Array<{ rule: string; re: RegExp }> = [
    { rule: "Linear ticket ID (VEK-)", re: /VEK-\d+/g },
    { rule: "Linear ticket ID (VEC-)", re: /VEC-\d+/g },
    { rule: "Internal repo name (vanalytics)", re: /\bvanalytics\b/gi },
    { rule: "Internal repo name (vektis-app)", re: /\bvektis-app\b/gi },
  ];

  // Bare internal markdown filename references — allowed only when preceded
  // by the full `.claude/skills/...` install-time path (the operational Read
  // directive that customers' Claude follows). Bare references in prose are
  // banned.
  const bareFilenames = [
    "cli-auth.md",
    "sdk-error-catalog.md",
    "KNOWN_LIMITATIONS.md",
    "INSERTION_RULES.md",
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;

    for (const { rule, re } of ruleRegexes) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(line)) !== null) {
        findings.push({ file, line: lineNo, match: m[0], rule });
      }
    }

    for (const fname of bareFilenames) {
      const re = new RegExp(fname.replace(/\./g, "\\."), "g");
      let m: RegExpExecArray | null;
      while ((m = re.exec(line)) !== null) {
        // Allow if preceded by .claude/skills/ (with any subdir).
        const start = m.index;
        const before = line.slice(Math.max(0, start - 32), start);
        if (/\.claude\/skills\/[^\s`'"]*$/.test(before)) continue;
        findings.push({
          file,
          line: lineNo,
          match: m[0],
          rule: `Bare internal markdown filename (${fname})`,
        });
      }
    }
  }

  return findings;
}

describe("skills content audit", () => {
  test("skills/ directory exists", () => {
    expect(statSync(SKILLS_DIR).isDirectory()).toBe(true);
  });

  test("no internal Vektis terminology in any skills/**/*.md", () => {
    const files = listMarkdownFiles(SKILLS_DIR);
    expect(files.length).toBeGreaterThan(0);

    const all: Finding[] = [];
    for (const f of files) {
      all.push(...scanFile(f, readFileSync(f, "utf8")));
    }

    if (all.length === 0) return;

    const grouped = all
      .map(
        (f) =>
          `  ${relative(REPO_ROOT, f.file)}:${f.line}  [${f.rule}]  → "${f.match}"`,
      )
      .join("\n");

    throw new Error(
      `Found ${all.length} internal-terminology leak(s) in customer-shipped skill markdown.\n` +
        `These files install onto customer machines via \`npx @vektis-io/tracker install-skills\` ` +
        `and the model paraphrases them in customer-facing output. Edit the content to use ` +
        `customer-facing terminology — do not silence this test.\n\n${grouped}\n`,
    );
  });
});
