# Configuration

Two places hold configuration: **app config** (per user, outside your repo) and
**workspace config** (per project, in your repo).

## App config

Lives in Electron's per-user data directory, deliberately outside the project
folder so it can't be committed:

| Platform | Path |
|---|---|
| Windows | `%APPDATA%\vibe\config.json` |
| macOS | `~/Library/Application Support/vibe/config.json` |
| Linux | `~/.config/vibe/config.json` |

Everything in it is editable from **Settings** in the app. Editing the file by
hand works but isn't watched — restart afterwards.

| Field | Default | Meaning |
|---|---|---|
| `workspacePath` | `null` | Current project folder |
| `recentWorkspaces` | `[]` | MRU list, current at index 0 |
| `model` | `openrouter/free,minimax/minimax-m3:free` | Coding-agent model chain |
| `pmModel` | `null` | PM-agent chain; falls back to `model` |
| `agentCount` | `4` | Max concurrent agents (1–8) |
| `maxSteps` | `100` | Tool-call turns before an agent pauses for input |
| `keybindings` | `{}` | Per-id overrides; `""` means unbound |
| `submitOnEnter` | `true` | Enter sends vs Cmd/Ctrl+Enter sends |
| `*ApiKey` | `null` | Six provider keys, encrypted at rest |

### API keys

Keys are encrypted at rest with Electron's `safeStorage` — Keychain on macOS,
DPAPI on Windows, kwallet/libsecret on Linux. Encrypted values carry an `enc:`
prefix in the file. On a Linux box with no keyring available, storage falls back
to plain text; plain values are migrated to encrypted transparently on read.

Six providers are supported: OpenRouter, Anthropic, OpenAI, Gemini, Groq, xAI.
Add one on the **API Keys** tab. A key typed there is visible to the model
pickers immediately, before you save, so you can pick a newly-unlocked model in
the same visit.

### Model chains

A model setting is a **comma-separated fallback chain**, not a single model:

```
anthropic/claude-sonnet-4-6,openrouter/free
```

First is primary; on failure Vibe falls through to the next. Slugs are
provider-prefixed:

| Provider | Slug shape |
|---|---|
| OpenRouter | `meta-llama/llama-3.3-70b-instruct:free` |
| Anthropic | `anthropic/claude-sonnet-4-6` |
| OpenAI | `openai/gpt-5` |
| Gemini | `google/gemini-2.5-pro` |
| Groq | `groq/llama-3.3-70b-versatile` |
| xAI | `xai/grok-4` |
| Ollama | `ollama/<model name>` |

Chains resolve at three levels, most specific first: **per-agent override**
(in the agent header) → **role chain** (`model` or `pmModel`) → nothing.

### Keybindings

Every shortcut is owned by the main process and delivered to the UI as a menu
command, which is why overrides work without the renderer knowing anything about
accelerators. Rebind them under **Settings → Keybindings**; changes save
immediately and rebuild the app menu.

| Command | Default |
|---|---|
| Open project… | `Cmd/Ctrl+O` |
| Open Settings | `Cmd+,` / `Ctrl+,` |
| Control Center / Tasks / Files / Cost / Context | `Cmd/Ctrl+1`–`5` |
| New agent | `Cmd/Ctrl+T` |
| Close current agent | `Cmd/Ctrl+W` |
| Focus next / previous agent | `Cmd/Ctrl+]` / `Cmd/Ctrl+[` |
| Stop current agent | `Cmd/Ctrl+.` |
| New task… | `Cmd/Ctrl+Shift+T` |
| Regenerate project summary | `Cmd/Ctrl+Shift+R` |
| Command palette | `Cmd/Ctrl+K` |
| Keyboard shortcuts | `Cmd/Ctrl+/` |

An override of `""` unbinds a command — the menu item stays, the accelerator
goes away.

### Submit key

`submitOnEnter: true` (default) means Enter sends and Shift+Enter makes a
newline, like a chat app. `false` inverts it: Enter makes a newline,
Cmd/Ctrl+Enter sends — better for long multi-line prompts.

It applies to the multi-field composers (agent chat, task description, the
new-task modal, the inline task editor). Genuinely single-line inputs — the
board's task-title box, the PM composer — always send on plain Enter, since
there's no newline to be ambiguous about.

## Workspace config

In your project, in git:

```
your-project/
├── .gitignore              # seeded by Vibe on first init
└── .vibe/
    ├── AGENTS.md           # per-project agent conventions (yours)
    ├── mcp.json            # MCP server definitions (yours)
    ├── context/
    │   ├── project.md      # human-owned project brief
    │   └── summary.md      # PM-maintained running state
    ├── tasks.json          # kanban backing store
    ├── agents/             # persisted agent state — gitignored
    └── worktrees/          # git worktrees per agent — gitignored
```

`agents/` and `worktrees/` are runtime state and are gitignored. Everything else
is meant to be committed and reviewed like any other project file.

### `.vibe/AGENTS.md`

Per-project rules for agents, seeded on init and injected into every prompt.
The place for "use pnpm, not npm", "tests go next to the source file", "don't
touch `generated/`".

### `.vibe/mcp.json`

MCP servers to connect. Their tools appear to agents as built-ins, namespaced
`mcp_<server>_<tool>`.

```json
{
  "servers": {
    "playwright": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp"]
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/some/path"],
      "enabled": false
    }
  }
}
```

`enabled` defaults to true; set it false to keep a definition around without
connecting it.

### `.vibe/context/project.md`

Yours to write, and the highest-leverage file in the repo for agent output
quality. What the project is, how it's laid out, what the conventions are, what
not to touch. An agent that knows your conventions writes code that looks like
yours.

`summary.md` next to it belongs to the PM agent — it gets rewritten after
merges, so don't hand-edit it expecting the edit to survive.
