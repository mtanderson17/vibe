# Backlog

Planned work, in the repo so it survives between sessions. Shipped work lives in
`git log`, not here — an item leaves this file when it lands.

**#66 is the keystone.** Four of the eight open items (#73, #74, #75, and the
install half of #67) are blocked on packaging existing.

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

---

## Verification owed

Not code — someone has to run the app and look. Carried over from the
2026-09-12 audit.

- Menu-bar visibility on Windows and Linux after a keybinding change
  (`electron/main/index.ts` hardcodes `autoHideMenuBar: false`)
- Provider-chain fallback surfacing when the primary model fails — does the UI
  make it clear which model actually served the turn?
- Merge against a stale branch ref, with the worktree deleted mid-flow

---

## CD, when #66 lands

CI runs typecheck + test + build on Linux/Windows/macOS
(`.github/workflows/ci.yml`). There is deliberately no release workflow yet —
there's nothing to publish until electron-builder config and signing certs
exist. Adding the release job is part of #66.
