#!/usr/bin/env node
// Entry for `npx @vektis-io/tracker <subcommand>`. Currently only
// `install-skills` is supported. Future subcommands (`doctor`, `version`)
// can be added here.

const sub = process.argv[2];

if (sub === "install-skills") {
  const { installSkills } = await import("./install-skills.mjs");
  const code = await installSkills({ argv: process.argv.slice(3) });
  process.exit(code);
} else if (!sub || sub === "--help" || sub === "-h") {
  console.log(
    [
      "Usage:",
      "  npx @vektis-io/tracker install-skills [--create] [--force]",
      "",
      "Subcommands:",
      "  install-skills   Install VEKTIS Claude Code skills into <project>/.claude/skills/",
      "                   --create  Create .claude/ if it does not exist",
      "                   --force   Overwrite skills even if .vektis-managed marker is missing",
    ].join("\n"),
  );
  process.exit(0);
} else {
  console.error(`vektis: unknown subcommand "${sub}". Run with --help for usage.`);
  process.exit(2);
}
