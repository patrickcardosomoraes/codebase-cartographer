import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

export interface ModuleInfo {
  /** POSIX-style path relative to repo root, e.g. "src/agent" */
  path: string;
  files: string[]; // relative POSIX paths of source files directly in this module (recursive within it)
  loc: number;
  hash: string; // content hash of all source files (staleness detection)
}

const IGNORE_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "out", "target", ".next", ".nuxt",
  "coverage", ".turbo", ".cache", "vendor", "__pycache__", ".venv", "venv",
  ".cartographer", ".idea", ".vscode",
]);

const SOURCE_EXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".rs", ".py", ".go", ".rb",
  ".java", ".kt", ".swift", ".c", ".h", ".cpp", ".hpp", ".cs", ".php", ".vue", ".svelte",
]);

const MAX_MODULE_DEPTH = 3;

function ext(name: string): string {
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i).toLowerCase();
}

export function toPosix(p: string): string {
  return p.split(sep).join("/");
}

/**
 * A "module" is a directory (up to depth MAX_MODULE_DEPTH) that directly contains
 * source files. Deeper directories are folded into their nearest module ancestor.
 * Source files at the repo root form the pseudo-module ".".
 */
export function scanModules(root: string): ModuleInfo[] {
  const modules = new Map<string, string[]>(); // modulePath -> files

  function walk(dir: string, depth: number, currentModule: string | null): void {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    const rel = toPosix(relative(root, dir)) || ".";
    const filesHere = entries.filter(
      (e) => e.isFile() && SOURCE_EXT.has(ext(e.name)),
    );

    let moduleForChildren = currentModule;
    if (filesHere.length > 0) {
      const owner =
        currentModule !== null && depth > MAX_MODULE_DEPTH ? currentModule : rel;
      moduleForChildren = owner;
      const list = modules.get(owner) ?? [];
      for (const f of filesHere) list.push(rel === "." ? f.name : `${rel}/${f.name}`);
      modules.set(owner, list);
    }

    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (IGNORE_DIRS.has(e.name) || e.name.startsWith(".")) continue;
      walk(join(dir, e.name), depth + 1, moduleForChildren);
    }
  }

  walk(root, 0, null);

  const result: ModuleInfo[] = [];
  for (const [path, files] of modules) {
    files.sort();
    let loc = 0;
    const h = createHash("sha1");
    for (const f of files) {
      try {
        const content = readFileSync(join(root, f), "utf8");
        loc += content.split("\n").length;
        h.update(f).update("\0").update(content);
      } catch {
        /* unreadable file: skip */
      }
    }
    result.push({ path, files, loc, hash: h.digest("hex").slice(0, 12) });
  }
  result.sort((a, b) => a.path.localeCompare(b.path));
  return result;
}

/** Map a source file path to the module that owns it. */
export function fileToModule(file: string, modules: ModuleInfo[]): string | null {
  let best: string | null = null;
  for (const m of modules) {
    if (m.path === "." ? !file.includes("/") : file === m.path || file.startsWith(m.path + "/")) {
      if (best === null || m.path.length > best.length) best = m.path;
    }
  }
  return best;
}

export function isSourceFile(file: string): boolean {
  return SOURCE_EXT.has(ext(file));
}

export function fmtLoc(loc: number): string {
  return loc >= 1000 ? `~${(loc / 1000).toFixed(1)}k LOC` : `${loc} LOC`;
}
