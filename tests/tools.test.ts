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
    assert.match(result, /\[truncated\]/)
  } finally { cleanup() }
})
