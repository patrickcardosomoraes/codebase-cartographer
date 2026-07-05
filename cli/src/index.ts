#!/usr/bin/env node
import { writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { scanModules } from "./scan.js";
import { computeChurn } from "./churn.js";
import { computeDeps } from "./deps.js";
import { detectEntryPoints } from "./entrypoints.js";
import { emitMap, parseExisting } from "./emit.js";

const HELP = `codebase-cartographer — a living MAP.md for AI coding agents

Usage:
  npx codebase-cartographer generate [path]   Generate or refresh MAP.md at repo root
  npx codebase-cartographer status   [path]   List modules whose descriptions are missing/stale
  npx codebase-cartographer --help

The CLI writes the deterministic skeleton (tree, deps, churn, entry points) and
preserves descriptions previously written into MAP.md. Modules whose content
changed get a "stale" marker; new modules get a "pending" marker. Your AI agent
fills those in — see SKILL.md in the repo for the exact protocol.
`;

function run(): void {
  const [cmd = "generate", pathArg = "."] = process.argv.slice(2).filter((a) => a !== "--");
  if (cmd === "--help" || cmd === "-h" || cmd === "help") {
    console.log(HELP);
    return;
  }

  const root = resolve(pathArg);
  if (!existsSync(root)) {
    console.error(`Path not found: ${root}`);
    process.exit(1);
  }

  const modules = scanModules(root);
  if (!modules.length) {
    console.error("No source files found — nothing to map.");
    process.exit(1);
  }

  const existing = parseExisting(root);
  const { markdown, pending } = emitMap({
    modules,
    deps: computeDeps(root, modules),
    hotspots: computeChurn(root, modules),
    entryPoints: detectEntryPoints(root),
    existing,
  });

  if (cmd === "status") {
    if (!existsSync(join(root, "MAP.md"))) {
      console.log("MAP.md not found. Run: npx codebase-cartographer generate");
      process.exit(2);
    }
    if (pending.length) {
      console.log(`Stale or missing descriptions (${pending.length}):`);
      for (const p of pending) console.log(`  - ${p}`);
      console.log("\nRun `generate`, then have your AI agent fill the markers (see SKILL.md).");
      process.exit(2);
    }
    console.log("MAP.md is up to date. ✔");
    return;
  }

  if (cmd !== "generate") {
    console.error(`Unknown command: ${cmd}\n`);
    console.log(HELP);
    process.exit(1);
  }

  writeFileSync(join(root, "MAP.md"), markdown, "utf8");
  console.log(`MAP.md written — ${modules.length} modules.`);
  if (pending.length) {
    console.log(`\n${pending.length} item(s) need agent descriptions:`);
    for (const p of pending) console.log(`  - ${p}`);
    console.log(
      "\nNext step (for AI agents): open MAP.md, find `cartographer:` markers,\nread each module's key files, and replace placeholders with one-line purposes.",
    );
  }
}

run();
