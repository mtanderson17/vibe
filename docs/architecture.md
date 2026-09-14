# Architecture

Where things live and why, for anyone changing the code.

## Process split

```
┌──────────────────────────────────────────────────────┐
│  Renderer (React + Zustand)                          │
│  src/                                                │
│  - Never touches disk or network directly            │
└───────────────────────┬──────────────────────────────┘
                        │ IPC over contextBridge
                        │ electron/preload/index.ts
┌───────────────────────▼──────────────────────────────┐
│  Main process                                        │
│  electron/main/                                      │
│  - Agent lifecycle, git worktrees, providers,        │
│    PM agent, conflict resolver, persistence          │
└──────────────────────────────────────────────────────┘
```

The renderer has no Node integration. Every capability it has is a method the
preload script explicitly exposed on `window.vibe`, typed in `src/types.ts`.
Adding a capability means touching three files: the handler in
`electron/main/index.ts`, the bridge in `electron/preload/index.ts`, and the
type in `src/types.ts`.

## Main process

| Module | Responsibility |
|---|---|
| `index.ts` | Window creation and every IPC handler |
| `agent.ts` | Agent lifecycle — spawn, run, kill, close |
| `tool-loop.ts` | The provider-agnostic tool-call loop |
| `tools.ts` | Built-in tool implementations |
| `agent-prompt.ts` | System prompt assembly |
| `providers/` | `aisdk.ts` (Vercel AI SDK adapters) + `index.ts` (chain resolution, fallback) |
| `git.ts` | Worktrees, branches, merges, diffs, overlap checks |
| `resolver.ts` | AI merge-conflict resolution |
| `pmagent.ts` | PM loop — summary regeneration, task proposals |
| `tasks.ts` | `.vibe/tasks.json` CRUD |
| `context.ts` | `project.md` / `summary.md` / `AGENTS.md` |
| `condenser.ts` | Transcript compaction past a token budget |
| `ledger.ts` | Append-only JSONL cost ledger |
| `pricing.ts`, `catalog.ts`, `probe.ts` | Model pricing, catalogs, liveness probing |
| `config.ts`, `secretstore.ts` | Config store, `safeStorage` encryption |
| `persistence.ts` | Agent state to `.vibe/agents/*.json` |
| `approval.ts` | Dangerous-command gating |
| `mcp.ts` | MCP client — connect, list tools, dispatch |
| `files.ts`, `launcher.ts` | Workspace file access, app launching |
| `keybindings.ts`, `menu.ts` | Shortcut registry and the native menu built from it |

## Renderer

```
src/
├── App.tsx              # shell: view state + bridge wiring, nothing else
├── Setup.tsx            # settings / first-run; owns the save draft
├── AgentPanel.tsx       # one agent's transcript + composer
├── ControlCenter.tsx    # all-agents grid
├── TasksView.tsx        # kanban board
├── FilesView.tsx        # Monaco (lazy — ~8 MB)
├── CostView.tsx, ContextView.tsx
├── hooks/               # useMenuCommands, useCommands
├── stores/              # zustand: agents, prefs
└── components/
    ├── settings/        # one file per Settings tab + providers catalogue
    ├── tasks/           # TaskCard, PmPanel
    └── …                # MergePanel, CommandPalette, DiffView, …
```

Two conventions worth keeping:

**Screens own state; components take props.** `App.tsx` owns which view is
showing and which agent is focused. `TasksView` owns the task list. `Setup` owns
the save draft. Everything under `components/` is given what it needs, with one
deliberate exception: `PmPanel` owns its own chat state, because nothing above
it needs to know about PM messages.

**Subscribe narrowly.** `AgentTab` reads `s.agents[id]`, not `s.agents` — so one
agent streaming tokens doesn't re-render every other tab. Widening that
subscription is an easy and invisible performance regression.

## Keybindings are menu commands

There is no keydown listener for shortcuts anywhere in the renderer. The flow:

```
keybindings.ts  (registry: id → default accelerator)
      ↓  + config.keybindings overrides
menu.ts         (builds the native menu)
      ↓  IPC 'menu:<command>'
useMenuCommands.ts  (switch → renderer state)
```

That's why a user's rebind works without the renderer knowing anything about
accelerators. **Adding a shortcut means adding it to `KEYBINDINGS` and handling
its channel in `useMenuCommands` — never a local keydown listener.**

## Provider layer

`providers/index.ts` resolves a comma-separated chain into an ordered list and
tries each in turn. `providers/aisdk.ts` maps a provider-prefixed slug to a
Vercel AI SDK model instance. Adding a provider means: an adapter case there, a
key field in `Config`, and an entry in
`src/components/settings/providers.ts` — that last one drives the Settings row,
the draft seed, the save patch, and the model-picker overlay from a single
definition.

## Tests

`node --test` via `tsx` — no test framework dependency. `npm test` goes through
`scripts/run-tests.mjs`, which walks `tests/` and hands node explicit file
paths; extra args are forwarded, so `npm test -- --test-name-pattern=merge`
works. The script exists because nothing expands a `tests/**/*.test.ts` glob
consistently — POSIX `sh` expands `**` like `*`, GitHub's Windows runner uses
pwsh which doesn't expand it at all, and node only globs on v22+.

- Pure logic (`tests/*.test.ts`) — tools, condenser, ledger, git parsing,
  config migration, keybinding resolution, the provider catalogue.
- Components and hooks (`tests/*.test.tsx`) — happy-dom plus Testing Library.
  Import `tests/helpers/dom.ts` **first**; it registers the browser globals
  before React is evaluated and installs a `window.vibe` stub that each test
  overrides per namespace.

Tests that assert platform-specific behaviour (path separators, shell quoting)
must guard on `process.platform` — CI runs the suite on all three, and a test
that only holds on one will break the other two.

One sharp edge: `tsx` only applies a tsconfig's `compilerOptions` to files that
config's `include` matches. The root `tsconfig.json` therefore carries
`compilerOptions` + `include` purely so `.tsx` tests get the automatic JSX
runtime. It's still a solution file — `npm run typecheck` runs the two
referenced projects explicitly.

## CI

`.github/workflows/ci.yml` runs typecheck, tests, and a production build on
Linux, Windows, and macOS (Node 20, plus Node 22 on Linux). There's no release
workflow yet — nothing to publish until packaging exists
([#66](../BACKLOG.md)).
