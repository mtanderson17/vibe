import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

const exec = promisify(execFile)

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd, windowsHide: true, maxBuffer: 10 * 1024 * 1024 })
  return stdout.trim()
}

async function ensureLocalIdentity(cwd: string): Promise<void> {
  try { await git(cwd, ['config', 'user.email']) } catch { await git(cwd, ['config', 'user.email', 'agent@vibe.local']) }
  try { await git(cwd, ['config', 'user.name']) } catch { await git(cwd, ['config', 'user.name', 'Vibe Agent']) }
}

const DEFAULT_GITIGNORE = `# Vibe internal
.vibe/worktrees/
.vibe/agents/

# Secrets (never let an agent commit these)
.env
.env.*
*.pem
*.key
secrets/
credentials.json
service-account*.json

# Python
__pycache__/
*.py[cod]
*.egg-info/
.venv/
venv/
.pytest_cache/

# Node
node_modules/
dist/
out/
build/
.next/

# Editors / OS
.DS_Store
Thumbs.db
.idea/
.vscode/
*.log
`

export async function ensureRepo(workspacePath: string): Promise<void> {
  if (!existsSync(path.join(workspacePath, '.git'))) {
    await git(workspacePath, ['init'])
  }
  await ensureLocalIdentity(workspacePath)

  // Ensure a sensible .gitignore exists so agents don't commit bytecode, deps, etc.
  const gitignorePath = path.join(workspacePath, '.gitignore')
  if (!existsSync(gitignorePath)) {
    const { writeFile } = await import('node:fs/promises')
    await writeFile(gitignorePath, DEFAULT_GITIGNORE, 'utf8')
  }

  // Ensure at least one commit exists so worktrees can branch off
  try {
    await git(workspacePath, ['rev-parse', 'HEAD'])
  } catch {
    await git(workspacePath, ['add', '.gitignore']).catch(() => { /* no gitignore, that's fine */ })
    await git(workspacePath, ['commit', '--allow-empty', '-m', 'vibe: initial commit'])
  }
}

export async function currentBranch(workspacePath: string): Promise<string> {
  return git(workspacePath, ['rev-parse', '--abbrev-ref', 'HEAD'])
}

export function worktreePathFor(workspacePath: string, agentId: string): string {
  return path.join(workspacePath, '.vibe', 'worktrees', agentId)
}

/**
 * Create the agent's worktree ahead of time, detached at HEAD.
 *
 * `git worktree add` is the slow part of starting a task — it materialises a
 * full checkout — and it used to run while the user waited. Doing it at spawn
 * time instead means starting a task only has to create a branch inside a
 * checkout that already exists, which is near-instant.
 *
 * Detached rather than on a branch because the branch name embeds the task
 * slug, which doesn't exist yet: the task hasn't been written. `createWorktree`
 * names the branch later.
 *
 * Safe to call repeatedly and safe to ignore: a failure here just means the
 * slow path runs at task time, so callers should fire-and-forget.
 */
export async function prewarmWorktree(workspacePath: string, agentId: string): Promise<void> {
  const worktreePath = worktreePathFor(workspacePath, agentId)
  if (existsSync(worktreePath)) return
  await mkdir(path.dirname(worktreePath), { recursive: true })
  await git(workspacePath, ['worktree', 'add', '--detach', worktreePath, 'HEAD'])
}

export async function createWorktree(
  workspacePath: string,
  agentId: string,
  taskSlug: string
): Promise<{ worktreePath: string; branch: string }> {
  const branch = `vibe/${agentId}/${taskSlug}`
  const worktreePath = worktreePathFor(workspacePath, agentId)
  await mkdir(path.dirname(worktreePath), { recursive: true })

  const dropStaleBranch = async () => {
    // git refuses to delete a branch that is checked out anywhere, so this can
    // only run once nothing has it.
    try { await git(workspacePath, ['branch', '-D', branch]) } catch { /* not existing */ }
  }

  // Fast path: a prewarmed (or previously used) checkout is already on disk, so
  // just put a fresh branch in it rather than materialising the tree again.
  //
  // Reset to the *workspace's* current HEAD, not the worktree's: a prewarmed
  // tree was pinned when the agent spawned, and a reused one still sits on the
  // last task's commits. A new task has to start from current main either way.
  if (existsSync(worktreePath)) {
    try {
      const head = await git(workspacePath, ['rev-parse', 'HEAD'])
      await git(worktreePath, ['checkout', '--detach', head])  // leave any previous task branch
      await git(worktreePath, ['reset', '--hard', head])       // drop leftovers from a prior task
      await git(worktreePath, ['clean', '-fd'])
      await dropStaleBranch()                                  // safe now that it isn't checked out
      await git(worktreePath, ['checkout', '-b', branch])
      return { worktreePath, branch }
    } catch {
      // Reusing it failed — fall through and rebuild from scratch.
      await git(workspacePath, ['worktree', 'remove', '--force', worktreePath]).catch(() => { /* ignore */ })
    }
  }

  await dropStaleBranch()
  await git(workspacePath, ['worktree', 'add', '-b', branch, worktreePath])
  return { worktreePath, branch }
}

