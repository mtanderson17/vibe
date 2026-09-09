import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { executeTool } from '../electron/main/tools'

function scratch() {
  const dir = mkdtempSync(path.join(tmpdir(), 'vibe-tools-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

test('read_file returns file contents', async () => {
  const { dir, cleanup } = scratch()
  try {
    writeFileSync(path.join(dir, 'hello.txt'), 'hi there')
    const result = await executeTool(dir, 'read_file', { path: 'hello.txt' })
    assert.equal(result, 'hi there')
  } finally { cleanup() }
})

test('read_file rejects paths that escape the worktree', async () => {
  const { dir, cleanup } = scratch()
  try {
    await assert.rejects(
      executeTool(dir, 'read_file', { path: '../../../etc/passwd' }),
      /escapes worktree/
    )
  } finally { cleanup() }
})

test('write_file creates directories as needed', async () => {
  const { dir, cleanup } = scratch()
  try {
    await executeTool(dir, 'write_file', { path: 'nested/deep/file.txt', content: 'yes' })
    const got = await executeTool(dir, 'read_file', { path: 'nested/deep/file.txt' })
    assert.equal(got, 'yes')
  } finally { cleanup() }
})

test('list_files returns directory contents', async () => {
  const { dir, cleanup } = scratch()
  try {
    writeFileSync(path.join(dir, 'a.txt'), 'a')
    writeFileSync(path.join(dir, 'b.txt'), 'bb')
    mkdirSync(path.join(dir, 'sub'))
    const result = await executeTool(dir, 'list_files', { path: '.' })
    assert.match(result, /a\.txt/)
    assert.match(result, /b\.txt/)
    assert.match(result, /sub/)
    assert.match(result, /dir\t/)
    assert.match(result, /file\t/)
  } finally { cleanup() }
})

test('list_files on empty dir returns "(empty)"', async () => {
  const { dir, cleanup } = scratch()
  try {
    const result = await executeTool(dir, 'list_files', { path: '.' })
    assert.equal(result, '(empty)')
  } finally { cleanup() }
})

test('finish returns confirmation string', async () => {
  const { dir, cleanup } = scratch()
  try {
    const result = await executeTool(dir, 'finish', { summary: 'shipped it' })
    assert.equal(result, 'Task finished: shipped it')
  } finally { cleanup() }
})

test('ask_human returns confirmation string', async () => {
  const { dir, cleanup } = scratch()
  try {
    const result = await executeTool(dir, 'ask_human', { question: 'which color?' })
    assert.match(result, /Question posted/)
  } finally { cleanup() }
})

test('unknown tool throws', async () => {
  const { dir, cleanup } = scratch()
  try {
    await assert.rejects(
      executeTool(dir, 'nonexistent_tool', {}),
      /Unknown tool/
    )
  } finally { cleanup() }
})

test('read_file truncates very large files', async () => {
  const { dir, cleanup } = scratch()
  try {
    const bigContent = 'x'.repeat(50_000)
    writeFileSync(path.join(dir, 'big.txt'), bigContent)
    const result = await executeTool(dir, 'read_file', { path: 'big.txt' })
    assert.ok(result.length < bigContent.length)
    assert.match(result, /\[truncated/)
  } finally { cleanup() }
})

// --- read_file with offset/limit paging ---

test('read_file: offset + limit returns numbered slice', async () => {
  const { dir, cleanup } = scratch()
  try {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n')
    writeFileSync(path.join(dir, 'file.txt'), lines)
    const result = await executeTool(dir, 'read_file', { path: 'file.txt', offset: 5, limit: 3 })
    assert.match(result, /5\tline 5/)
    assert.match(result, /6\tline 6/)
    assert.match(result, /7\tline 7/)
    assert.doesNotMatch(result, /line 4$/m)
    assert.doesNotMatch(result, /line 8/)
    assert.match(result, /\[\d+ more lines\]/)
  } finally { cleanup() }
})

// --- replace_in_file ---

test('replace_in_file: replaces unique string', async () => {
  const { dir, cleanup } = scratch()
  try {
    writeFileSync(path.join(dir, 'f.txt'), 'hello world\ngoodbye world')
    const result = await executeTool(dir, 'replace_in_file', {
      path: 'f.txt',
      edits: [{ search: 'hello', replace: 'hi' }]
    })
    assert.match(result, /Applied 1 edit/)
  } finally { cleanup() }
})

test('replace_in_file: fails when search matches multiple times without all:true', async () => {
  const { dir, cleanup } = scratch()
  try {
    writeFileSync(path.join(dir, 'f.txt'), 'foo\nfoo\nfoo')
    const result = await executeTool(dir, 'replace_in_file', {
      path: 'f.txt',
      edits: [{ search: 'foo', replace: 'bar' }]
    })
    assert.match(result, /\[error\].*appears 3 times/)
  } finally { cleanup() }
})

test('replace_in_file: all:true replaces every occurrence', async () => {
  const { dir, cleanup } = scratch()
  try {
    writeFileSync(path.join(dir, 'f.txt'), 'foo\nfoo\nfoo')
    const result = await executeTool(dir, 'replace_in_file', {
      path: 'f.txt',
      edits: [{ search: 'foo', replace: 'bar', all: true }]
    })
    assert.match(result, /Applied 1 edit/)
    assert.match(result, /3 occurrences replaced/)
  } finally { cleanup() }
})

test('replace_in_file: fails when search not found', async () => {
  const { dir, cleanup } = scratch()
  try {
    writeFileSync(path.join(dir, 'f.txt'), 'hello')
    const result = await executeTool(dir, 'replace_in_file', {
      path: 'f.txt',
      edits: [{ search: 'nope', replace: 'x' }]
    })
    assert.match(result, /\[error\].*not found/)
  } finally { cleanup() }
})

// --- todo_read / todo_write ---

test('todo_write + todo_read: roundtrip', async () => {
  const { dir, cleanup } = scratch()
  try {
    await executeTool(dir, 'todo_write', {
      todos: [
        { content: 'Read main.py', status: 'done' },
        { content: 'Add feature X', status: 'in_progress' },
        { content: 'Write tests', status: 'pending' }
      ]
    })
    const result = await executeTool(dir, 'todo_read', {})
    assert.match(result, /1\. \[done\] Read main\.py/)
    assert.match(result, /2\. \[in_progress\] Add feature X/)
    assert.match(result, /3\. \[pending\] Write tests/)
  } finally { cleanup() }
})

test('todo_read: fresh worktree returns placeholder', async () => {
  const { dir, cleanup } = scratch()
  try {
    const result = await executeTool(dir, 'todo_read', {})
    assert.match(result, /no todo list yet/)
  } finally { cleanup() }
})
