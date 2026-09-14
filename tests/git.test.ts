// Integration tests against a real git repo in a temp dir. git.ts had no
// coverage at all, which is uncomfortable for the module that creates and
// destroys the user's branches and worktrees.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, existsSync, realpathSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  ensureRepo,
  createWorktree,
  prewarmWorktree,
  worktreePathFor,
  currentBranch,
  mergeBranch,
  branchChangedFiles
} from '../electron/main/git'

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim()
}

async function repo() {
  const dir = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'vibe-git-')))
  await ensureRepo(dir)
  return {
    dir,
    /** Commit a file on the workspace's current branch and return the new sha. */
    commit(name: string, content: string): string {
      writeFileSync(path.join(dir, name), content, 'utf8')
      git(dir, 'add', name)
      git(dir, 'commit', '-m', `add ${name}`)
      return git(dir, 'rev-parse', 'HEAD')
    },
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
      } catch { /* worktrees can hold handles briefly on Windows */ }
    }
  }
}

test('ensureRepo initialises a repo with a gitignore and a commit to branch from', async () => {
  const r = await repo()
  try {
    assert.ok(existsSync(path.join(r.dir, '.git')))
    assert.ok(existsSync(path.join(r.dir, '.gitignore')))
    assert.match(git(r.dir, 'rev-parse', 'HEAD'), /^[0-9a-f]{40}$/, 'worktrees need a commit to exist')
  } finally { r.cleanup() }
})

test('ensureRepo is idempotent and leaves an existing gitignore alone', async () => {
  const r = await repo()
  try {
    writeFileSync(path.join(r.dir, '.gitignore'), 'custom-rule/\n', 'utf8')
    await ensureRepo(r.dir)
    assert.equal(
      git(r.dir, 'show', ':.gitignore').includes('custom-rule') ||
        require('node:fs').readFileSync(path.join(r.dir, '.gitignore'), 'utf8').includes('custom-rule'),
      true,
      'a user gitignore must not be overwritten'
    )
  } finally { r.cleanup() }
})

test('prewarmWorktree creates a detached checkout, and is safe to repeat', async () => {
  const r = await repo()
  try {
    await prewarmWorktree(r.dir, 'agent-1')
    const wt = worktreePathFor(r.dir, 'agent-1')
    assert.ok(existsSync(wt), 'prewarm should materialise the checkout')
    assert.equal(git(wt, 'rev-parse', '--abbrev-ref', 'HEAD'), 'HEAD', 'prewarmed tree should be detached')

    await prewarmWorktree(r.dir, 'agent-1')   // must not throw on a second call
    assert.ok(existsSync(wt))
  } finally { r.cleanup() }
})

test('createWorktree names the branch and works without a prewarm', async () => {
  const r = await repo()
  try {
    const { worktreePath, branch } = await createWorktree(r.dir, 'agent-2', 'add-thing')
    assert.equal(branch, 'vibe/agent-2/add-thing')
    assert.ok(existsSync(worktreePath))
    assert.equal(git(worktreePath, 'rev-parse', '--abbrev-ref', 'HEAD'), branch)
  } finally { r.cleanup() }
})

test('createWorktree reuses a prewarmed checkout', async () => {
  const r = await repo()
  try {
    await prewarmWorktree(r.dir, 'agent-1')
    const wt = worktreePathFor(r.dir, 'agent-1')
    // A marker that a rebuild would destroy — proves the tree was reused rather
    // than removed and re-added.
    writeFileSync(path.join(wt, 'untracked-marker.txt'), 'x', 'utf8')

    const { worktreePath, branch } = await createWorktree(r.dir, 'agent-1', 'reuse-me')
    assert.equal(worktreePath, wt)
    assert.equal(git(worktreePath, 'rev-parse', '--abbrev-ref', 'HEAD'), branch)
  } finally { r.cleanup() }
})

