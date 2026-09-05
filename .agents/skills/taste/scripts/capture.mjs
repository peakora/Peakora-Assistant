#!/usr/bin/env node
// Copyright (c) 2026 Peakora. All rights reserved. Licensed under the MIT License; see NOTICE and LICENSE.
/**
 * capture.mjs - headless browser capture for the taste skill.
 *
 * The taste skill upstream relies on the Playwright MCP server's
 * `browser_evaluate` tool to run extract.js inside a real page. OpenHands
 * does not expose a "evaluate JS in page" browser tool, so this script does
 * the capture directly with the Playwright Node library (the same engine the
 * MCP server wraps). No MCP server required.
 *
 * Usage:
 *   npx playwright install chromium     # one-time ~100MB download
 *   node scripts/capture.mjs <url> [outdir]
 *
 * Output:
 *   - prints the extract.js DOM/CSS snapshot as JSON to stdout (the agent
 *     reads this as `domData` for Step 1 - Measure).
 *   - writes <domain>-viewport.jpeg and <domain>-fullpage.jpeg to outdir
 *     (default: the cwd).
 *
 * If Playwright/chromium is not installed, prints a clear install hint and
 * exits 2.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const url = process.argv[2];
const outdir = process.argv[3] || process.cwd();

if (!url) {
  console.error("capture.mjs: usage: node scripts/capture.mjs <url> [outdir]");
  process.exit(1);
}

function domainOf(u) {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "site";
  }
}
const domain = domainOf(url);

let chromium;
try {
  // Resolve playwright from the cwd's node_modules (where the user installs
  // it). createRequire gives us require() scoped to the cwd, which respects
  // the package's "require" export and returns the module with the `chromium`
  // named export. A bare dynamic import() would fail when this script lives
  // outside the project that owns the playwright install.
  const { createRequire } = await import("node:module");
  const cwdReq = createRequire(path.resolve(process.cwd(), "noop.js"));
  const pw = cwdReq("playwright");
  chromium = pw.chromium;
  if (!chromium) throw new Error("playwright loaded but `chromium` export missing");
} catch {
  console.error(
    "capture.mjs: Playwright is not installed in the current project. Run:\n" +
      "  npm install playwright && npx playwright install chromium\n" +
      "(the chromium download is a one-time ~100MB). Then retry from a dir\n" +
      "whose node_modules contains `playwright`."
  );
  process.exit(2);
}

const browser = await chromium.launch({ headless: true });
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(3000);

  const viewportShot = path.join(outdir, `${domain}-viewport.jpeg`);
  await page.screenshot({ path: viewportShot, type: "jpeg", quality: 85 });
  console.error(`[capture] viewport screenshot -> ${viewportShot}`);

  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  if (height <= 5400) {
    const fullShot = path.join(outdir, `${domain}-fullpage.jpeg`);
    await page.screenshot({ path: fullShot, fullPage: true, type: "jpeg", quality: 85 });
    console.error(`[capture] fullpage screenshot -> ${fullShot}`);
  } else {
    const midShot = path.join(outdir, `${domain}-mid.jpeg`);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight * 0.5));
    await page.screenshot({ path: midShot, type: "jpeg", quality: 85 });
    const footerShot = path.join(outdir, `${domain}-footer.jpeg`);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.screenshot({ path: footerShot, type: "jpeg", quality: 85 });
    await page.evaluate(() => window.scrollTo(0, 0));
    console.error(`[capture] mid + footer screenshots (page too tall for fullpage)`);
  }

  // Run the upstream extract.js inside the page to get the DOM/CSS snapshot.
  const extractPath = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "..",
    "references",
    "extract.js"
  );
  // extract.js is an arrow fn `() => {...}` preceded by a comment header and
  // optionally followed by a trailing semicolon. To run it under
  // page.evaluate we wrap it as an IIFE: `(<arrowFn>)()`. Strip a trailing
  // semicolon first so the wrap does not become `(()=>{}; )()`.
  let extractSrc = fs.readFileSync(extractPath, "utf8").trim();
  extractSrc = extractSrc.replace(/;+\s*$/, "");
  const snapshot = await page.evaluate(`(${extractSrc})()`);
  process.stdout.write(JSON.stringify(snapshot, null, 2));
} finally {
  await browser.close();
}
