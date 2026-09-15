# Getting started

From nothing to a merged agent branch. Budget about ten minutes, most of it
waiting on the agent.

## Requirements

- **Node 20.19+ or 22.12+** (the floor comes from vite 7) and **Git 2.5+**
  (worktrees need 2.5)
- **macOS Ventura or newer** if you're on a Mac — Electron 44 dropped Monterey.
  Windows and Linux need a 64-bit build; 32-bit Windows and ARM Linux binaries
  are no longer published upstream.
- A model to talk to — one of:
  - An [OpenRouter](https://openrouter.ai) key (free signup, no card)
  - [Ollama](https://ollama.com) running locally with a tool-capable model
  - A direct key for Anthropic, OpenAI, Gemini, Groq, or xAI

### Install

Installers are built for all three platforms but are **not code-signed yet**,
so the OS will object the first time:

- **macOS** — right-click the app → **Open**, then confirm. Gatekeeper blocks a
  plain double-click on an unsigned app.
- **Windows** — SmartScreen shows a warning; **More info** → **Run anyway**.
- **Linux** — the AppImage needs the executable bit: `chmod +x Vibe-*.AppImage`.
  The `.deb` installs normally.

Signing certificates are the remaining half of [#66](../BACKLOG.md). Until
that's done, treat these as builds for people who know what they're
downloading.

### Or run from source

```bash
git clone https://github.com/mtanderson17/vibe.git
cd vibe
npm install
npm run dev
```

To produce installers yourself: `npm run package` (or `npm run package:dir` for
an unpacked build, which is faster and enough to try). Output lands in
`release/`.

## First run

The Setup screen opens on four tabs. You need two things before the **Start**
button lights up: a workspace and at least one working model.

1. **Workspace** → pick a project folder. If it isn't a git repo, Vibe runs
   `git init` and seeds a `.gitignore`. Use a scratch repo the first time —
   agents run shell commands unsandboxed (see [Security](#security-in-one-line)).
2. **API Keys** → paste a key for any provider. Keys are encrypted at rest and
   stored outside the project folder; see [Configuration](configuration.md).
3. **Models** → pick a model chain. The default is
   `openrouter/free,minimax/minimax-m3:free` — a fallback chain, not one model.
   If the first fails, Vibe falls through to the next.
4. **Start**.

**No key at all?** If Ollama is running with a tool-capable model (llama3.1,
llama3.2, qwen2.5-coder), Vibe detects it during setup. Set the model to
`ollama/<name>` and skip the key entirely.

## Your first agent

1. **Control Center** → **+ agent**. Vibe creates a git worktree and a branch
   for it. Nothing it does can touch your working tree.
2. Type a task and send it. Start small and concrete — "add a `--version` flag
   to the CLI and a test for it" beats "improve the CLI."
3. Watch the transcript. The agent reads files, edits them, runs commands. A
   command that looks dangerous (`rm -rf`, `git push`, `git reset --hard`)
   stops and asks you first.
4. The agent finishes and its status becomes **awaiting merge**.

## Reviewing and merging

While an agent is awaiting merge you can:

- **Preview diff** — every changed file, added/removed line counts, before
  committing to anything.
- **Reply** — the conversation is still live. "Also update the README" keeps the
  same agent on the same branch.
- **Merge** — merges the branch into main.

If sibling agents touched the same files, you get an overlap warning naming
which agent and which files *before* you merge. Conflicts are likely, but you
can still proceed.

**On a conflict** you get the conflicting files plus a **Resolve with AI**
button. That runs a dedicated resolver over the conflict markers and shows you
the proposed resolution per file. Accept and commit, or abort the whole merge.

After a successful merge the PM agent wakes up, updates the project summary,
and may propose follow-up tasks.

## The rest of the app

- **Tasks** — a kanban board over `.vibe/tasks.json`. Assign a card to an agent
  to start it. PM-proposed cards land in their own row for you to accept or
  dismiss. `Cmd/Ctrl+Shift+T` opens the new-task modal from anywhere.
- **Files** — a Monaco editor over the workspace, for when you'd rather fix
  something yourself than explain it.
- **Cost** — per-agent tokens and dollars, from an append-only ledger that
  survives restarts.
- **Context** — **Project** (yours to write; what the codebase is and what the
  conventions are) and **Summary** (the PM agent's, regenerated after merges).
  Both are injected into every agent's prompt.
- **`Cmd/Ctrl+K`** — command palette for everything above.

## Security, in one line

Agents run shell commands unsandboxed on your machine. Point Vibe at a scratch
repo until you trust it, and don't point it at folders holding production
secrets. Details in [Concepts → Isolation](concepts.md#isolation-worktrees-not-sandboxes);
real sandboxing is [#68](../BACKLOG.md).

## Next

- [Concepts](concepts.md) — what an agent, a task, and the PM agent actually are
- [Configuration](configuration.md) — model chains, MCP servers, keybindings
- [Troubleshooting](troubleshooting.md) — when a model does something strange