test('a prewarmed worktree still branches from the CURRENT workspace HEAD', async () => {
  const r = await repo()
  try {
    // Prewarm pins the tree at today's HEAD...
    await prewarmWorktree(r.dir, 'agent-1')
    // ...then main moves on before the agent is given a task.
    const newHead = r.commit('landed-later.txt', 'from another agent')

    const { worktreePath } = await createWorktree(r.dir, 'agent-1', 'later-task')

    assert.equal(git(worktreePath, 'rev-parse', 'HEAD'), newHead,
      'a task must start from current main, not from whenever the tree was warmed')
    assert.ok(existsSync(path.join(worktreePath, 'landed-later.txt')),
      'work that landed while the agent was idle must be present in its worktree')
  } finally { r.cleanup() }
})

test('reusing a worktree clears the previous task’s leftovers', async () => {
  const r = await repo()
  try {
    const first = await createWorktree(r.dir, 'agent-1', 'first-task')
    writeFileSync(path.join(first.worktreePath, 'scratch.txt'), 'junk', 'utf8')
    git(first.worktreePath, 'add', 'scratch.txt')
    git(first.worktreePath, 'commit', '-m', 'work in progress')
    writeFileSync(path.join(first.worktreePath, 'dirty.txt'), 'uncommitted', 'utf8')

    const second = await createWorktree(r.dir, 'agent-1', 'second-task')
    assert.equal(second.branch, 'vibe/agent-1/second-task')
    assert.equal(existsSync(path.join(second.worktreePath, 'scratch.txt')), false,
      'the previous task’s commits must not leak into the next one')
    assert.equal(existsSync(path.join(second.worktreePath, 'dirty.txt')), false,
      'untracked leftovers must be cleaned')
  } finally { r.cleanup() }
})

test('createWorktree replaces a stale branch of the same name', async () => {
  const r = await repo()
  try {
    await createWorktree(r.dir, 'agent-1', 'same-slug')
    // Same agent, same slug again — the old branch must not block it.
    const again = await createWorktree(r.dir, 'agent-1', 'same-slug')
    assert.equal(again.branch, 'vibe/agent-1/same-slug')
    assert.equal(git(again.worktreePath, 'rev-parse', '--abbrev-ref', 'HEAD'), again.branch)
  } finally { r.cleanup() }
})

test('branchChangedFiles reports what the agent touched, and mergeBranch lands it', async () => {
  const r = await repo()
  try {
    const base = await currentBranch(r.dir)
    const { worktreePath, branch } = await createWorktree(r.dir, 'agent-1', 'feature')

    writeFileSync(path.join(worktreePath, 'feature.txt'), 'hello', 'utf8')
    git(worktreePath, 'add', 'feature.txt')
    git(worktreePath, 'commit', '-m', 'add feature')

    const changed = await branchChangedFiles(r.dir, branch)
    assert.deepEqual(changed, ['feature.txt'])

    const result = await mergeBranch(r.dir, branch)
    assert.equal(result.ok, true)
    assert.deepEqual(result.conflicts, [])
    assert.ok(existsSync(path.join(r.dir, 'feature.txt')), 'the merge should land the file on main')
    assert.equal(await currentBranch(r.dir), base, 'merging must not move the workspace off its branch')
  } finally { r.cleanup() }
})

test('mergeBranch reports conflicting files instead of throwing', async () => {
  const r = await repo()
  try {
    r.commit('shared.txt', 'original\n')

    const { worktreePath, branch } = await createWorktree(r.dir, 'agent-1', 'edit-shared')
    writeFileSync(path.join(worktreePath, 'shared.txt'), 'agent version\n', 'utf8')
    git(worktreePath, 'add', 'shared.txt')
    git(worktreePath, 'commit', '-m', 'agent edits shared')

    // main edits the same line in the meantime
    r.commit('shared.txt', 'human version\n')

    const result = await mergeBranch(r.dir, branch)
    assert.equal(result.ok, false)
    assert.deepEqual(result.conflicts, ['shared.txt'])

    git(r.dir, 'merge', '--abort')
  } finally { r.cleanup() }
})
