# Vibe

A command center for agent-driven development. Not another IDE with AI bolted on — a workspace built from the ground up for orchestrating multiple coding agents on one codebase.

**Status:** proof of concept. Two hardcoded agents, git worktree isolation, shared context injection, manual merge review. Everything else is scope for v1.

## Guiding Principles

- **FOSS first, paid later.** Vibe starts free out of the box using free-tier FOSS models via OpenRouter. Bring your own key when you want frontier quality.
- **Command center, not IDE.** The human is an orchestrator. The UI reflects that.
- **Coordination is the hard part.** Multiple agents on one codebase requires isolation (git worktrees), shared context, and structured merges. That's the core problem Vibe solves.

## Requirements

- Node.js 20+
- Git 2.5+ (for `git worktree`)
- An [OpenRouter](https://openrouter.ai) API key (free signup, no card required)

## Getting Started

```bash
npm install
npm run dev
```

On first launch:
1. Paste your OpenRouter API key
2. Pick a workspace folder (a git repo will be initialized if needed)
3. Pick a default model (Qwen2.5-Coder-32B free is a good default)

Then:
- Give **agent-1** and **agent-2** each a task
- Watch them work in their own git worktrees on their own branches
- Review the diff and click Merge when done
- Edit the shared **context** tab to give both agents shared project knowledge

## Architecture

- **Electron main process** — LLM API calls, git operations, file system, tool execution
- **Preload** — narrow IPC bridge (`window.vibe.*`)
- **Renderer (React + Zustand)** — UI only, subscribes to agent event streams

Each agent runs in an isolated `git worktree` at `.vibe/worktrees/<agent-id>/` on a branch named `vibe/<agent-id>/<task-slug>`. The shared context file at `.vibe/context/project.md` is prepended to every agent's system prompt.

## Tools Available to Agents

- `read_file(path)` — path relative to worktree root
- `write_file(path, content)`
- `list_files(path)`
- `run_bash(command)` — runs inside the agent's worktree
- `finish(summary)` — signals task completion

## What's Not Here Yet

- More than 2 agents (design supports up to 16, PoC hardcodes 2)
- Model routing (RouteLLM integration)
- Ollama support
- Merge conflict resolution agent
- Project management screen
- Cost management screen
- Command palette
- Monaco editor
- Streaming responses
- Persisted agent state across restarts (chat/branch mapping lost on close)
- **Pause / interrupt / kill an in-flight agent** — currently agents run to completion
  or step limit once started; there's no stop button. Needed for when an agent goes
  off the rails or the human wants to redirect mid-loop.
- **Meta-chat during awaiting_merge** — no way to ask a status question without
  spawning a new task branch. Should be able to chat with the agent about its work
  without kicking off new work.
- **Short branch/task slugs** — currently branch names are the first N chars of the
  prompt. v1 should use a cheap model to summarize into a real slug (e.g.
  "add-pause" instead of "okay-add-the-pause-feature").
- **Awareness of concurrent agents' work** — agents branch from main without any
  hint of what other agents are actively working on. Sibling in-flight branches
  should be visible in each agent's system prompt (or at minimum, a warning
  before merge if their file set overlaps a sibling's).
- **Router coherence** — free-tier routing picks a different model per turn,
  causing redundant re-reads and inconsistent style within a single agent loop.
  Should pin the model for the duration of a task once the first turn commits
  to one.

## Dependency isolation

Vibe uses **convention-based isolation** — the bundled AGENTS.md instructs agents
to always create per-worktree virtualenvs (Python) and prefer project-local
package managers (Node, Cargo, Go). Agents share the host machine and can, in
principle, install packages globally if they ignore instructions. Use a scratch
workspace when trying new tasks.

**Planned for BYOC (bring-your-own-compute):** container-per-agent isolation.
When Vibe adds remote/VM runtime support in a future version, each agent will
run in its own container, giving hard isolation for free.

## Security

**Where your API key lives.** OpenRouter API keys are stored via
[`electron-store`](https://github.com/sindresorhus/electron-store) inside
Electron's per-user data directory:

- **Windows**: `%APPDATA%\vibe\config.json`
- **macOS**: `~/Library/Application Support/vibe/config.json`
- **Linux**: `~/.config/vibe/config.json`

The file is plain JSON — not encrypted at rest. It sits outside your project
folder, so it will not be committed by accident. But anyone with read access to
your user account can see the key.

**Planned for v1**: migrate to Electron's
[`safeStorage`](https://www.electronjs.org/docs/latest/api/safe-storage) API, which
uses OS-level credential stores (DPAPI on Windows, Keychain on macOS, kwallet/gnome-libsecret
on Linux). Until then, treat your Vibe API key with the same care as an SSH key.

**What agents can do on your machine.** Vibe agents have `run_bash` access,
which means they can execute arbitrary shell commands inside their worktree.
They are **not sandboxed** — a compromised model or a prompt-injection attack in
a file they read could in principle:

- Read files outside the worktree (the tool blocks path escapes, but `run_bash` can `cat` anything)
- Install global packages, modify PATH, write to `~/`, etc.
- Make outbound network requests

Use a scratch workspace for experiments. Do NOT point Vibe at a folder
containing production secrets or credentials. Container-per-agent isolation
(see roadmap) will address this.

**What NEVER gets committed.** The auto-generated workspace `.gitignore`
excludes `.vibe/worktrees/`, `.vibe/agents/`, common secret files (`.env`,
`*.pem`, `*.key`), and language-specific caches. Review it before adding
sensitive files to a Vibe workspace.

**Reporting security issues.** For anything sensitive, open a private security
advisory on the repo rather than a public issue.

## License

MIT
