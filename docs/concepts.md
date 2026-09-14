# Concepts

The vocabulary, and why each piece works the way it does.

## Agent

A coding agent is a conversation plus a git worktree plus a branch. Spawning one
creates all three; closing one destroys the worktree and branch and keeps
nothing.

An agent moves through a small set of states, and the UI is mostly a readout of
which one it's in:

| Status | Meaning |
|---|---|
| `idle` | Spawned, no task yet, or finished and merged |
| `running` | Mid tool-call loop |
| `awaiting_input` | Called `ask_human` / `ask_human_choice`, or hit the step budget |
| `awaiting_merge` | Called `finish` — work is on the branch, waiting for you |
| `merged` | Branch went into main |
| `error` | The provider chain failed, or the loop threw |

Agents persist to `.vibe/agents/*.json`, so closing Vibe mid-task and reopening
it gets you back the transcript, the task, and the branch.

## The tool loop

An agent turn is: send the transcript to the model, get back tool calls, execute
them, append results, repeat. It stops when the model calls `finish`, calls
`ask_human`, or hits the step budget (`maxSteps`, default 100).

The tools an agent has:

| Tool | Notes |
|---|---|
| `read_file` | Offset/limit slices, truncates very large files |
| `write_file` | Creates parent directories |
| `replace_in_file` | Fails on an ambiguous match unless `all: true` — the safety property that makes edits reviewable |
| `list_files` | |
| `run_bash` | Gated by `approval.ts` for dangerous patterns |
| `ask_human` / `ask_human_choice` | Suspends the loop for input; `_choice` renders buttons |
| `todo_write` / `todo_read` | Per-worktree scratchpad so the agent keeps its own plan |
| `finish` | Ends the turn in `awaiting_merge` |

Plus any MCP tools you've configured, namespaced `mcp_<server>_<tool>`.

**The step budget is a signal, not a wall.** Hitting it shows a Continue button
that grants another `maxSteps` of runway. An agent that regularly hits 100 steps
is usually a task that should have been two tasks.

## Isolation: worktrees, not sandboxes

Each agent gets `git worktree add` into `.vibe/worktrees/<agent>` on its own
branch. That's what makes N agents on one repo safe: they can't see or clobber
each other's edits, and your own working tree is untouched while they run.

Be precise about what this does and doesn't buy you:

- ✅ Agents can't interfere with each other's files or with your working tree
- ✅ `read_file` / `write_file` reject paths that escape the worktree
- ❌ `run_bash` is **not** sandboxed. An agent can `cd` elsewhere, install
  global packages, read your SSH keys, or make network calls.

`approval.ts` gates a deliberately short list of dangerous command patterns
(recursive/force delete, `git push`, `git reset --hard`) and pauses for your
approval. It is a speed bump, not a boundary — it doesn't catch subshells,
`eval`, or a script the agent writes and then executes. Real isolation is
container-per-agent, [#68](../BACKLOG.md).

## Merging

`finish` puts the agent in `awaiting_merge`; nothing merges without you.

**Overlap warning.** Before you merge, Vibe diffs the agent's changed files
against its siblings' branches and tells you which agents touched the same
files. Advisory — you can proceed anyway.

**Conflict resolution.** On a conflicted merge you get the file list and a
**Resolve with AI** button, which runs a resolver model over the conflict
markers and shows you a per-file before/after. Accept and commit, or abort and
get back to a clean state.

## Tasks and the PM agent

**Tasks** live in `.vibe/tasks.json` — in your workspace, in git, reviewable in
a PR. Four columns: Backlog, In Progress, Awaiting Merge, Done. Assigning a card
to an agent starts it with the card's title and description as the prompt.

**The PM agent** is a second, cheaper agent with a different job: maintain
shared project state so the coding agents don't each rediscover it. It runs
automatically after every merge, and you can chat with it from the Tasks screen.

It does two things:

1. Rewrites `.vibe/context/summary.md` — a running description of where the
   project actually is.
2. Proposes follow-up tasks based on what changed. Proposed cards sit in their
   own row until you accept or dismiss them. It never adds work to your board
   unilaterally.

Give it its own model chain (`pmModel`) — it's summarization, not coding, and a
cheap fast model does it fine.

## Context

Three files, all injected into every agent's prompt:

| File | Owner | Contents |
|---|---|---|
| `.vibe/context/project.md` | You | What this project is, its conventions, what matters |
| `.vibe/context/summary.md` | PM agent | Where the project currently stands |
| `.vibe/AGENTS.md` | You | Per-project agent rules, seeded on init |

`project.md` is the high-leverage one. An agent that knows your conventions
writes code that looks like your code.

**Sibling context refreshes on human re-engagement, not every turn.** An agent
sees fresh sibling state, summary, and context whenever you reply to it — not on
every internal loop turn. Cost-conservative on purpose. If a sibling starts or
finishes mid-turn, the current agent won't notice until you re-engage; the
merge-time overlap warning covers the practical worst case.

## Condensation

Long-running agents accumulate enormous tool transcripts — file reads,
directory listings, diff output — that crowd out what's useful. Past a token
budget (default ~60k), the condenser compresses the old middle of the transcript
into a single summary message and keeps:

- the system prompt at index 0,
- the first user message (the original task),
- the last K turns (recent working memory).

The head stays byte-identical across turns on purpose, so Anthropic prompt
caching keeps hitting after a compaction.

## Model chains

A model setting is a comma-separated chain, not one model:

```
openrouter/free,minimax/minimax-m3:free
```

First entry is primary. If it fails — rate limit, deprecation, provider outage —
Vibe falls through to the next. Chains exist per role (coding vs PM) and per
agent (any agent can override in its header).

## Cost ledger

Every LLM request appends one JSONL line: timestamp, source, model, branch,
task, token counts, cost. Append-only, so it survives restarts and closing
agents, and aggregations are computed on read. The Cost screen is a view over
it.
