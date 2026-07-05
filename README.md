# codebase-cartographer

**A living map of your codebase, built for AI coding agents.**

`codebase-cartographer` generates and maintains a `MAP.md` at your repo root containing the module tree, dependency graph, entry points, conventions, and git churn hotspots. AI agents read the map *before* exploring your repo — replacing dozens of exploration tool calls with a single file read. Less tokens, less latency, and agents that edit the right file on the first try.

**Design principle: 80% deterministic script, 20% LLM.** The CLI computes everything computable (tree, deps, churn, entry points) with zero API calls and zero API keys. Your agent — Claude Code, Cursor, Windsurf, [orbe](https://github.com/patrickcardosomoraes/orbe), or any harness — fills in only the semantic layer: one-line module purposes and architecture notes. On regeneration, agent-written descriptions are **preserved**; only modules whose contents changed are marked stale.

```
┌─────────────┐   deterministic    ┌──────────┐   semantic pass   ┌──────────┐
│  your repo  │ ─────────────────▶ │  MAP.md  │ ────────────────▶ │  MAP.md  │
│             │   npx cartographer │ skeleton │    your AI agent  │ complete │
└─────────────┘                    └──────────┘                   └──────────┘
```

---

## 🤖 Install via AI agent (recommended)

This tool is designed to be installed and operated by your coding agent. Paste this into Claude Code, Cursor, orbe, or any agent with shell access:

```
Install codebase-cartographer in this repo:

1. Run: npx codebase-cartographer generate
2. Open the generated MAP.md. For every module block marked
   <!-- cartographer:module path="..." hash="..." --> whose body says
   "(description pending)", read that module's key files and replace the
   placeholder with ONE sentence (max ~25 words) stating the module's
   purpose. Keep the HTML comment markers.
3. Fill the "Conventions" and "Architecture notes" sections based on what you
   observed (naming patterns, error handling, test layout; 3–5 bullets for
   architecture).
4. Install the agent skill so future sessions use the map automatically:
   download https://raw.githubusercontent.com/patrickcardosomoraes/codebase-cartographer/main/SKILL.md
   into .agents/skills/codebase-cartographer/SKILL.md AND make it visible at
   .claude/skills/codebase-cartographer/ too (a relative symlink to the
   .agents dir is fine) — Claude Code reads .claude/skills, Codex and others
   read .agents/skills.
5. Add this line to the project's agent instructions file (CLAUDE.md,
   AGENTS.md, or .cursorrules): "Read MAP.md before exploring the repository.
   Refresh it with `npx codebase-cartographer generate` after structural changes."
6. Commit MAP.md and the skill file.
```

That's the whole installation. No config files, no API keys, no build step.

## 👤 Install manually

```bash
npx codebase-cartographer generate        # writes MAP.md at repo root
npx codebase-cartographer status          # exit 0 = fresh, exit 2 = stale/missing descriptions
npx codebase-cartographer generate path/  # map a specific directory
```

Then ask your AI assistant: *"Fill in the pending descriptions in MAP.md"*.

## What goes in MAP.md

| Section | Produced by | How |
|---|---|---|
| Entry points | CLI | `package.json` main/bin/scripts, `main.rs`, `index.ts`, `#[tauri::command]` |
| Module tree (files, LOC) | CLI | filesystem scan, content hashing per module |
| Dependency graph | CLI | import parsing — TS/JS (`import`/`require`, `@/` alias) and Rust (`use crate::`, `mod`) |
| Hotspots | CLI | `git log --since="90 days ago"` — where change (and risk) concentrates |
| Module descriptions | **your agent** | one line per module, anchored by markers, preserved across regens |
| Conventions & architecture | **your agent** | marker-anchored sections |

## How staleness works

Each module block carries a content hash:

```markdown
<!-- cartographer:module path="src/agent" hash="c3d6839a3a5b" -->
### `src/agent` · 14 files · ~2.1k LOC
Agent loop: plans, executes tools, and streams events to the UI.
```

On `generate`, if the hash still matches, the description is kept verbatim. If the module changed, the description is replaced by a stale marker *that quotes the previous text* — so the agent updates with context instead of starting blind. `status` lists everything pending and exits non-zero, which makes it trivial to wire into CI or a pre-commit hook.

## SKILL.md size budget

Some harnesses inject skills into the system prompt with a **per-skill character cap** (e.g. orbe's native loop truncates each SKILL.md at 4,000 chars — silently cutting the end). The bundled SKILL.md is kept under 4,000 chars on purpose; if you fork or extend it, stay under that budget or your Rules section is the first thing to disappear.

## Adding a language

Dependency parsers are pluggable — one small object in [`cli/src/deps.ts`](cli/src/deps.ts) with a file-extension test and an extract function. TS/JS and Rust ship in v1; Python, Go, and others are straightforward PRs. Everything else (tree, churn, hotspots, entry points) already works on any language.

## Why not embeddings/RAG indexing?

Embedding indexes (what most AI IDEs use) are opaque, need re-indexing infrastructure, and retrieve fragments without structure. A MAP.md is human-readable, versioned in git, reviewable in PRs, portable across every agent harness, and gives the model *architecture*, not fragments. For most repos it also fits comfortably in a fraction of the context an exploration session would burn.

## Roadmap

- `--split` mode: `MAP.md` index + per-module files for monorepos (progressive disclosure)
- Python / Go dependency parsers
- `--check` mode for CI (fail if map is stale)
- Watch mode / git hook installer

---

## 🇧🇷 Em português

`codebase-cartographer` gera e mantém um `MAP.md` na raiz do repositório: árvore de módulos, grafo de dependências, pontos de entrada e hotspots de churn do git. Agentes de IA leem o mapa **antes** de explorar o repo — trocando dezenas de tool calls de exploração por uma leitura só.

O CLI faz os 80% determinísticos (sem API key, sem config); seu agente preenche os 20% semânticos (propósito de cada módulo, convenções, arquitetura). Descrições escritas pelo agente são preservadas entre regenerações — só módulos que mudaram voltam a ficar pendentes.

**Instalação via agente**: cole o bloco da seção *Install via AI agent* acima no Claude Code, Cursor ou orbe. **Manual**: `npx codebase-cartographer generate` e peça ao seu assistente para preencher as descrições pendentes.

Contribuições são bem-vindas — especialmente parsers de dependência para novas linguagens (é um objeto pequeno em `cli/src/deps.ts`).

## License

MIT © Patrick Cardoso
