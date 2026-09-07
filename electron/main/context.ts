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
- \`read_file(path)\` — read a file relative to your worktree
- \`write_file(path, content)\` — write/create a file
- \`list_files(path)\` — list directory contents; use \`.\` for root
- \`run_bash(command)\` — run a short shell command. IMPORTANT: On Windows, the
  shell is PowerShell 5.1, which does NOT support \`&&\` or \`||\` chaining. Use
  \`;\` to chain, or run one command per call. On macOS/Linux the shell is bash.
- \`finish(summary)\` — call this when the task is complete, with a short summary
  of what changed for the human reviewer.

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

export async function readAgentsGuide(workspacePath: string): Promise<string> {
  const overridePath = path.join(workspacePath, '.vibe', 'AGENTS.md')
  if (existsSync(overridePath)) {
    return readFile(overridePath, 'utf8')
  }
  return DEFAULT_AGENTS_MD
}
