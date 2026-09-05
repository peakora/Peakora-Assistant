#!/usr/bin/env node
// Copyright (c) 2026 Peakora. All rights reserved. Licensed under the MIT License; see NOTICE and LICENSE.
/**
 * resolve-skill.mjs - resolve impeccable's source templates for OpenHands.
 *
 * impeccable ships SKILL.src.md with three template variables that its own
 * cross-provider build normally substitutes:
 *   {{scripts_path}}   -> absolute path to this skill's scripts/ directory
 *   {{command_prefix}} -> "/" (the upstream source default; we keep it so the
 *                          command table reads `/impeccable <cmd>`)
 *   {{command_hint}}   -> "[<command>] [target]" (from command-metadata.json)
 *
 * We are OpenHands, not Claude Code/Cursor/etc., so the upstream build never
 * runs for us. This script does the substitution ourselves and writes the
 * resolved SKILL.md next to SKILL.src.md. Re-run after any upstream sync.
 *
 * Usage:  node scripts/resolve-skill.mjs
 *         (run from the skill dir, or pass the skill dir as $1)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const skillDir = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(here, "..");
const srcFile = path.join(skillDir, "SKILL.src.md");
const outFile = path.join(skillDir, "SKILL.md");
const metaFile = path.join(skillDir, "scripts", "command-metadata.json");

if (!fs.existsSync(srcFile)) {
  console.error(`resolve-skill: SKILL.src.md not found at ${srcFile}`);
  process.exit(1);
}

const scriptsPath = path.join(skillDir, "scripts");
let body = fs.readFileSync(srcFile, "utf8");

// {{scripts_path}} -> the scripts/ directory of THIS skill install. The path
// is self-relative (derived from import.meta.url), so it is correct on
// whichever machine ran this resolver. The resolved SKILL.md is mainly
// recalled as reference text; the scripts are a convenience for a local hub
// checkout, not a cross-repo requirement (the agent reads PRODUCT.md and the
// playbooks directly when the hub is not local).
body = body.replace(/\{\{scripts_path\}\}/g, scriptsPath);

// {{command_prefix}} -> "/" (the source default; provider.mjs sets "/" for source).
body = body.replace(/\{\{command_prefix\}\}/g, "/");

// {{command_hint}} -> "craft|init|...|typeset" derived from the command
// table. The source frontmatter is "[{{command_hint}}] [target]", so the
// hint is the bare command list (no [target], no extra brackets).
let hint = "command";
if (fs.existsSync(metaFile)) {
  try {
    const meta = JSON.parse(fs.readFileSync(metaFile, "utf8"));
    const cmds = Object.keys(meta);
    if (cmds.length) hint = cmds.join("|");
  } catch {
    // keep default hint
  }
}
body = body.replace(/\{\{command_hint\}\}/g, hint);

fs.writeFileSync(outFile, body, "utf8");
console.log(`resolve-skill: wrote ${outFile}`);
console.log(`  scripts_path = ${scriptsPath}`);
console.log(`  command_prefix = /`);
console.log(`  command_hint = ${hint}`);
