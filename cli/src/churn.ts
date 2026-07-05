import { execFileSync } from "node:child_process";
import type { ModuleInfo } from "./scan.js";
import { fileToModule, isSourceFile } from "./scan.js";

export interface Hotspot {
  module: string;
  commits: number;
  topFile: string;
}

export function computeChurn(root: string, modules: ModuleInfo[], days = 90): Hotspot[] {
  let out: string;
  try {
    out = execFileSync(
      "git",
      ["log", `--since=${days} days ago`, "--name-only", "--pretty=format:%H"],
      { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] },
    );
  } catch {
    return []; // not a git repo, or git unavailable — churn is optional
  }

  const moduleCommits = new Map<string, Set<string>>();
  const fileTouches = new Map<string, number>();
  let currentCommit = "";

  for (const line of out.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    if (/^[0-9a-f]{40}$/.test(t)) {
      currentCommit = t;
      continue;
    }
    if (!isSourceFile(t)) continue;
    fileTouches.set(t, (fileTouches.get(t) ?? 0) + 1);
    const mod = fileToModule(t, modules);
    if (!mod) continue;
    let set = moduleCommits.get(mod);
    if (!set) moduleCommits.set(mod, (set = new Set()));
    set.add(currentCommit);
  }

  const hotspots: Hotspot[] = [];
  for (const [module, commits] of moduleCommits) {
    let topFile = "";
    let top = -1;
    for (const [f, n] of fileTouches) {
      const owner = fileToModule(f, modules);
      if (owner === module && n > top) {
        top = n;
        topFile = f;
      }
    }
    hotspots.push({ module, commits: commits.size, topFile });
  }
  hotspots.sort((a, b) => b.commits - a.commits);
  return hotspots.slice(0, 10);
}
