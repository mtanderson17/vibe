import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  ensureContextFile,
  readContext,
  writeContext,
  readAgentsGuide,
  readSummary,
  writeSummary,
  DEFAULT_AGENTS_MD
} from '../electron/main/context'

function scratch() {
  const dir = mkdtempSync(path.join(tmpdir(), 'vibe-ctx-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

test('ensureContextFile seeds project.md and workspace AGENTS.md if missing', async () => {
  const { dir, cleanup } = scratch()
  try {
    const p = await ensureContextFile(dir)
    assert.equal(p, path.join(dir, '.vibe', 'context', 'project.md'))
    const content = readFileSync(p, 'utf8')
    assert.match(content, /# Project Context/)
    // Also seeds the workspace-level AGENTS.md
    const agentsMd = readFileSync(path.join(dir, '.vibe', 'AGENTS.md'), 'utf8')
    assert.match(agentsMd, /# How Vibe Works/)
  } finally { cleanup() }
})

test('writeContext + readContext roundtrip', async () => {
  const { dir, cleanup } = scratch()
  try {
    await writeContext(dir, '# My Project\nStack: Rust')
    const got = await readContext(dir)
    assert.equal(got, '# My Project\nStack: Rust')
  } finally { cleanup() }
})

test('readAgentsGuide returns bundled default when no override exists', async () => {
  const { dir, cleanup } = scratch()
  try {
    const guide = await readAgentsGuide(dir)
    assert.equal(guide, DEFAULT_AGENTS_MD)
  } finally { cleanup() }
})

test('writeSummary + readSummary roundtrip', async () => {
  const { dir, cleanup } = scratch()
  try {
    await writeSummary(dir, '## State\nAll good.')
    const got = await readSummary(dir)
    assert.equal(got, '## State\nAll good.')
  } finally { cleanup() }
})

test('readSummary seeds default if missing', async () => {
  const { dir, cleanup } = scratch()
  try {
    const got = await readSummary(dir)
    assert.match(got, /# Project Summary/)
  } finally { cleanup() }
})
