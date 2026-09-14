# Backlog

Planned work, in the repo so it survives between sessions. Shipped work lives in
`git log`, not here — an item leaves this file when it lands.

**#66 is the keystone.** Four items (#73, #74, #75, and the install half of
#67) are blocked on packaging existing — as is the Electron smoke job that
would close most of what's still unverified.

**But the dependency upgrade comes first.** Electron is eleven majors behind
(33 vs 44) with seven high-severity advisories open, including a context
isolation bypass — which voids the exact guarantee the README makes about the
renderer. Shipping signed installers on that runtime would mean shipping the
bypass to every user and re-shipping later. See "Runtime upgrade" below.

**If you want the best value-per-hour item instead, it's #76** (pre-warm
worktrees): it's small, measurable, and speeds up the most repeated interaction
in the app.

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

### #76 · Pre-warm worktrees

Emdash cut task startup from 5 s to 500–1000 ms by creating worktrees in the
background before they're needed. Vibe has the same cost in the same place:
`createWorktree` does a `worktree remove` → `branch -D` → `worktree add`
synchronously when you assign a task, and the user waits through it.

Not a pure copy, because of how we name branches. `createWorktree` takes a
`taskSlug` and creates `vibe/<agent>/<slug>` in the same `worktree add -b`
call, so a pre-warmed worktree can't know its branch name yet. Two ways out:
add the worktree detached and create the branch at assignment, or warm it on a
placeholder branch and `git branch -m` when the task arrives.

Cheap, measurable, and it improves the single most repeated interaction in the
app. Best value-per-hour item on this list.

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

Worth stealing specifically: Emdash detects installed provider CLIs
automatically, and installs marker-tagged lifecycle hooks into their config so
it gets progress, notifications and resumable sessions — hooks that stay inert
when the agent runs outside Emdash. That's a well-mannered integration pattern
and better than screen-scraping a terminal.

This supersedes the vague "ACP support" line that used to sit in the README
roadmap.

### #80 · Make the board and agent state scale

An Emdash user reported significant UI lag at 78 tasks. Vibe will hit this
sooner: `TasksView` re-filters the whole task array once per column on every
render and nothing is virtualized, and every task mutation rewrites the whole
of `tasks.json`.

Two halves, and they deserve different answers:

- **The board** — memoize the per-column partition, virtualize long columns.
  Straightforward.
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

### Bug · `launch_app` output is lost on Windows

`launchApp` spawns with `detached: true` through `cmd.exe`. On Windows that puts
the grandchild on a new console, so nothing reaches the pipes we set up:
`earlyOutput` and `tailApp` are **always empty on Windows**.

User-visible consequence: when a launched app dies inside the 1.5 s window, the
error says *"the command likely does not exist on PATH, or a launcher script
exited immediately"* regardless of what actually happened — so a script that
threw a real error reports a misleading cause.

Demonstrated with a spawn matrix; `detached` is the variable, not `/s` quote
stripping:

| spawn | captured |
|---|---|
| `cmd.exe` + detached (current behaviour) | *nothing* |
| `cmd.exe`, not detached | `died` |
| `node` directly + detached | `died` |

The trade-off to settle: `detached: true` is what lets a launched app outlive
Vibe, which is the point of `launch_app`. Options are to keep detached and find
another way to capture output (a log file the child redirects into, which also
fixes `tailApp` after a restart), or to spawn without the intermediate shell on
Windows when the command needs no shell features.

`tests/platform.test.ts` asserts the good behaviour on macOS/Linux and skips
Windows with a pointer here — remove that guard as part of the fix.

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

- **Does the app even launch on macOS and Linux?** Nobody has run the GUI
  there. CI proves typecheck, tests and `npm run build` pass; it never boots
  Electron. One manual run on each would answer this faster than any
  automation.
- Menu-bar visibility on Windows and Linux after a keybinding change
  (`electron/main/index.ts` hardcodes `autoHideMenuBar: false`)
- Provider-chain fallback surfacing when the primary model fails — does the UI
  make it clear which model actually served the turn?
- Merge against a stale branch ref, with the worktree deleted mid-flow
- **`safeStorage` encryption has never been executed by a test on any
  platform.** `tests/secretstore.test.ts` can only assert the plaintext
  fallback, because `isEncryptionAvailable()` returns false outside Electron —
  so the path every real user's API keys take is unverified. Needs the Electron
  smoke job below.

---

## Runtime upgrade · Electron 33 → 44 (do before #66)

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

**Electron smoke job — deferred to #66, on purpose.** Booting the app in CI
(xvfb on Linux) would cover window creation, menu construction, quit
behaviour, the menu-bar item above, and the `safeStorage` gap. Deferred
because at #66 there will be packaged artifacts, and smoke-testing the packaged
app is strictly more valuable than smoke-testing `electron-vite preview` —
otherwise the harness gets built twice and only the second one matters. The
secondary reason: Electron-in-CI is flaky (xvfb, sandbox flags, GPU quirks,
slow macOS runners), and a job that goes red at random trains everyone to
ignore CI.
