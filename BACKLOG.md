# Backlog

Planned work, in the repo so it survives between sessions. Shipped work lives in
`git log`, not here — an item leaves this file when it lands.

**#66 is the keystone.** Four items (#73, #74, #75, and the install half of
#67) are blocked on packaging existing — as is the Electron smoke job that
would close most of what's still unverified.

**The dependency upgrade that was blocking it is done** — Electron 33 → 44,
open advisories 7 → 2. See "Runtime upgrade" below. The two that remain come
from `monaco-editor`'s bundled `dompurify` and are tracked there.

**#76 (pre-warm worktrees) is done**, along with the Windows `launch_app`
output bug — see the Done entries below.

**The most strategically valuable item is #82** (merge queue). See "The field,
surveyed 2026-09-14" for why: it lives in the one layer that no agent CLI
vendor will build for us, and Vibe's current merge story degrades precisely as
parallelism — the thing the product is sold on — increases.

---

## Open

### #66 · Cross-platform package manager install

One-line install from the CLI on all three platforms:

- macOS — `brew install vibe` (or similar)
- Linux — `.deb` / `.rpm` / AppImage + apt repo, or a `curl | sh` script
- Windows — `winget install vibe` or Scoop

Requires electron-builder config with signed builds. macOS needs an Apple
Developer cert plus notarization; Windows needs an Authenticode code-signing
cert. Linux is the easy one — a self-signed AppImage works.

Paired with #73: users who install via a package manager still need a
"new version available" path.

### #67 · Documentation

Partly done — see `docs/`. What exists: getting started, configuration,
concepts, architecture, troubleshooting. What's still missing:

- Install instructions for real (blocked on #66 — right now the only install
  path is `git clone` + `npm run dev`)
- Screenshots in the README and the getting-started guide
- A contributing guide with more than the README's three lines
- Decide whether `docs/` stays Markdown-in-repo or becomes a docs site
  (mkdocs / Docusaurus). Not required for v1.

### #68 · Docker sandbox for agent shell access

Run each agent's `run_bash` / `launch_app` inside a per-agent container instead
of on the host. Buys real isolation: agents can't `rm -rf ~`, install
system-wide packages, or reach anything outside their worktree and declared
network policy.

Design questions to settle first:

- Container per agent, per worktree, or a shared pool?
- How does the worktree get in — bind mount (fast) or volume (isolated)?
- Network policy — off by default? An allowlist for pip/npm?
- Base image — ship one blessed image, or let the user pick? A DS project wants
  Python + pandas + matplotlib; a node project wants node. Devcontainer-style
  declarative image per workspace?
- Fall back to host mode when Docker isn't installed?
- How does this interact with `approval.ts` — is `run_bash` still gated for
  `rm -rf`, or does the sandbox remove the need?

Worth reading first: Cline's approach, Aider's compute isolation story, the
VS Code devcontainers spec.

Two refinements from the field survey (2026-09-14). **JetBrains Air offers
container *or* git worktree as a per-task choice** rather than forcing one —
the right shape, since a container is overkill for a docs edit and essential
for `npm install`. And **ctx isolates the network, not just the disk**, with
configurable egress policy; that's arguably the more valuable half, since an
agent that can't reach the internet can't exfiltrate a key it happened to read.
See also #86, which reframes the approval gate this buys.

Not blocking anything else, but it's the biggest confidence win for letting
less-technical users run agents.

### #69 · Design thinking: FOSS-friendly extension story

**An open design question, not a build task.** How should Vibe accommodate
heavyweight optional features (Jupyter/kernel integration, remote SSH,
provider-specific integrations, extra tool packs) such that it:

1. doesn't bloat the base install for people who don't need them,
2. doesn't lock the core into a premature plugin API,
3. is welcoming to contributors who want to ship their own integrations.

Wait until 3–4 concrete "optional feature" needs exist before designing the
API — the shape should emerge from real code, not speculation. Watch #71 (DS
workflow), #68 (Docker sandbox), MCP-adjacent tool packs, and remote SSH.

Being plugin-hostile until there's evidence is intentional: a plugin API is
effectively permanent once users depend on it. See VS Code's 2016-era shims.

### #71 · Data science workflow

Broader than "run this `.py` and show the plots," though that's a piece of it.
The real question is what the end-to-end DS agent loop looks like in Vibe.

- **Execution** — script runner, or a notebook-adjacent kernel. Non-interactive
  `.py` + matplotlib-to-PNG + DataFrame text repr is the v1.
- **Output panel** — swappable, so a future Jupyter mode plugs in behind the
  same shape. Renders images, tables, text, tracebacks.
- **Data awareness** — let the agent peek at CSV/parquet columns, `.head()`,
  dtypes without pulling the whole file into context. Maybe a `describe_data`
  tool.
- **Reproducibility** — how do we capture the environment a plot was generated
  in? Pinned requirements? #68 is the strongest answer.
- **Merge semantics** — DS work generates artifacts (plots, cached data). Do
  those go in git? Gitignored by default with a whitelist?

Monaco (the editor prereq) has shipped. Ideally coordinated with #68.

### #73 · Auto-update mechanism

