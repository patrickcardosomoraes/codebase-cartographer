import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ModuleInfo } from "./scan.js";
import { fileToModule, toPosix } from "./scan.js";

/**
 * Pluggable dependency extraction. Each parser receives a file (path + content)
 * and returns the raw import targets it can see. Resolution to modules happens
 * in a common pass so parsers stay tiny.
 *
 * To add a language: add a matcher + extractor below. PRs welcome.
 */

type Extractor = (file: string, content: string) => string[];

const TS_IMPORT =
  /(?:import|export)\s+(?:[\s\S]*?from\s+)?["']([^"']+)["']|require\(\s*["']([^"']+)["']\s*\)/g;

const RUST_USE = /^\s*(?:pub\s+)?use\s+crate::([A-Za-z0-9_]+)/gm;
const RUST_MOD = /^\s*(?:pub\s+)?mod\s+([A-Za-z0-9_]+)\s*;/gm;

/**
 * A Rust `crate::` path is rooted at the crate's `src/` directory. Given the
 * directory of the file doing the `use`, walk up to the last `src` segment and
 * return that (e.g. `src-tauri/src/agent` → `src-tauri/src`). Falls back to the
 * file's own directory when there is no `src` segment (unconventional layout).
 */
export function crateRoot(dir: string): string {
  const parts = dir.split("/");
  const idx = parts.lastIndexOf("src");
  return idx === -1 ? dir : parts.slice(0, idx + 1).join("/");
}

const extractors: Array<{ test: RegExp; extract: Extractor }> = [
  {
    test: /\.(ts|tsx|js|jsx|mjs|cjs|vue|svelte)$/,
    extract: (file, content) => {
      const targets: string[] = [];
      for (const m of content.matchAll(TS_IMPORT)) {
        const spec = m[1] ?? m[2];
        if (!spec) continue;
        if (spec.startsWith(".")) {
          targets.push(toPosix(join(dirname(file), spec)));
        } else if (spec.startsWith("@/")) {
          targets.push("src/" + spec.slice(2)); // common alias convention
        }
        // bare specifiers (npm packages) are ignored: external deps live in package.json
      }
      return targets;
    },
  },
  {
    test: /\.rs$/,
    extract: (file, content) => {
      const targets: string[] = [];
      const dir = toPosix(dirname(file));
      // `crate::X` → top-level module X of THIS crate. Resolve to the crate's
      // src root (walk up to the last `src` segment), NOT a hardcoded prefix.
      const root = crateRoot(dir);
      for (const m of content.matchAll(RUST_USE)) targets.push(`${root}/${m[1]}`);
      // `mod X;` → submodule relative to the current file's directory.
      for (const m of content.matchAll(RUST_MOD)) targets.push(`${dir}/${m[1]}`);
      return targets;
    },
  },
];

/** Returns edges as "fromModule -> Set(toModule)". */
export function computeDeps(root: string, modules: ModuleInfo[]): Map<string, Set<string>> {
  const edges = new Map<string, Set<string>>();

  for (const mod of modules) {
    for (const file of mod.files) {
      const parser = extractors.find((e) => e.test.test(file));
      if (!parser) continue;
      let content: string;
      try {
        content = readFileSync(join(root, file), "utf8");
      } catch {
        continue;
      }
      for (const target of parser.extract(file, content)) {
        // try target, target minus extension-ish suffixes, and its parent dirs
        const candidates = [target, target.replace(/\.(ts|tsx|js|jsx|rs)$/, "")];
        let toModule: string | null = null;
        for (const c of candidates) {
          toModule = fileToModule(c, modules) ?? fileToModule(c + "/index.ts", modules);
          if (toModule) break;
        }
        if (!toModule || toModule === mod.path) continue;
        let set = edges.get(mod.path);
        if (!set) edges.set(mod.path, (set = new Set()));
        set.add(toModule);
      }
    }
  }
  return edges;
}
