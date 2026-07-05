import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

export interface EntryPoint {
  name: string;
  path: string;
  kind: string;
}

export function detectEntryPoints(root: string): EntryPoint[] {
  const entries: EntryPoint[] = [];

  // package.json: main / bin / key scripts
  const pkgPath = join(root, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      if (typeof pkg.main === "string") entries.push({ name: "main", path: pkg.main, kind: "main" });
      if (typeof pkg.bin === "string") entries.push({ name: pkg.name ?? "bin", path: pkg.bin, kind: "bin" });
      else if (pkg.bin && typeof pkg.bin === "object")
        for (const [name, p] of Object.entries(pkg.bin))
          entries.push({ name, path: String(p), kind: "bin" });
      for (const s of ["dev", "start", "build", "test"])
        if (pkg.scripts?.[s]) entries.push({ name: `npm run ${s}`, path: pkg.scripts[s], kind: "script" });
    } catch { /* malformed package.json */ }
  }

  // Common file-based entries
  for (const candidate of [
    "src/index.ts", "src/index.tsx", "src/main.ts", "src/main.tsx", "src/App.tsx",
    "src/main.rs", "src-tauri/src/main.rs", "src-tauri/src/lib.rs", "main.py", "app.py", "main.go",
  ]) {
    if (existsSync(join(root, candidate)))
      entries.push({ name: candidate.split("/").pop()!, path: candidate, kind: "main" });
  }

  // Tauri commands (grep for #[tauri::command]) — cheap and very useful for Tauri apps
  try {
    const out = execFileSync(
      "git",
      ["grep", "-l", "#\\[tauri::command\\]", "--", "*.rs"],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    for (const f of out.split("\n").filter(Boolean))
      entries.push({ name: "tauri commands", path: f, kind: "tauri-command" });
  } catch { /* no matches or not a git repo */ }

  // Dedup by path+kind
  const seen = new Set<string>();
  return entries.filter((e) => {
    const k = `${e.path}|${e.kind}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
