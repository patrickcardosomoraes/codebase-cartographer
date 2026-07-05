---
name: codebase-cartographer
description: Maintains a living map (MAP.md) of any codebase — module tree, dependency graph, entry points, conventions, and churn hotspots. ALWAYS read MAP.md (if present at the repo root) BEFORE exploring the repository with file listings or searches; it replaces dozens of exploration tool calls. Use this skill whenever you start working in a repo, when the user asks "where is X", "how is this project structured", "which modules are risky", "map the codebase", "update the map", or after making changes that add/remove/move modules. Also use it when MAP.md contains pending description markers that need to be filled in.
---

# Codebase Cartographer

You maintain `MAP.md` at the repo root: the codebase's spatial memory — what exists, where it lives, how modules connect, where risk concentrates.

## Division of labor
- **CLI does the deterministic 80%**: tree, dependency edges, churn, entry points, staleness tracking. Never compute these by hand — run the CLI.
- **You do the semantic 20%**: one-line module purposes, conventions, architecture notes. The CLI leaves markers showing exactly where.

## Altitude
MAP.md is **module-level**. It answers "which module, and why"; symbol outlines/grep/LSP answer "which function". If your harness also injects a symbol map, read MAP.md first to pick the module, then use symbol tools within it. Never copy project RULES (CLAUDE.md/AGENTS.md) into MAP.md: the map says where things are; instructions say how to work.

## Workflows

### 1. Starting work in a repo
1. `MAP.md` exists → **read it before any ls/glob/grep exploration**.
2. Missing → offer to generate (workflow 2).
3. Cheap freshness check: `npx codebase-cartographer status` (exit 0 fresh; exit 2 stale/missing). **Stale descriptions are untrustworthy** — verify in code and offer a refresh. A stale map silently believed is worse than no map.

### 2. Generating or refreshing
```bash
npx codebase-cartographer generate        # repo root
npx codebase-cartographer generate path/  # subdir / monorepo package
```
Deterministic sections regenerate fully; your previous descriptions are **preserved** unless that module's contents changed (then the CLI re-marks it pending). If `npx` fails (offline, package unavailable): MAP.md is still readable — use it, say regeneration is unavailable, never fake a fresh run.

### 3. Filling descriptions (your semantic pass)
Find pending module blocks:
```
<!-- cartographer:module path="src/agent" hash="…" -->
### `src/agent` · 4 files · ~3.5k LOC
_(description pending — fill via AI agent, see SKILL.md)_
```
(Sections use `<!-- cartographer:section id="…" -->`.)
For each: read the module's entry file + 2–3 largest or most-imported files; replace the placeholder with **one sentence** (≤25 words) naming the module's purpose and key responsibility (cite pivotal files). Keep the HTML marker.
Good: `Tauri command layer: exposes agent lifecycle (start/stop/approve) to the React frontend via IPC.`
Bad: `Contains various files related to commands.`
Then fill `## Conventions` (naming, error handling, test layout — patterns you actually observed, not aspirations) and `## Architecture notes` (3–5 bullets: layers, data flow, key decisions).

### 4. After you change the codebase
Added/removed/moved a module, or changed its purpose → run `generate` and update the affected descriptions **before declaring the task done**. Keeping the map honest is part of finishing.

## Rules
- Navigation, not documentation: point; don't explain at length.
- Never delete `<!-- cartographer:... -->` markers — they are the CLI's anchors.
- Never hand-edit deterministic sections (tree/deps/churn/entry points) — the CLI overwrites them; rerun instead.
- Trust the churn table: hotspots are where bugs live. When the user is about to modify one, say so and suggest extra care (tests, review).
- Huge repo (MAP.md > ~400 lines) → propose per-module split (see CLI README).
