# Troubleshooting

## Setup won't let me click Start

Two things are required: a workspace folder **and** either an API key or a
detected Ollama install. The footer tells you which one is missing. If you have
Ollama running but Vibe didn't detect it, the probe runs once at setup — reopen
Settings to re-probe.

## 401 / invalid key

The key didn't reach the provider. Check the **API Keys** tab: a configured key
shows `● configured`. Keys are stored encrypted, so if you copied
`config.json` from another machine the ciphertext won't decrypt there — the
encryption is bound to that machine's keychain. Re-paste the key.

## Rate limited on the free tier

OpenRouter's free tier caps daily requests. Options, cheapest first: switch to
Ollama, add a second free model to your chain so Vibe falls through, or add
credit.

## The agent did nothing, or produced a wall of text instead of tool calls

Almost always model quality. Small local models (3B-class) and some free-tier
models mis-format tool calls, invent file paths, or ignore `AGENTS.md`. This is
a model floor, not a Vibe bug.

Fix in order of effort: use a tool-capable Ollama model (llama3.1, llama3.2,
qwen2.5-coder), add a stronger model as the primary in your chain, or bring a
frontier key.

## Which model actually answered?

Each message records the model that served it. With a fallback chain, the
primary failing is silent by design — check the served-by label if a turn looks
unexpectedly weak.

## The agent hit the step limit

`awaiting_input` with a Continue button means it burned `maxSteps` (default 100)
tool calls. Continue grants another budget. If this happens routinely, the task
is too big — split it. Raising `maxSteps` treats the symptom.

## Merge conflicts every time

Your agents are working on overlapping files. The overlap warning before merge
names which agent and which files. Either sequence the work (merge one, let the
PM summary update, then start the next) or scope tasks to disjoint areas.

## "Resolve with AI" produced something wrong

Abort the merge — that returns the repo to a clean pre-merge state. Then either
resolve by hand in the **Files** editor, or reply to the agent describing the
conflict and let it rebase its own approach.

## An agent's worktree is stuck

Worktrees live in `.vibe/worktrees/<agent>`. Closing an agent removes its
worktree and branch. If one is orphaned — Vibe crashed mid-flow — clean up with
git directly:

```bash
git worktree list
git worktree remove .vibe/worktrees/agent-2 --force
git branch -D vibe/agent-2
```

## My API keys are in plain text in config.json

That means `safeStorage` had no keyring available — typically Linux without
kwallet or gnome-libsecret. Encrypted values carry an `enc:` prefix; plain ones
don't. Install a keyring and re-save the key to migrate it.

## Tasks disappeared when I switched projects

Tasks live in `.vibe/tasks.json` **inside the workspace**, so each project has
its own board. Switching workspaces reloads the app and shows that project's
tasks. Switch back and they're there.

## Menu bar or shortcuts stopped working after a rebind

Rebinding rewrites the native menu. If a shortcut goes dead, check
**Settings → Keybindings** — an empty accelerator means unbound. Two commands
bound to the same combination is also worth ruling out; the menu takes the
first.

> Known gap: menu-bar behaviour on Windows and Linux after a rebind hasn't been
> verified on real hardware. See "Verification owed" in [BACKLOG.md](../BACKLOG.md).

## The app takes a while to start

Known and deliberately not optimized yet — dev-mode Vite overhead doesn't
reflect a packaged build, so there's no point tuning against it. See
[#75](../BACKLOG.md). The Files tab lazy-loads Monaco (~8 MB) and preloads it
after 3 s idle, so the first click on Files is quick but a very early click may
show a loading state.

## A launched app died and Vibe says "likely does not exist on PATH"

On Windows, take that message with salt. Launched processes are spawned
detached through `cmd.exe`, which puts them on a separate console — so their
output never reaches Vibe and you get the generic hint no matter what actually
went wrong. Run the same command in a terminal to see the real error. Tracked
in [BACKLOG.md](../BACKLOG.md); on macOS and Linux the message does carry the
process's own output.

## Something else

Open an issue with: what you asked the agent to do, the model chain, the agent
status when it went wrong, and the transcript if you can share it.
