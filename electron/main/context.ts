import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

const DEFAULT_CONTEXT = `# Project Context

Describe your project here. This file is prepended to every agent's system prompt,
so keep it concise (aim for under 1000 words). Update it as the project evolves.

## Stack
- (fill in)

## Conventions
- (fill in)

## Current focus
- (fill in)
`

export const DEFAULT_AGENTS_MD = `# How Vibe Works (read this first)

You are one of multiple agents working on this codebase concurrently. Each agent runs
in an isolated git worktree on its own branch. When you finish, a human reviews your
diff and merges it into main.

## Your environment
- You have your own git worktree. Changes you make are isolated from other agents
  and from the main branch until merged.
- All file paths in your tools are RELATIVE to your worktree root.
- Do NOT modify anything under \`.vibe/\` — that directory is Vibe's internal state
  (worktrees, agent state, shared context). Modifying it will break things.

## Shared project context
- Project-wide context (stack, goals, conventions) IS ALREADY INCLUDED in your
  system prompt above under "# Project Context". You already have it. DO NOT try
  to read \`.vibe/context/project.md\` or any file in \`.vibe/\` — that directory
  does not exist in your worktree.
- If you think the project context should be updated, describe the proposed change
  in your chat output and the human will apply it.

## Your tools
- \`read_file(path, offset?, limit?)\` — read a file relative to your worktree.
  Pass \`offset\` (1-indexed line number) and \`limit\` (max lines) to page
  through large files. Returns line-numbered output when paging.
- \`write_file(path, content)\` — write/create a file. Use for NEW files.
- \`replace_in_file(path, edits)\` — surgical edits to an existing file.
  Each edit is \`{ search, replace }\` (or \`{ search, replace, all: true }\`
  to replace every occurrence). Fails atomically if the search isn't unique
  or isn't found — PREFER this over write_file when editing existing code,
  it catches unexpected file drift and preserves surrounding content.
- \`list_files(path)\` — list directory contents; use \`.\` for root
- \`run_bash(command)\` — run a short shell command. IMPORTANT: On Windows, the
  shell is PowerShell 5.1, which does NOT support \`&&\` or \`||\` chaining. Use
  \`;\` to chain, or run one command per call. On macOS/Linux the shell is bash.
- \`ask_human(question)\` — free-form question. Use when the answer is
  open-ended. Loop pauses until the human replies.
- \`ask_human_choice(question, options[])\` — question with 2-6 discrete
  options. UI renders as clickable buttons. Much faster for the human than
  typing. Prefer this over \`ask_human\` whenever you can enumerate choices.
- \`todo_write(todos[])\` — maintain a structured todo list for this task.
  USE THIS at the START of any non-trivial multi-step task to plan the work,
  and UPDATE as you complete steps. Each todo has content + status
  (pending/in_progress/done). Overwrites the whole list each call — pass full
  state. Helps you stay focused across many tool calls without losing thread.
- \`todo_read()\` — get the current todo list. Use when resuming after many
  tool calls to remember what's left.
- Do NOT bundle questions into \`finish\`.
- \`finish(summary)\` — call ONLY when the task is complete AND you have no open
  questions. Provide a short summary of what changed. If you still have
  questions, call \`ask_human\` instead.

## Boundaries
- Do NOT \`cd\` out of your worktree. All work stays inside your worktree root.
- Do NOT create files or directories that start with \`.vibe\` — that namespace
  is reserved for Vibe's internal state.

## Dependency isolation (IMPORTANT)
Your worktree is on the user's machine. Installing packages globally is a leak
that affects other projects and stays after your work is deleted. Always keep
dependencies local to the worktree.

- **Python**: before any \`pip install\`, create and activate a venv:
  - Windows: \`python -m venv .venv; .\\.venv\\Scripts\\Activate.ps1; pip install <pkg>\`
  - macOS/Linux: \`python -m venv .venv && source .venv/bin/activate && pip install <pkg>\`
  - Then use \`.venv/bin/python\` (or \`.venv\\Scripts\\python.exe\` on Windows) for
    all subsequent commands. Also write a \`requirements.txt\`.
- **Node/JS**: \`npm install\` and \`pnpm install\` are already project-local — safe.
  Do not use \`npm install -g\`.
- **Rust**: \`cargo\` is already project-local — safe.
- **Go**: use go modules (\`go mod init\`, \`go get\`) — already project-local.
- **Anything else**: if the tool has a "global install" flag, do not use it.

If you cannot avoid a global install, STOP and ask the human first.

## Working style
- Be concise. Do not narrate every step in chat.
- If you don't know the codebase, \`list_files .\` first, then read relevant files.
- Prefer small, focused changes over sweeping refactors.
- If the task is ambiguous, ask a clarifying question in chat instead of guessing.
- Always end with a \`finish\` call — this signals completion.
`

export async function ensureContextFile(workspacePath: string): Promise<string> {
  const vibeDir = path.join(workspacePath, '.vibe', 'context')
  const contextPath = path.join(vibeDir, 'project.md')
  if (!existsSync(contextPath)) {
    await mkdir(vibeDir, { recursive: true })
    await writeFile(contextPath, DEFAULT_CONTEXT, 'utf8')
  }
  // Also seed the workspace-level AGENTS.md so users can customize per-project.
  const agentsMdPath = path.join(workspacePath, '.vibe', 'AGENTS.md')
  if (!existsSync(agentsMdPath)) {
    await mkdir(path.join(workspacePath, '.vibe'), { recursive: true })
    await writeFile(agentsMdPath, DEFAULT_AGENTS_MD, 'utf8')
  }
  return contextPath
}

export async function readContext(workspacePath: string): Promise<string> {
  const p = await ensureContextFile(workspacePath)
  return readFile(p, 'utf8')
}

export async function writeContext(workspacePath: string, content: string): Promise<void> {
  const p = await ensureContextFile(workspacePath)
  await writeFile(p, content, 'utf8')
}

const DEFAULT_SUMMARY = `# Project Summary (auto-maintained)

This file is maintained by the PM agent. It gets rewritten after each merge to
reflect the current state of the project. Do not edit manually — your changes
will be overwritten.

_No summary generated yet. This file will populate after the first merge, or when
you click "Regenerate now" in the Summary tab._
`

async function ensureSummaryFile(workspacePath: string): Promise<string> {
  const p = path.join(workspacePath, '.vibe', 'context', 'summary.md')
  if (!existsSync(p)) {
    await mkdir(path.dirname(p), { recursive: true })
    await writeFile(p, DEFAULT_SUMMARY, 'utf8')
  }
  return p
}

export async function readSummary(workspacePath: string): Promise<string> {
  const p = await ensureSummaryFile(workspacePath)
  return readFile(p, 'utf8')
}

export async function writeSummary(workspacePath: string, content: string): Promise<void> {
  const p = await ensureSummaryFile(workspacePath)
  await writeFile(p, content, 'utf8')
}

export async function summaryLastModified(workspacePath: string): Promise<string | null> {
  const p = path.join(workspacePath, '.vibe', 'context', 'summary.md')
  if (!existsSync(p)) return null
  const { stat } = await import('node:fs/promises')
  const s = await stat(p)
  return s.mtime.toISOString()
}

export async function readAgentsGuide(workspacePath: string): Promise<string> {
  const overridePath = path.join(workspacePath, '.vibe', 'AGENTS.md')
  if (existsSync(overridePath)) {
    return readFile(overridePath, 'utf8')
  }
  return DEFAULT_AGENTS_MD
}
