import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanModules } from "./scan.js";
import { computeDeps, crateRoot } from "./deps.js";
import { emitMap, parseExisting } from "./emit.js";

// crateRoot: `crate::` is rooted at the crate's src/ dir, resolved from the
// file's own directory — NOT a hardcoded prefix. This is where the Rust
// false-edge bug lived (targets were pinned to src-tauri/src and src).
test("crateRoot resolves to the last src segment", () => {
  assert.equal(crateRoot("src-tauri/src/agent"), "src-tauri/src");
  assert.equal(crateRoot("src-rs/src"), "src-rs/src");
  assert.equal(crateRoot("crates/foo/src/bin"), "crates/foo/src");
  assert.equal(crateRoot("src"), "src");
});

test("crateRoot falls back to the dir when there is no src segment", () => {
  assert.equal(crateRoot("lib/thing"), "lib/thing");
  assert.equal(crateRoot("."), ".");
});

// Build a throwaway repo on disk and run the real scan + dep pass over it.
function withFixture(files: Record<string, string>, fn: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), "cartog-deps-"));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const abs = join(root, rel);
      mkdirSync(join(abs, ".."), { recursive: true });
      writeFileSync(abs, content);
    }
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function edgesOf(root: string): Record<string, string[]> {
  const map = computeDeps(root, scanModules(root));
  const out: Record<string, string[]> = {};
  for (const [from, set] of map) out[from] = [...set].sort();
  return out;
}

test("JS relative + @/ alias imports resolve to the right modules", () => {
  withFixture(
    {
      "src/index.js": `import { core } from "./core/engine.js";\nimport { u } from "@/api/users.js";\nexport const m = () => core() + u();`,
      "src/core/engine.js": `export const core = () => 42;`,
      "src/api/users.js": `import { core } from "../core/engine.js";\nexport const u = () => core();`,
    },
    (root) => {
      const e = edgesOf(root);
      assert.deepEqual(e["src"], ["src/api", "src/core"]); // relative + @/ alias
      assert.deepEqual(e["src/api"], ["src/core"]);
      assert.equal(e["src/core"], undefined); // leaf, no outgoing edges
    },
  );
});

test("Rust use crate:: resolves within its own crate — no cross-crate false edge", () => {
  withFixture(
    {
      // JS crate whose module is literally "src" — the old bug wrongly linked here
      "src/index.js": `export const x = 1;`,
      // Rust crate elsewhere: crate::util is INTERNAL to src-rs, must not touch JS "src"
      "src-rs/src/main.rs": `mod util;\nuse crate::util::helper;\nfn main() { helper(); }`,
      "src-rs/src/util.rs": `pub fn helper() -> i32 { 7 }`,
    },
    (root) => {
      const e = edgesOf(root);
      // crate::util + mod util are same-module → self-edge dropped → no outgoing edge
      assert.equal(e["src-rs/src"], undefined);
      // and crucially: nothing points at the JS "src" module
      for (const targets of Object.values(e)) {
        assert.ok(!targets.includes("src"), `unexpected false edge to JS src: ${JSON.stringify(e)}`);
      }
    },
  );
});

test("Rust crate:: links to a real sibling top-level module", () => {
  withFixture(
    {
      "src/main.rs": `mod config;\nuse crate::config::load;\nfn main() { load(); }`,
      "src/config/mod.rs": `pub fn load() {}`,
    },
    (root) => {
      const e = edgesOf(root);
      assert.deepEqual(e["src"], ["src/config"]); // crate::config → src/config
    },
  );
});

test("monorepo: two Rust crates stay isolated (crate:: never leaks across crates)", () => {
  withFixture(
    {
      "crates/a/src/main.rs": `mod helper;\nuse crate::helper::go;\nfn main() { go(); }`,
      "crates/a/src/helper.rs": `pub fn go() {}`,
      "crates/b/src/main.rs": `mod thing;\nuse crate::thing::run;\nfn main() { run(); }`,
      "crates/b/src/thing.rs": `pub fn run() {}`,
    },
    (root) => {
      const e = edgesOf(root);
      // each crate::X is internal → self-edge dropped → no outgoing edges
      assert.equal(e["crates/a/src"], undefined);
      assert.equal(e["crates/b/src"], undefined);
      // and neither crate points at the other
      for (const targets of Object.values(e)) {
        assert.ok(!targets.includes("crates/a/src"));
        assert.ok(!targets.includes("crates/b/src"));
      }
    },
  );
});

test("TSX and Vue imports resolve (incl. @/ alias)", () => {
  withFixture(
    {
      "src/ui/Button.tsx": `import { fmt } from "@/lib/util.js";\nexport const B = () => fmt();`,
      "src/ui/Card.vue": `<script setup lang="ts">\nimport { fmt } from "@/lib/util.js";\n</script>\n<template><div/></template>`,
      "src/lib/util.ts": `export const fmt = () => "x";`,
    },
    (root) => {
      const e = edgesOf(root);
      assert.deepEqual(e["src/ui"], ["src/lib"]); // both tsx + vue point at src/lib
      assert.equal(e["src/lib"], undefined); // leaf
    },
  );
});

// Regression: regenerating a stale module repeatedly must NOT nest the stale
// wrapper ("previous: previous: previous: ..."), and must keep it pending.
test("stale markers do not nest across repeated regenerations", () => {
  const modAt = (hash: string) => ({ path: "m", files: ["m/a.ts"], loc: 10, hash });
  const base = { deps: new Map(), hotspots: [], entryPoints: [] };

  // gen1: agent authored a real description at hash h1
  let md = emitMap({ ...base, modules: [modAt("h1")],
    existing: { descriptions: new Map([["m", { hash: "h1", text: "Real purpose.", stale: false }]]), sections: new Map() },
  }).markdown;

  // module changes → h2, h3, h4 with the agent never re-filling
  for (const h of ["h2", "h3", "h4"]) {
    const withMap = md.replace(/^# Codebase Map/, "# Codebase Map"); // no-op; md is the file
    // write md to a temp MAP.md and parse it back like the CLI does
    const root = mkdtempSync(join(tmpdir(), "cartog-stale-"));
    try {
      writeFileSync(join(root, "MAP.md"), withMap);
      const existing = parseExisting(root);
      md = emitMap({ ...base, modules: [modAt(h)], existing }).markdown;
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  const staleLines = md.split("\n").filter((l) => l.includes("stale — module changed"));
  assert.equal(staleLines.length, 1);
  // exactly one wrapper: the innermost original text survives, no nesting
  assert.match(staleLines[0], /previous: "Real purpose\."\)_$/);
  assert.equal((staleLines[0].match(/previous:/g) || []).length, 1);
});