export async function worktreeStatus(worktreePath: string): Promise<string> {
  return git(worktreePath, ['status', '--porcelain'])
}

export async function commitAll(worktreePath: string, message: string): Promise<void> {
  const status = await worktreeStatus(worktreePath)
  if (!status) return
  await git(worktreePath, ['add', '-A'])
  await git(worktreePath, ['commit', '-m', message])
}

export interface MergeResult {
  ok: boolean
  conflicts: string[]
  output: string
}

export async function mergeBranch(workspacePath: string, branch: string): Promise<MergeResult> {
  try {
    const out = await git(workspacePath, ['merge', '--no-ff', '-m', `vibe: merge ${branch}`, branch])
    return { ok: true, conflicts: [], output: out }
  } catch (e) {
    const output = (e as { stdout?: string; stderr?: string }).stdout ?? (e as Error).message
    const conflicts = await git(workspacePath, ['diff', '--name-only', '--diff-filter=U']).catch(() => '')
    return { ok: false, conflicts: conflicts.split('\n').filter(Boolean), output }
  }
}

export async function abortMerge(workspacePath: string): Promise<void> {
  try {
    await git(workspacePath, ['merge', '--abort'])
  } catch { /* nothing to abort */ }
}

export async function removeWorktree(workspacePath: string, worktreePath: string): Promise<void> {
  try {
    await git(workspacePath, ['worktree', 'remove', '--force', worktreePath])
  } catch { /* ignore */ }
}

export async function deleteBranch(workspacePath: string, branch: string): Promise<void> {
  try {
    await git(workspacePath, ['branch', '-D', branch])
  } catch { /* ignore */ }
}

// Files changed on `branch` compared to its merge-base with the default branch (main/master).
export async function branchChangedFiles(workspacePath: string, branch: string, base = 'HEAD'): Promise<string[]> {
  try {
    const mergeBase = await git(workspacePath, ['merge-base', base, branch]).catch(() => base)
    const out = await git(workspacePath, ['diff', '--name-only', `${mergeBase}...${branch}`])
    return out.split('\n').map(l => l.trim()).filter(Boolean)
  } catch {
    return []
  }
}

export interface BranchDiff {
  files: Array<{
    path: string
    addedLines: number
    removedLines: number
    diff: string   // unified diff for this file
  }>
  totalAdded: number
  totalRemoved: number
}

// Get a full unified diff of branch vs current HEAD (usually main), split per file.
export async function branchDiff(workspacePath: string, branch: string): Promise<BranchDiff> {
  const mergeBase = await git(workspacePath, ['merge-base', 'HEAD', branch]).catch(() => 'HEAD')
  const stat = await git(workspacePath, ['diff', '--numstat', `${mergeBase}...${branch}`]).catch(() => '')

  // Parse numstat lines: "<added>\t<removed>\t<path>"
  const files: BranchDiff['files'] = []
  let totalAdded = 0
  let totalRemoved = 0
  for (const line of stat.split('\n')) {
    const parts = line.split('\t')
    if (parts.length < 3) continue
    const added = parseInt(parts[0], 10) || 0
    const removed = parseInt(parts[1], 10) || 0
    const relPath = parts.slice(2).join('\t')
    totalAdded += added
    totalRemoved += removed
    // Fetch per-file diff (unified, 3 lines context — default)
    const fileDiff = await git(workspacePath, ['diff', `${mergeBase}...${branch}`, '--', relPath]).catch(() => '')
    files.push({ path: relPath, addedLines: added, removedLines: removed, diff: fileDiff })
  }
  return { files, totalAdded, totalRemoved }
}