Once users install via a package manager (#66) they need to learn a new version
exists, or they'll run stale forever.

- **electron-updater** (from electron-builder) — checks GitHub Releases on
  startup, prompts, applies a delta patch on next launch. The standard Electron
  pattern.
- **Package-manager-native** — rely on `brew upgrade` / `winget upgrade` /
  `apt upgrade`. Cleaner, no in-app update code, but users must remember.
- **Hybrid** — check in-app, hand off to the package manager to apply.

Recommendation: electron-updater on macOS/Windows (matches what people expect
from other Electron apps), package-manager-native on Linux.

Blocked on #66.

### #74 · Onboarding / first-run flow

The Setup screen is a functional dump of API-key fields. Once #66 and #67 start
bringing new users in, first-run needs to be friendlier:

- Explain what an API key is, why it's needed, and which provider is cheapest
  to try
- A "skip and use Ollama locally" path for people who don't want to pay
- A sample project or empty-workspace bootstrap, so they can watch agents work
  before wiring up their own repo
- Progressive disclosure — hide max steps, MCP servers, and condenser
  thresholds until someone goes looking

Enabled by #66 + #67.

### #75 · Optimize launch and install speed

Once the app is packaged (#66), measure real launch and install times and
optimize toward "instant" — target ≤2 s cold start on a typical machine.

Little value in doing this now: dev-mode Vite has overhead that doesn't reflect
the shipped experience.

Once there are real numbers, look at:

- **Cold start** — Electron boot, preload, renderer HTML/JS load, React mount,
  first IPC roundtrip. Levers: smaller main bundle, defer non-critical IPC
  handlers, paint `backgroundColor` before the renderer does (already done).
- **First interactive** — currently gated on `config.get()` + `agents.list()`.
  Could show the shell immediately and hydrate behind it.
- **Warm start** — should be near-instant with a warm disk cache.
- **Install size** — Electron is ~150 MB unpacked. Drop unused Electron
  modules, tree-shake the AI SDK providers, ship per-platform instead of
  universal builds.
- **Windows Defender** — the first-run scan costs seconds. Not fixable in code,
  but code-signing (#66) reduces the scan surface.

Blocked on #66. Ties into #74.

### Done · #76 Pre-warm worktrees

Landed 2026-09-14. `prewarmWorktree` builds the agent's checkout detached at
HEAD when the agent spawns, and `createWorktree` now takes a fast path when a
checkout already exists: reset it to the workspace's *current* HEAD, clean it,
and create the branch in place rather than materialising the tree again. The
cold path is unchanged as a fallback, and prewarm is fire-and-forget so a
failure only costs the old behaviour.

Also parallelised task startup: `generateSlug` is an LLM round-trip and the
three context reads are disk I/O, with no dependency between them — they ran in
series and now don't.

Two things worth remembering, both caught by the new `tests/git.test.ts` (git.ts
previously had no tests at all):

- A prewarmed tree is pinned at spawn time, so it **must** be reset to the
  workspace's current HEAD when the task finally starts — otherwise an agent
  that sat idle while other work merged would silently branch from stale code.
- `git branch -D` refuses while the branch is checked out anywhere, so the
  stale-branch delete has to happen *after* detaching the worktree, not before.

Remaining idea, not done: prewarm could also run after an agent finishes a task
so the *next* task is warm too, not just the first.

### #77 · Pull work in from an issue tracker

Emdash ingests from Linear, GitHub, Jira, GitLab, Asana, Featurebase,
Monday.com, Forgejo and Plain — you send a ticket at an agent and it starts.

For Vibe, GitHub Issues alone is most of the value and the least work: an issue
becomes a Task card, keeping `.vibe/tasks.json` as the single board. Worth
deciding early whether an imported card keeps a link back to the issue and
syncs status, or is a one-way import. One-way is much simpler and probably
enough.

### #78 · Pull requests and CI from inside Vibe

Today merging is local-only: agent branch → main on your machine. Emdash
creates PRs, shows CI checks, and merges from one view.

This pairs with the CI we now run. Shape: after `awaiting_merge`, offer
"create PR" beside "merge", then surface check status on the agent card so a
red build is visible where the work happened. `gh` is already a reasonable
dependency to lean on rather than implementing the GitHub API.

### #79 · Run external CLI agents alongside native ones

The strategic one — see the Emdash notes below. Vibe implements its own agent
loop; Emdash drives the CLIs you already have (Claude Code, Codex, Cursor,
OpenCode, Amp, Devin, Qwen, Droid, Copilot, among others) and owns no loop at
all.

The interesting position is *both*: native agents keep the zero-cost path
working with free OpenRouter models or Ollama, and an external-agent mode lets
someone point their existing Claude Code subscription at the same worktree and
merge UI. Neither tool offers that today.

**Use ACP, don't invent an integration.** JetBrains Air drives Codex, Claude
Agent, Gemini CLI and Junie through the **Agent Client Protocol**, with more
coming via an ACP Agent Registry. That's the standard to target: one protocol
rather than N bespoke adapters, and JetBrains putting its weight behind it
makes it the likely winner. This supersedes the vague "ACP support" line that
used to sit in the README roadmap — it's now the concrete mechanism for this
item.

### Feasibility: verified against the installed Claude Code CLI, 2026-09-14

Tested directly rather than reasoned about. **The answer is yes** — every
integration point Vibe needs is exposed, and the initial pessimistic read of
this item was mostly wrong.

| What Vibe needs | Verdict | Mechanism |
|---|---|---|
| Token + cost accounting | **Better than ours** | see below |
| Vibe owns the permission gate | **Yes** | `--permission-prompts host` (the default) and a hidden but accepted `--permission-prompt-tool` |
| Constrain what the agent may do | **Yes, allowlist only** | `--restricted`, `--allowedTools`, `--tools` — see the finding below |
| Inject project.md / summary.md / siblings | **Yes** | `--append-system-prompt`, `--system-prompt` |
| Pass through `.vibe/mcp.json` | **Yes** | `--mcp-config` + `--strict-mcp-config` |
| Model chain with fallback | **Built in** | `--fallback-model` takes a comma-separated list tried in order — our own concept, already implemented |
| Multi-turn follow-ups | **Yes** | `--input-format stream-json`, `--replay-user-messages` |
| Session continuity | **Yes** | `--session-id` (we supply the UUID), `--resume`, `--fork-session` |
| Run in *our* worktree | **Yes** | cwd + `--add-dir`; ignore its own `-w/--worktree` |
| Live progress for the UI | **Yes** | stream-json `assistant` events, `--include-partial-messages`, `--include-hook-events` |
| Spend cap | **Better than ours** | `--max-budget-usd`, which we have no equivalent of |

Genuinely lost: `tools.ts` (the CLI brings its own — fine) . Replaced rather
than broken: the condenser (`--autocompact`) and the `maxSteps` budget
(`--max-budget-usd` is a better primitive anyway).

**Security finding — use allowlists, never denylists.** Asked to run a shell
command with `--disallowed-tools Bash PowerShell`, the CLI removed those tools
and the model **routed around the block** via another tool that also executes
commands, running the command anyway. `permission_denials` stayed empty,
because nothing was formally denied — it simply took a different path. Under
`--restricted` the same prompt was refused outright: *"I don't have a way to
directly run a shell command here."*

A denylist of tool names is therefore not a boundary. The tool surface is wide
and several tools can execute code, which is exactly why `--restricted` exists
to remove the whole class. This is the same lesson `approval.ts` already
records about pattern-matching commands — it generalises. Any backend we add
must be constrained by allowlist.

Worth knowing: the CLI ships its own background agent manager (`claude --bg`,
`claude agents`, `attach`, `logs`, `stop`, `rm`, `respawn`), which overlaps
Vibe's Control Center. Not a blocker, but the boundary needs deciding — we
should drive sessions ourselves rather than delegate to its manager, or the two
models of "what is running" will diverge.

**Cost tracking survives the swap — verified, not assumed.** The obvious
objection to running someone else's harness is that we stop seeing token usage
and the Cost screen goes dark for those agents. That turns out to be false for
Claude Code, which reports usage through three channels:

- `claude -p --output-format json` returns `total_cost_usd`, a full `usage`
  block (cache creation vs cache read, thinking tokens) and `modelUsage` — a
  per-model breakdown with `costUSD`, context window and provider. A single
  turn can bill two models and it attributes both.
- `--output-format stream-json` carries usage on **every** `assistant` event as
  well as the final `result`, so metering is live per turn rather than only at
  session end. It also emits `rate_limit_event`, which we could surface.
- `~/.claude/projects/**/*.jsonl` holds per-turn usage on disk, so a session
  can be accounted for retroactively.

This is *richer* than our own ledger, which records prompt/completion tokens
and derives dollars from `pricing.ts`: it gives dollars directly, splits cache
reads from writes (we don't track that at all), and attributes per model.

The one caveat is a labelling problem, not a data problem: the JSON reports
`"costBasis": "list"`, so for a subscription user the figure is what the work
*would* have cost on the API, not what they will be billed. Show it as such.

Expect the other ACP agents to differ here — this was checked for Claude Code
only. Treat per-backend usage reporting as a capability the backend declares,
not something to assume either way.

Also worth stealing: Emdash detects installed provider CLIs automatically, and
installs marker-tagged lifecycle hooks into their config so it gets progress,
notifications and resumable sessions — hooks that stay inert when the agent
runs outside Emdash. A well-mannered pattern, and much better than
screen-scraping a terminal, for any agent that isn't reachable over ACP.

### #80 · Make the board and agent state scale

An Emdash user reported significant UI lag at 78 tasks. Vibe will hit this
sooner: `TasksView` re-filters the whole task array once per column on every
render and nothing is virtualized, and every task mutation rewrites the whole
of `tasks.json`.

**The board half is done** (2026-09-14) — but the profile was not what the
Emdash report suggested. Re-filtering the array per column is microseconds; the
real cost was that TasksView re-renders on every keystroke in the new-task box
and **every card re-rendered with it**, because the handlers and the shared
`cardProps` object were rebuilt each render. Fixed by memoizing TaskCard and
giving it stable callbacks, plus a single-pass `partitionTasks`. TaskCard also
stopped taking the whole agents map — it now gets a resolved `assignedAgent`,
and the dropdown rows only go to the one card whose picker is open, so cards no
longer re-render when an unrelated agent streams. Covered by
`tests/tasks-board.test.ts` and `tests/tasks-view.test.tsx`.

Still open:

- **The board** — virtualize long columns. Not worth it until someone actually
  has hundreds of cards.
- **Runtime state** (`.vibe/agents/*.json`, the cost ledger) — Emdash uses
  SQLite. Tempting, but **do not put `tasks.json` in SQLite**: it being plain
  JSON in the repo is a deliberate property — the board is diffable and
  reviewable in a PR. Confine any database to state that's already gitignored.

And a hard constraint learned from their bug reports: Emdash users hit
`NODE_MODULE_VERSION` mismatch install failures on Windows and Linux, which is
what a native module costs you. **Every runtime dependency Vibe has today is
pure JS** — no native modules at all. That's a real asset going into #66
signed cross-platform builds, and adopting `better-sqlite3` spends it. If the
ledger needs a database, prefer a pure-JS store or an append-only format (the
ledger is already JSONL, which is fine for far more than 78 rows).

### #81 · Scheduled and unattended agent runs

Emdash schedules agent work. Vibe only starts an agent when a human clicks.
The obvious version: run a task at a time, or on a trigger (post-merge, on a
new issue), and have results waiting. Pairs naturally with #77.

### #82 · Merge queue

The best idea found in the whole survey, from [ctx](https://ade.ctx.rs/), and
the one that most deserves the word "fundamental."

Vibe's current model: an agent finishes, you get an overlap *warning*, you
merge, and if a sibling landed first you deal with the conflict by hand. That
degrades exactly as parallelism increases — the feature the product is sold on.

A merge queue inverts it. Ready changes enter a queue rather than merging
directly, and the first gate is mechanical: *does this still apply cleanly on
top of the current target branch?* If not, it goes back for revision — and the
agent that produced it is still alive and holds all the context needed to
rebase itself. Conflicts stop being a human's problem at the moment they're
cheapest to fix.

This sits squarely in the layer that no single agent CLI will ever build (see
the field notes), and it composes with everything else here: the overlap check
becomes the queue's pre-flight, #78's CI status becomes a second gate, and
#83's verification evidence becomes a third.

Design questions: ordering (FIFO, or smallest-diff-first to minimize churn?),
how many revision rounds before a human is pulled in, and whether the queue
runs speculatively ahead of review or only after a human approves.

### #83 · Verification evidence before the merge decision

[KingCoding](https://www.producthunt.com/products/kingcoding) auto-reviews
agent results and captures verification screenshots.
[ctx](https://ade.ctx.rs/) argues the same point from the other side: *"a bare
diff is not enough"* — keep the prompt, transcript, commands, artifacts and
worktree state that produced it.

Today Vibe hands you a diff and asks you to merge. You can't see whether the
tests passed, whether the app still starts, or what the agent actually ran. All
of that exists — the transcript has the commands, and `launch_app` can run the
app — it's just not collected into the decision.

Shape: on `finish`, run the project's verification (tests, typecheck, whatever
`.vibe/AGENTS.md` names) and attach the result to the `awaiting_merge` banner.
Screenshots where a UI is involved, via the `launch_app` path. The human
decision becomes evidence-based rather than vibes-based, which is the whole
premise of keeping a human there.

Pairs tightly with #82: a queue needs a gate, and this is the gate worth having.

### #84 · Anchor tasks to code, not just prose

[JetBrains Air](https://air.dev/) lets you define a task against precise
context — a specific line, commit, class, or method — and the agent starts from
that anchor.

A Vibe task is a title and a description string. "Fix the retry logic" makes the
agent go hunting; a task anchored to `providers/index.ts:88` does not. Anchors
also survive into the prompt as exactly the kind of context that stops a weak
model from flailing — which matters more for us than for the tools that ride on
frontier-model CLIs.

Cheap version: let a task carry `file:line` refs, and let the Files editor send
a selection straight to a new task card.

### #85 · Make parallel work legible at a glance

Two ideas from the field, one problem. [Anvil](https://www.producthunt.com/products/anvil-5)
does first-class plan tracking and colour-codes agent state;
[Air](https://air.dev/) sends notifications when a task needs attention.

Vibe has both gaps, confirmed by grep:

- **The agent's plan is invisible.** `todo_write`/`todo_read` exist and agents
  use them, but nothing in the renderer reads a todo list. The agent is keeping
  a plan and we're hiding it from the one person supervising.
- **No notifications of any kind.** With up to 8 agents, an agent going
  `awaiting_input` is silent unless you happen to be on its tab. The whole
  premise is walking away while agents work, and nothing tells you to come back.

Both are small and both directly serve the supervision loop.

### #86 · Bounded autonomy instead of per-command prompts

[ctx](https://ade.ctx.rs/) frames its containerization as buying *"bounded
autonomy instead of constant approval prompts"* — a policy envelope agreed once
up front rather than a modal per dangerous command.

Vibe's `approval.ts` is the prompt-per-command model, and its own header admits
it's a speed bump rather than a boundary. As agent count rises, prompts become
the bottleneck and get click-throughed, which is worse than no gate.

Rethink alongside #68: declare what an agent may do (write inside the worktree,
network to these hosts, never push) and let it run freely inside that, rather
than interrupting on pattern matches. Also worth stealing from ctx: **network
egress policy**, not just filesystem isolation — the more valuable half, and
absent from #68 as written.

### #87 · Remote execution

Filed properly now, because three independent tools ship it:
[Emdash](https://github.com/generalaction/emdash) (SSH/SFTP with keychain
credentials), [ctx](https://ade.ctx.rs/) (run on remote machines you control),
and [Agentastic](https://www.agentastic.dev/) (free remote options as a selling
point). It was previously a vague "longer term" line in the README.

The pull is obvious: agents are long-running and machine-bound, and a laptop is
the wrong host. This also subsumes the old "bring-your-own-compute" idea —
same protocol, one machine at a time, no cloud infrastructure to build.

### #88 · Task graph with file ownership

From [Bernstein](https://github.com/sujeito-operator/bernstein), whose planner
decomposes a goal into tasks carrying **roles, owned files, and completion
signals**.

The "owned files" part is the idea worth taking, because it inverts something
Vibe currently does backwards. We detect overlap **at merge time** and warn —
reactive, after both agents have already done the work. Bernstein assigns file
ownership **at planning time**, so two agents are never dispatched at the same
files in the first place. Prevention beats a warning, and it costs nothing at
runtime.

The graph half matters too: `.vibe/tasks.json` is a flat list with a status
field and no dependencies, so nothing can express "B can't start until A
lands." That's the missing primitive for any automated dispatch (#81), and
it's what turns a kanban board into a scheduler.

Compatible with keeping tasks.json plain and diffable — a `dependsOn` array and
an `ownedFiles` array are just more JSON.

### #89 · Per-task completion signals

Bernstein's Janitor verifies concrete, declared signals: tests pass, files
exist, lint clean, types correct. This sharpens #83 from "run the project's
verification" into something better: **the definition of done travels on the
task card**, and different tasks can declare different signals.

It also makes agent output checkable without a human reading the diff first,
which is the precondition for #82's queue gating on anything but "applies
cleanly."

### #90 · Keep the coordination loop free of LLM calls

Both [Bernstein](https://bernstein.run) and Microsoft Conductor land on the
same rule from different directions: one LLM call to decompose the goal, then
**plain deterministic code for every scheduling decision** — zero tokens spent
on coordination, and runs that replay identically.

Note carefully what this does and doesn't mean for us. Vibe's scheduling is
already zero-token, because a human does it by dragging cards. So this is not
a change to today's behaviour — **it's a constraint on #81 and on any
"describe a goal and let it run" mode.** When we automate dispatch, the
temptation will be to ask a model which agent should take which task. Don't.
Decide it in code.

The reason this matters more for us than for anyone else in the survey: our
whole position is the $0 path. Coordination that burns tokens makes the free
tier worse precisely as you use more of it. The PM agent should keep doing the
things that genuinely need a model — summarising, proposing work — and never
become the scheduler.

### #91 · Replay journal and audit trail

Bernstein keeps state outside agent memory with a replay journal and an opt-in
HMAC-chained audit log a reviewer can verify offline;
[ctx](https://ade.ctx.rs/) makes the same argument as "durable transcripts."

Vibe persists agent state to `.vibe/agents/*.json` as current state only —
there's no record of *how* it got there that survives, and no way to replay a
run. The cost ledger is already append-only JSONL and is the right shape to
generalise from.

Worth building only alongside #82/#88, since a replay journal of a
human-driven, non-deterministic flow is much less useful than one of a
scheduled pipeline.

### #92 · Expose the task board as an MCP server

Vibe Kanban ships an MCP server so a "planning" ticket can instruct an agent to
decompose work into downstream cards. Vibe is already an MCP **client** — being
a **server** is the cheap inverse, and it lets an agent file, split, or update
tasks mid-run instead of only at the PM agent's post-merge pass.

Small, and it composes with #88: an agent that discovers hidden work can add a
node to the graph rather than silently expanding its own scope.

### #93 · Verify the merged result, not just the branch

`mergeBranch` runs `git merge --no-ff` and returns `ok: true` whenever git
didn't error. **"ok" means git merged it, not that the result works.** Nothing
runs the tests or the typechecker on the merged state.

That leaves a whole class of failure unhandled, and it's the expensive one.
Git's conflict detection is line-based and has no model of meaning, so these
all merge *cleanly*:

- A renames a function; B adds a new caller of the old name → broken build
- A changes a function's contract (extra param, different return shape); B
  writes code against the old one → runtime bug
- A deletes a config key; B starts reading it
- A and B independently add the same helper in different files → no error at
  all, just duplication that rots

The AI conflict resolver never sees any of it, because it only fires when there
are conflict markers. **The conflicts an LLM is good at fixing are exactly the
ones git can find — and those are the cheap ones.** This is the residue.

The fix is not another model call. Run the project's verification on the merged
state before keeping it: zero tokens, deterministic, and it catches the
rename-and-caller case immediately. `--no-ff` already helps here — every merge
is a single commit, so rollback is one revert.

Relationship to #83/#89: those verify **a branch in isolation**. This verifies
**the merge**. Both are needed and neither substitutes for the other — a branch
that passes on its own can still break main, which is the entire point.

The escalation ladder this creates:

| Merge state | Verification | Action |
|---|---|---|
| clean | green | land it |
| conflicts | — | AI resolver (exists, and is good at this) |
| **clean** | **red** | **the hard case — and nobody in the survey handles it**, because every Tier-2 tool gates on the PR, not on the merge result |

First version is small: run typecheck + tests after the merge, show the result
in the merge banner, offer one-click rollback. The third row can start as
"tell the human loudly" and grow into handing it back to whichever agent's
change broke it.

### #94 · Experiment: log write collisions (do not block yet)

Demoted from a stronger proposal — cross-agent file locking, enforced in
`tools.ts` at the moment of the write — after a good objection: AI resolves
textual conflicts well, we already ship `resolver.ts`, so *preventing* that
class buys little. #93 is where the real gap turned out to be.

Two arguments still survive and are worth measuring rather than assuming:

- **Wasted turns.** Even when the resolver succeeds, both agents spent tokens
  and wall-clock producing work that gets reconciled away. On free models the
  scarce resource is rate limit, not dollars, so redundant agent turns cost
  real throughput.
- **Distance degrades resolution.** The resolver sees conflict markers, not
  intent — it is the least-informed participant in the pipeline. An agent told
  "B owns `auth.ts`, work around it" still holds its full task context.

So: **instrument first, decide later.** `executeTool` already receives
`agentId`; keep a module-level map of repo-relative path → agent (via
`resolveInside` + `path.relative`) and *log* would-be collisions on
`write_file`/`replace_in_file` without blocking anything. Run it for a week of
real use.

If it never fires, the merge-time overlap warning was already sufficient and
this dies here. If it fires constantly, we've found work being quietly thrown
away. Only then decide between warn, deny, or redirect — and settle the
questions that make the blocking version hard: file granularity is probably too
coarse (two agents in different functions of one file is legitimate), reads
must not take leases, and a blocked agent should be told to go elsewhere rather
than queued, since queueing wastes its context.

Worth noting it would survive #79: external CLI agents bypass `tools.ts`, but
`--permission-prompts host` is the default and means Vibe is asked before their
tools run — same registry, enforced natively for our agents and at
approval time for theirs.

### Fixed · `launch_app` output was lost on Windows

Fixed 2026-09-14. Kept briefly because the reasoning isn't obvious and the
constraint still binds anyone touching `launcher.ts`.

`detached: true` means CREATE_NEW_CONSOLE on Windows, and an intermediate shell
re-attaches its *children's* standard handles to that console. Every escape was
measured and all of them fail: pipes, an inherited file descriptor, and the
shell's own `>` redirect, under both cmd.exe and powershell. `node` spawned
directly with detached keeps its output, and cmd's *own* stderr still arrives —
which is why failures to **start** were visible while everything after was not.

The fix was to stop detaching on Windows, which turned out to cost nothing. The
"keeps running after Vibe closes" rationale in the old comment is contradicted
by `index.ts`, which calls `shutdownAllApps()` on both `window-all-closed` and
`before-quit`; and `stopApp` uses `taskkill /T`, which kills the tree without
needing a process group. Detaching is still correct on POSIX, where `stopApp`
does `process.kill(-pid)` and needs the group — hence
`DETACH = process.platform !== 'win32'` rather than dropping it outright.

Output now goes to a log file through an inherited descriptor, so the command
string reaches the shell untouched and the log outlives both the app and a Vibe
restart (`tailApp` reads from it). `tests/platform.test.ts` asserts captured
output unconditionally now — if that ever needs a platform guard again,
something has regressed.

---

## The field, surveyed 2026-09-14

Reviewed: [JetBrains Air](https://air.dev/),
[Emdash](https://github.com/generalaction/emdash),
[ctx ADE](https://ade.ctx.rs/),
[Superset](https://github.com/superset-sh/superset),
[Agentastic](https://www.agentastic.dev/),
[KingCoding](https://www.producthunt.com/products/kingcoding),
[Anvil](https://www.producthunt.com/products/anvil-5).

### The useful axis: coordination depth

The sharpest way to read this space isn't by feature list but by **how much of
the merge / conflict / task-routing decision-making the tool takes off your
hands**. Three tiers:

**Tier 1 — session managers.** Parallel isolated sessions; the human makes
every call. Claude Squad (tmux + worktrees; AGPL-3.0, no native Windows),
Nimbalyst (successor to Crystal, which Stravu deprecated Feb 2026; adds visual
editing of markdown/mockups/Excalidraw next to sessions), Vibe Kanban
(unrelated to us despite the name; Bloop shut down April 2026, now
community-maintained), Agent Kanban (a VS Code Copilot Chat participant, no
loop of its own), plus everything in the Emdash/Superset/Agentastic cluster
below.

**Tier 2 — milestone gates.** The tool handles CI and retries; the human
approves at PR time. [Agent Orchestrator](https://github.com/Untrivial-ai/agent-orchestrator)
(agents fix CI failures and answer review comments, managing their own PR
lifecycle; 26 worker harnesses), [Bernstein](https://github.com/sujeito-operator/bernstein)
(Goal → Planner → Task Graph → Orchestrator → Agents → Janitor → merge, with
deterministic Python scheduling), Microsoft Conductor (YAML workflows, no LLM
in the orchestration loop). GitHub-issue-driven variants: Baton (polls
`gh issue list`, config in one `WORKFLOW.md`), Code Conductor (issues labelled
`conductor:task`, Claude Code only).

**Tier 3 — managed/cloud.** Runtime moves off your machine; persistent memory,
standing triggers, audit trails. Augment's Cosmos and similar. The framing
that fits: coordination stops belonging to *you* and starts belonging to *the
team*.

**Not the same category, but the reason the category exists:** the
single-agent-per-editor assistants — Cursor, Windsurf, Copilot Agent Mode,
JetBrains AI, Antigravity, Kiro. Everything above is a reaction to them.

### Where Vibe sits, and the move that changes it

**Vibe is Tier 1** — no automated CI gates, no auto-merge, a human decides
everything — **but with one Tier-2 organ nothing else in Tier 1 has:** the PM
agent maintaining a running summary and proposing tasks after each merge.
That's a lighter-weight cousin of Bernstein's Janitor and Agent Orchestrator's
milestone gates.

The thing to be deliberate about: **#82 (merge queue), #83 (verification
evidence) and #93 (verifying the merged result) are not ordinary features —
together they are the Tier 1 → Tier 2 transition.** Automated gates between "agent finished" and "code on main" is
exactly what defines the boundary. That's a product decision about how much
judgement to take away from the user, and it should be made on purpose rather
than arrived at one PR at a time. Bernstein and Agent Orchestrator are the
prior art to study before starting either.

One practical constraint: **Claude Squad is AGPL-3.0**, so its code can't be
borrowed into an MIT project. Read it for ideas, don't copy from it.

### The finding that matters more than any feature

**Every single one of them orchestrates agent CLIs somebody else wrote. Not one
builds its own agent loop. Vibe is the only outlier in the survey.**

| Tool | Agent loop | Isolation | Notable |
|---|---|---|---|
| JetBrains Air | ACP: Codex, Claude, Gemini, Junie | container *or* worktree | ACP registry; task anchored to line/commit/class |
| Emdash | your installed CLIs | worktree | issue-tracker ingestion; SSH remote; pre-warmed worktrees |
| ctx ADE | Claude Code, Codex, Cursor… | container, disk **and network** | **merge queue**; durable transcripts |
| Superset | "100+ agents", your subscription | worktree | terminal, review, open-in-editor |
| Agentastic | 52 agent definitions, native Swift | worktree + containers | built-in editor, browser, diff viewer |
| KingCoding | Claude Code, Codex | — | **auto-review + verification screenshots**; goal-level "King Mode" |
| Anvil | parallel Claude Codes | worktree | plan tracking; colour-coded agent state |
| **Vibe** | **its own** | worktree | **$0 path; PM agent maintaining shared state** |

Seven independent teams, one conclusion: don't write the loop, wrap the CLIs.
That is strong evidence and it deserves a straight answer rather than a
defensive one.

**Where the convergence is right.** You cannot out-engineer Anthropic's harness
on harness quality, and every hour spent on the loop is an hour not spent on
the layer above it. Our own README concedes the symptom — "small models produce
small-model results." #79 is not optional; it's the correction.

**Where it is wrong, and this is the whole argument for Vibe.** Every one of
those seven requires the user to already own a paid agent CLI subscription.
Their floor is $20–200/month. Vibe's floor is **zero** — free OpenRouter models
or a local Ollama, no account, no card. Nobody in this survey serves that user,
and it isn't an oversight: once you've decided to wrap CLIs, you structurally
cannot, because the CLIs themselves are the paywall. So the right move is both,
not either: keep the native loop as the free tier, add ACP agents (#79) for
people who already pay, and let the two share one review surface.

**The layer that survives either way.** The CLIs will keep absorbing
orchestration — Emdash's founders said so themselves, and Air is JetBrains
conceding the same by building around agents instead of inside them. What no
single agent vendor will build is the cross-agent, cross-provider,
human-in-the-loop review of *parallel* work: the merge queue (#82), the
verification gate (#83), overlap detection, and the PM agent's shared project
state. Note that last one is ours alone — **no tool in this survey has anything
like the PM agent maintaining a shared summary across agents.** That, plus the
$0 path, is the defensible ground. When two features are the same size, build
the one in that layer.

### What the tier survey added

#88 (task graph with file ownership — the single best idea in this round:
Bernstein assigns owned files at *planning* time, where we only warn about
overlap at *merge* time), #89 (per-task completion signals), #90 (keep the
coordination loop token-free — a constraint on #81, not a change to today),
#91 (replay journal), #92 (task board as an MCP server).

### What the first survey added

Filed above as #82 (merge queue), #83 (verification evidence), #84 (task
anchors), #85 (plan visibility + notifications), #86 (bounded autonomy), #87
(remote execution). #68 gained network isolation and the container-or-worktree
choice; #79 gained ACP as its concrete mechanism.

Two more noted but not filed, as they need a direction decision first:
KingCoding's **goal-level "King Mode"** (describe an outcome; the system plans,
dispatches and adapts while the human sets direction and grants permissions) is
roughly what our PM agent would become if it could assign its own proposed
tasks to idle agents. And Superset/Agentastic both treat **"bring your own
subscription"** as the headline, which is the exact inverse of our pitch —
useful confirmation that the positioning axis is real and contested.

### Could not verify

**"Tendi sandbox ADE"** returned nothing across several searches. The nearest
match is [Tenki Sandbox](https://tenki.cloud/products/sandbox) — disposable
Linux VMs for AI agents, which is infrastructure rather than an ADE, and would
be a #68 building block rather than a competitor. If Tendi is a different
product, it needs a URL to review properly; I'd rather leave this blank than
guess.

---

## Notes from the field · Emdash (YC W26, Apache 2.0)

Reviewed 2026-09-14. [Repo](https://github.com/generalaction/emdash) ·
[docs](https://docs.emdash.sh/) ·
[Show HN](https://news.ycombinator.com/item?id=47140322).

The closest thing to a twin Vibe has. Same thesis, almost beat for beat: a
cross-platform Electron desktop app, many coding agents at once, **one git
worktree per task**, review the diffs and merge what works, local-first with
nothing sent to their servers. Convergent design, arrived at independently.

**The one axis where we differ, and it's the important one.** Both projects say
"provider agnostic" and mean different layers:

|  | Emdash | Vibe |
|---|---|---|
| Agent loop | none — drives your installed CLIs | its own |
| Agnostic about | which *agent CLI* (Claude Code, Codex, Cursor, Amp…) | which *model* (OpenRouter, Anthropic, Ollama…) |
| What you must already have | a CLI agent, i.e. a paid subscription | an API key, or nothing at all |
| Inherits agent quality | yes, for free | no — we have to earn it |

That table is the whole strategic picture. Emdash gets Claude Code's harness
quality for nothing, which is a real advantage and shows up as our "small
models produce small-model results" caveat in the README. But their floor is a
paid subscription, whereas Vibe runs on free OpenRouter models or a local
Ollama for **$0**. The FOSS-first positioning isn't just branding — it's the
thing they structurally can't match. Sharpen it rather than drift away from it.
#79 is how we get their advantage too without giving up ours.

**Worth stealing** — filed above as #76 (worktree pre-warming), #77 (issue
ingestion), #78 (PRs and CI in-app), #79 (external CLI agents), #80 (board and
state scaling), #81 (scheduling). Their SSH/SFTP remote execution with keychain
credentials is the shape our long-standing "remote-dev" idea should take; not
filed yet because it's far out.

**Worth learning from without copying:**

- SQLite cost them `NODE_MODULE_VERSION` install failures on Windows and Linux.
  See the constraint in #80 — our all-pure-JS dependency tree is worth keeping.
- A commenter noted that embedding raw terminal windows makes a mobile or web
  view "a non-starter." Vibe renders structured transcripts, not terminals, so
  a future browser view stays open to us. Don't trade that away for the
  convenience of embedding a terminal.
- They're still working out a business model and floated bundling agent
  subscriptions. Vibe's answer is already settled and simpler.

**The shared risk, stated plainly.** From the HN thread: *"CLIs themselves are
getting good at [agent coordination] natively, but that's not provider
agnostic."* Emdash's founders agreed agents will absorb more orchestration over
time. The same erosion threatens Vibe. The durable ground is the part a single
CLI vendor won't build: cross-provider, cross-agent, human-in-the-loop review
of *parallel* work — the merge/overlap/PM-summary layer, not the chat window.
Invest there when choosing between two features of equal size.

---

## Verification owed

Shrinking. `tests/platform.test.ts` now covers `run_bash` and `launch_app`
against the real shell on all three CI platforms, and the Settings accelerator
branch. What's left genuinely needs a human, or an Electron runtime:

- ~~Does the app even launch on macOS and Linux?~~ **Answered 2026-09-15: yes.**
  The smoke job launches it on all three platforms in CI.
- Menu-bar visibility on Windows and Linux after a keybinding change
  (`electron/main/index.ts` hardcodes `autoHideMenuBar: false`) — the smoke job
  could be extended to assert on the built menu rather than leaving this to a
  human
- Provider-chain fallback surfacing when the primary model fails — does the UI
  make it clear which model actually served the turn?
- Merge against a stale branch ref, with the worktree deleted mid-flow
- **`safeStorage` encryption has never been executed by a test on any
  platform.** `tests/secretstore.test.ts` can only assert the plaintext
  fallback, because `isEncryptionAvailable()` returns false outside Electron —
  so the path every real user's API keys take is unverified. Needs the Electron
  smoke job below.

---

## Done · Runtime upgrade, Electron 33 → 44

Landed 2026-09-15, in two commits so either half can be reverted alone.
**Open advisories went from 7 to 2** — every Electron one cleared, including
the context isolation bypass that voided the README's claim about the renderer,
plus `vite` and (transitively) `extract-zip`.

What it actually took, against the scoping below:

- Toolchain: `vite` 5.4 → 7.3, `electron-vite` 2.3 → 5.0,
  `@vitejs/plugin-react` 4.7 → 5.2. The version choice is pinched from both
  sides: electron-vite 5 peers `vite ^5 || ^6 || ^7` so vite 8 is out, and
  plugin-react 6 requires vite ^8 — 5.2 is the only version that accepts vite
  7. Node floor rises to `^20.19 || >=22.12`.
- Electron 33 → 44.3.0. `npm install` removed 54 packages, which is the v42
  change where Electron stopped self-downloading via postinstall.
- The `dialog` `defaultPath` change (v43) was, as predicted, the **only** code
  edit needed: see `pickFolderOptions()` in `index.ts`. Nobody keeps repos in
  Downloads.
- Typecheck passed with no changes at all against the new Electron types, which
  is the payoff for using such a narrow slice of the API.

Verified by launching the built app and driving it over Electron's remote
debugging port (Node 24 has a built-in `WebSocket`, so this needed no
Playwright): window opens, renderer mounts the Control Center shell,
`window.vibe.config.get` is still a function through the contextBridge, zero
renderer errors, main process silent. That script is worth rebuilding as the
basis of the smoke job in the CI section below.

**Still outstanding — both from the scoping, neither done:**

- `monaco-editor` >= 0.54 bundles a vulnerable `dompurify` (the 2 remaining
  advisories). npm's fix is to *downgrade* 0.56 → 0.53. Monaco renders
  workspace file content, so it isn't theoretical. Deliberately not folded into
  this upgrade — decide it separately once someone checks whether a patched
  Monaco has shipped.
**Resolved the same day: the app launches on all three platforms.** The new
smoke job (see the CI section) confirmed it on macOS and Linux for the first
time — window opens, renderer mounts, contextBridge intact. The Wayland/GTK 4
concern from v38 did not materialise on the ubuntu runner.

One finding from that: on the **Windows** runner, Electron 44 reliably logs two
of its own startup errors into the renderer console —
`sandboxed_renderer.bundle.js script failed to run` and a destructure of a null
`binding.startupData`, both from `node:electron/js2c/sandbox_bundle`. Neither
comes from our code and neither is fatal: the contextBridge check passes in the
same run, so the preload works. The smoke test classifies renderer errors by
origin and only fails on ours. Worth revisiting if Electron patches it, and
worth suspicion if it ever starts appearing on other platforms.

### Original scoping, kept for the reasoning

Scoped 2026-09-14 against the
[Electron breaking-changes doc](https://www.electronjs.org/docs/latest/breaking-changes).

**Why it can't wait.** Seven high-severity Electron advisories are open, and
one is a context isolation bypass (`Function.prototype.bind` hijack). Vibe's
security story is "the renderer has no Node integration, everything crosses
through `contextBridge`" — that bypass voids precisely that, in an app whose
renderer displays model-generated content and whose main process runs
unsandboxed shell commands. The advisory range is
`<=40.10.2 || 41.x <=41.7.1 || 42.x <=42.3.3`, so **nothing below 43 clears
it**; npm's fix target is 44.3.0.

**The good news: our Electron surface is tiny.** The whole app imports
`app`, `BrowserWindow`, `ipcMain`, `dialog`, `Menu`, `shell`, `contextBridge`,
`ipcRenderer`, `safeStorage`, and the `WebContents` type. Grepped and confirmed
we use **none** of the APIs behind the scarier changes: no `clipboard`
(removed from the renderer in 44, rearchitected to Promises), no
`app.commandLine` (lowercased in 36), no `BrowserView`, no
`session.setPreloads` (deprecated in 35 — we use `webPreferences.preload`), no
`webFrame`, `nativeImage`, `systemPreferences` or `desktopCapturer`.

**What actually touches us:**

| Version | Change | Impact |
|---|---|---|
| 43 | `dialog` `defaultPath` now defaults to Downloads rather than the last directory | Both `showOpenDialog` calls (the workspace picker) — the picker will open in Downloads. Fix: pass `defaultPath` explicitly. ~10 lines. |
| 35 | `defaultPath` unsupported on Linux without xdg-portal v4+ | Same picker, degrades on older Linux |
| 34 | Menu bar hidden during fullscreen on Windows | Interacts with our deliberate `autoHideMenuBar: false` and the menu-bar item under "Verification owed" |
| 38 | Wayland by default, GTK 4 on GNOME | Rendering risk on Linux — a platform nobody has run Vibe on yet |
| 38, 44 | macOS floor rises to Ventura; 32-bit Windows and Linux ARM binaries dropped | Sets #66's target list and the README's stated requirements |
| 42 | Electron no longer self-downloads via postinstall | Install/CI behaviour; watch the `npm ci` step |

`safeStorage` and `Menu` construction have **no breaking changes listed across
34–44**, which is the best available news for the two areas with no test
coverage. "Nothing listed" is not "nothing changed", though, and safeStorage
remains unverified on every platform — so treat the first packaged build as the
moment to confirm a key actually round-trips.

**The toolchain moves with it**, and this is where the real risk sits:

- `electron-vite` 2.3 → 5.0
- `vite` 5.4 → **7**, not 8. The advisory needs `>6.4.2`, and electron-vite 5
  peers `^5 || ^6 || ^7` — vite 8 is outside it.
- `@vitejs/plugin-react` to whatever pairs with vite 7.

**Separately, and awkwardly: `monaco-editor`.** Versions `>=0.54` bundle a
vulnerable `dompurify` (four moderate XSS advisories). npm's suggested fix is
to *downgrade* 0.56 → 0.53. Monaco renders workspace file content in the Files
tab, so it isn't purely theoretical. Don't fold this into the Electron bump —
decide it on its own once someone checks whether a patched Monaco has shipped.

**Suggested order:** toolchain first (electron-vite + vite + plugin-react,
confirm dev and build still work), then Electron in one jump to 44, then fix
the `dialog` defaultPath, then run the app on all three platforms before
believing any of it. The CI matrix built this session is what makes an
eleven-major jump tractable at all — before it, two-thirds of the platforms
were guesswork.

---

## CI, and CD when #66 lands

CI runs typecheck + test + build on Linux/Windows/macOS
(`.github/workflows/ci.yml`). There is deliberately no release workflow yet —
there's nothing to publish until electron-builder config and signing certs
exist. Adding the release job is part of #66.

**Electron smoke job — done 2026-09-15**, earlier than planned. It was deferred
to #66 on the grounds that smoke-testing a *packaged* app is worth more than
smoke-testing a dev build, and that Electron-in-CI is flaky. The first half
still holds and the job should be re-pointed at the packaged artifacts when #66
lands. The second turned out to be cheap to manage: the only instability was
Electron logging its own startup errors on the Windows runner, fixed by
classifying errors by origin.

Building it early paid for itself immediately — it answered the
longest-standing open question in this file (does the app run on macOS and
Linux?) on its first run.

`scripts/smoke.mjs` drives the app over the remote debugging port with Node's
built-in `WebSocket`, so it needs no Playwright. It runs as a separate job from
`check` because a red `check` should always mean real breakage.

Still not covered even by the smoke job: `safeStorage` round-trips and menu
construction. Both are reachable from here — the app is live and scriptable, so
asserting on them is an extension of this script rather than new
infrastructure.
