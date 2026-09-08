# Vibe

**A command center for agent-driven development.** Not another IDE with AI bolted on — a workspace built from the ground up to orchestrate many coding agents on one codebase.

Free forever, open source, works out of the box with FOSS models.

## Why

Modern coding is drifting from "human writes code" to "human directs agents." Existing tools handle one agent at a time, in a chat sidebar next to an editor designed for solo humans. Vibe flips that: agents are the workflow, and the UI is a mission control for supervising them.

**Guiding principles:**

- **FOSS-first.** Vibe works with zero cost from day one — free-tier OpenRouter models or local Ollama. Bring paid keys when the task warrants it.
- **Command center, not IDE.** The human orchestrates. No tab-completion, no Copilot-style ghost text. Different tool for different work.
- **Isolation is free.** Each agent runs in its own git worktree on its own branch. No stepping on each other's files.
- **The human stays in control.** Every merge, every proposed task, every context update gets human review.

## Quick start (60 seconds)

Requires Node 20+ and Git 2.5+.

```bash
git clone <this repo>
cd vibe
npm install
npm run dev
```

On first launch:
1. Paste an OpenRouter API key ([free signup, no card](https://openrouter.ai))
2. Click **Test free models** — Vibe probes which are currently live for your account and picks working ones
3. Pick a workspace folder (a git repo will be initialized if needed)
4. Click **Start**

Then in Control Center: **+ agent** → give it a task → watch it work.

**No key at all?** If you have [Ollama](https://ollama.com) installed with a tool-capable model (llama3.1, llama3.2, qwen2.5-coder), Vibe auto-detects it on setup. You can set the model to `ollama/<name>` and skip the API key.

## The three onboarding paths

| Path | Cost | Setup | Best for |
|---|---|---|---|
| **OpenRouter free** | $0 (50 req/day cap) | Paste one key | Trying Vibe out |
| **Local Ollama** | $0 (no cap) | Install Ollama, pull a model | Privacy, offline, unlimited use |
| **OpenRouter paid / BYO frontier key** | Real dollars | Same key + credit | Serious work, frontier quality |

## What ships in v0.2

**Core**
- Up to 8 concurrent agents, each in its own git worktree + branch
- Multi-turn conversation with agents (`ask_human` tool, follow-up during `awaiting_merge`)
- Kill/interrupt running agents
- Streaming responses via SSE
- Sibling awareness (agents know what other agents are working on)
- Per-task model pinning (no mid-loop model chaos)
- Persisted agent state across restarts

**Provider stack**
- OpenAI-compatible adapter routes to OpenRouter, Ollama, or any compatible endpoint
- Fallback chains (`openrouter/free,minimax/minimax-m3:free`) with automatic failover
- On-startup probe: tests which free models actually work for your account
- Friendly error messages for common failures (rate limits, deprecated models, CUDA crashes)

**AI-assisted merges**
- Merge conflict resolution agent with inline diff view (before/after per file, syntax-highlighted markers)
- File overlap warnings before merge (against sibling agent branches)

**Project management (PM) agent**
- Runs automatically after every merge to update `.vibe/context/summary.md`
- Proposes follow-up tasks based on observed changes (human accepts/dismisses)
- Chat with it directly from the Tasks screen
- Its summary is injected into every agent's prompt — shared, current project state

**Workspace hygiene**
- Auto-seeded workspace `.gitignore` (excludes secrets, `.vibe/worktrees/`, bytecode, deps)
- Auto-seeded workspace `.vibe/AGENTS.md` (per-project customization)
- Dependency isolation guidance for agents (create venvs, avoid global installs)

**UI**
- Sidebar nav: Control Center · Tasks · Cost · Context · Settings
- Control Center grid: all agents at a glance, click any tile to focus
- Tasks kanban: Backlog / In Progress / Awaiting Merge / Done + Proposed row
- Cost view: per-agent token counts and estimated dollars, sourced from OpenRouter pricing
- Context tabs: Project (human-owned) | Summary (PM-maintained)

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Renderer (React + Zustand)                     │
│  - Sidebar, Control Center, Agent panels        │
│  - Tasks kanban, Cost, Context tabs             │
│  - Never touches disk or network directly       │
└─────────────────┬───────────────────────────────┘
                  │ IPC (contextBridge)
┌─────────────────▼───────────────────────────────┐
│  Electron main process                          │
│  - Agent lifecycle (spawn, kill, close)         │
│  - Git worktrees (create, merge, cleanup)       │
│  - Provider adapters (OpenRouter, Ollama)       │
│  - PM agent (post-merge summary + task propose) │
│  - Merge conflict resolver                      │
│  - Persistence (.vibe/agents/*.json)            │
└─────────────────────────────────────────────────┘
```

Each user workspace has:
```
your-project/
├── .git/
├── .gitignore              # seeded by Vibe on first init
├── src/, tests/, etc.      # your actual code
└── .vibe/
    ├── AGENTS.md           # per-project agent conventions
    ├── context/
    │   ├── project.md      # human-owned project brief
    │   └── summary.md      # PM-maintained running state
    ├── tasks.json          # kanban backing store
    ├── agents/             # persisted agent state (chat, task, branch)
    └── worktrees/          # git worktrees per agent (gitignored)
```

## Development

```bash
npm run dev         # Electron dev with hot reload
npm run build       # Production build
npm run typecheck   # tsc across main + renderer
npm test            # Node's built-in test runner via tsx (69 tests as of v0.3)
```

## Known issues / rough edges

Being upfront about the state of the app while it's still stabilizing:

- **Cost tracking is per-task, not persistent.** Closing an agent or starting a new
  task resets its token counter. There's no session/daily/all-time total yet. A
  proper persistent cost ledger is on the backlog.
- **Small local models produce small-model results.** Free-tier and 3B Ollama models
  often mis-format tool calls, hallucinate URLs into binary files, or ignore
  AGENTS.md guidance. This is a model-quality floor, not a Vibe bug. BYOK Anthropic
  or a paid OpenRouter tier fixes it.
- **Sibling context refreshes on human re-engagement, not every turn.** Cost-
  conservative: the current agent sees fresh sibling state (plus fresh project
  summary and context) whenever you reply to it, but not on every internal loop
  turn. If a sibling starts/finishes mid-turn, the current agent won't notice
  until you re-engage. File-overlap warnings at merge time cover the practical
  worst case regardless.
- **PM agent runs on the same global model as coding agents.** No dedicated
  model-per-role yet (individual agents can override, PM cannot).
- **UI polish is uneven.** Some screens (Control Center, Cost) are tight; others
  (Setup, Merge conflict banner) could use another pass.
- **No sandboxing on `run_bash`.** Agents can install packages globally,
  read/modify files outside the worktree via shell, etc. Use a scratch workspace
  when testing. Container-per-agent isolation is planned.

## Security

**API keys** live in Electron's per-user data directory (`%APPDATA%\vibe\config.json` on Windows, `~/Library/Application Support/vibe/config.json` on macOS), unencrypted. Outside the project folder so they won't be committed. Migration to OS-level credential storage (`safeStorage`) is on the roadmap.

**Agents run unsandboxed.** `run_bash` executes arbitrary commands in the agent's worktree. Vibe blocks path escapes for `read_file`/`write_file` but does not sandbox `run_bash`. Use a scratch workspace when trying tasks; don't point Vibe at folders with production secrets. Container-per-agent isolation is planned for the BYOC (bring-your-own-compute) roadmap.

**What never gets committed:** the auto-seeded workspace `.gitignore` excludes `.env`, `*.pem`, `*.key`, common secret patterns, and `.vibe/worktrees/`. Review it before adding sensitive files.

## Roadmap

**Near term**
- Container-per-agent isolation for `run_bash` sandboxing (approval shell already ships)
- Encrypted key storage via Electron's `safeStorage`
- PM-agent model override (individual agents already have per-agent override)
- Dynamic model catalogs — fetch each provider's `/v1/models` endpoint at runtime
  instead of hand-curating slug lists in `ModelChainPicker`
- Ollama model badges in setup (mark which support tool calling)
- Streaming for Ollama (currently only OpenRouter/Anthropic stream)
- Playwright-driven UI tests
- Command palette (Cmd+K)

**Mid term**
- **MCP client support** — connect to Model Context Protocol servers so agents can
  use browser control (Playwright MCP), web search, DB access, Notion/Linear/Slack
  integrations, and the whole github.com/modelcontextprotocol/servers ecosystem
- Bring-your-own-compute (BYOC): run agents on user-provided VMs
- Automatic model routing (cheap for simple tasks, frontier for complex — via RouteLLM or similar)
- Monaco editor pane for inline code review during agent turns
- Streaming Ollama support (currently only OpenRouter streams)
- Auto-linking task cards to agent branches/commits

**Longer term**
- Vibe Cloud (optional hosted agents for walk-away work — freemium tier, core stays free)
- Team collaboration (shared workspaces, real-time agent visibility)
- Agent specialization ("droids" — reviewer, test-writer, refactorer with pre-baked prompts)
- Agent Client Protocol (ACP) support to orchestrate external CLIs like Claude Code / Codex alongside native agents

## Contributing

PRs welcome. Small changes: open a PR. Larger changes or new features: file an issue first so we can align on approach before you invest time.

Testing:
```bash
npm test            # runs the whole suite
npm run typecheck   # verify types compile
npm run build       # verify production build
```

## License

MIT
