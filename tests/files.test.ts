import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  resolveInside,
  looksBinary,
  listDir,
  readWorkspaceFile,
  writeWorkspaceFile,
  mkdirWorkspace
} from '../electron/main/files'

// --- resolveInside: path-escape guard ---

test('resolveInside: accepts a plain relative path', () => {
  const root = path.resolve('/tmp/workspace')
  const abs = resolveInside(root, 'src/index.ts')
  assert.equal(abs, path.resolve(root, 'src/index.ts'))
})

test('resolveInside: strips leading slashes so absolute-looking rels stay inside', () => {
  const root = path.resolve('/tmp/workspace')
  const abs = resolveInside(root, '/absolute/looking/path.ts')
  assert.equal(abs, path.resolve(root, 'absolute/looking/path.ts'))
})

test('resolveInside: strips leading backslashes too (Windows-style)', () => {
  const root = path.resolve('/tmp/workspace')
  const abs = resolveInside(root, '\\also\\rooted.ts')
  assert.equal(abs, path.resolve(root, 'also/rooted.ts'))
})

test('resolveInside: rejects .. traversal', () => {
  const root = path.resolve('/tmp/workspace')
  assert.throws(() => resolveInside(root, '../outside.ts'), /escapes workspace/)
})

test('resolveInside: rejects nested .. that lands outside', () => {
  const root = path.resolve('/tmp/workspace')
  assert.throws(() => resolveInside(root, 'a/b/../../../outside.ts'), /escapes workspace/)
})

test('resolveInside: allows .. that lands back inside', () => {
  const root = path.resolve('/tmp/workspace')
  // src/../lib/x → lib/x — still inside
  const abs = resolveInside(root, 'src/../lib/x.ts')
  assert.equal(abs, path.resolve(root, 'lib/x.ts'))
})

test('resolveInside: workspace root itself resolves to root (edge case)', () => {
  const root = path.resolve('/tmp/workspace')
  assert.equal(resolveInside(root, '.'), root)
})

test('resolveInside: rejects a sibling directory that shares a prefix', () => {
  // /tmp/workspace vs /tmp/workspace-evil — the second must NOT be considered "inside"
  const root = path.resolve('/tmp/workspace')
  assert.throws(() => resolveInside(root, '../workspace-evil/x.ts'), /escapes workspace/)
})

// --- looksBinary ---

test('looksBinary: buffer with no NUL bytes → text', () => {
  const buf = Buffer.from('hello world\nsecond line\n', 'utf8')
  assert.equal(looksBinary(buf), false)
})

test('looksBinary: empty buffer → text', () => {
  assert.equal(looksBinary(Buffer.alloc(0)), false)
})

test('looksBinary: NUL byte at start → binary', () => {
  const buf = Buffer.from([0, 0x48, 0x69])
  assert.equal(looksBinary(buf), true)
})

test('looksBinary: NUL byte at the last sniffed position (7999) → binary', () => {
  const buf = Buffer.alloc(8000, 0x41)  // 'A' repeated
  buf[7999] = 0
  assert.equal(looksBinary(buf), true)
})

test('looksBinary: NUL byte just past sniff window (position 8000) → text (miss)', () => {
  // Documenting the current heuristic: we only look at first 8000 bytes.
  // This test guards against accidental widening of the sniff window.
  const buf = Buffer.alloc(8001, 0x41)
  buf[8000] = 0
  assert.equal(looksBinary(buf), false)
})

test('looksBinary: UTF-8 BOM (no NUL) → text', () => {
  const buf = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from('hello', 'utf8')])
  assert.equal(looksBinary(buf), false)
})

// --- listDir / read / write / mkdir integration ---

async function makeTempWorkspace(): Promise<string> {
  const root = path.join(tmpdir(), `vibe-files-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  await mkdir(root, { recursive: true })
  return root
}

test('listDir: returns files + directories, dirs-first alphabetized', async () => {
  const root = await makeTempWorkspace()
  try {
    await writeFile(path.join(root, 'z-file.txt'), 'x')
    await writeFile(path.join(root, 'a-file.txt'), 'x')
    await mkdir(path.join(root, 'z-dir'))
    await mkdir(path.join(root, 'a-dir'))

    const entries = await listDir(root, '.')
    const names = entries.map(e => `${e.kind}:${e.name}`)
    assert.deepEqual(names, ['dir:a-dir', 'dir:z-dir', 'file:a-file.txt', 'file:z-file.txt'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('listDir: ignores node_modules, .git, .vibe, etc.', async () => {
  const root = await makeTempWorkspace()
  try {
    await mkdir(path.join(root, 'node_modules'))
    await mkdir(path.join(root, '.git'))
    await mkdir(path.join(root, '.vibe'))
    await mkdir(path.join(root, '__pycache__'))
    await mkdir(path.join(root, 'kept'))
    const entries = await listDir(root, '.')
    assert.deepEqual(entries.map(e => e.name), ['kept'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('listDir: hides dotfiles by default, keeps .gitignore + .env.example', async () => {
  const root = await makeTempWorkspace()
  try {
    await writeFile(path.join(root, '.hidden'), 'x')
    await writeFile(path.join(root, '.gitignore'), 'x')
    await writeFile(path.join(root, '.env.example'), 'x')
    const entries = await listDir(root, '.')
    const names = entries.map(e => e.name).sort()
    assert.deepEqual(names, ['.env.example', '.gitignore'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('readWorkspaceFile: reads text content', async () => {
  const root = await makeTempWorkspace()
  try {
    await writeFile(path.join(root, 'hello.txt'), 'hello world', 'utf8')
    const res = await readWorkspaceFile(root, 'hello.txt')
    assert.equal(res.content, 'hello world')
    assert.equal(res.binary, false)
    assert.equal(res.truncated, false)
    assert.equal(res.size, 11)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('readWorkspaceFile: flags binary files (returns empty content)', async () => {
  const root = await makeTempWorkspace()
  try {
    const bin = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x00, 0x00, 0x00, 0x0D])  // PNG-ish
    await writeFile(path.join(root, 'img.png'), bin)
    const res = await readWorkspaceFile(root, 'img.png')
    assert.equal(res.binary, true)
    assert.equal(res.content, '')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('readWorkspaceFile: truncates files above 4 MB and flags truncated=true', async () => {
  const root = await makeTempWorkspace()
  try {
    // 4 MB + 100 bytes — the cap in files.ts is exactly 4 * 1024 * 1024.
    const oversize = Buffer.alloc(4 * 1024 * 1024 + 100, 0x41)
    await writeFile(path.join(root, 'big.txt'), oversize)
    const res = await readWorkspaceFile(root, 'big.txt')
    assert.equal(res.truncated, true)
    assert.equal(res.content.length, 4 * 1024 * 1024)
    assert.equal(res.size, 4 * 1024 * 1024 + 100)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('readWorkspaceFile: rejects reads that escape the workspace', async () => {
  const root = await makeTempWorkspace()
  try {
    await assert.rejects(() => readWorkspaceFile(root, '../secret'), /escapes workspace/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('writeWorkspaceFile: creates missing parent directories', async () => {
  const root = await makeTempWorkspace()
  try {
    await writeWorkspaceFile(root, 'a/b/c/nested.txt', 'ok')
    const res = await readWorkspaceFile(root, 'a/b/c/nested.txt')
    assert.equal(res.content, 'ok')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('writeWorkspaceFile: rejects writes that escape the workspace', async () => {
  const root = await makeTempWorkspace()
  try {
    await assert.rejects(() => writeWorkspaceFile(root, '../evil.txt', 'x'), /escapes workspace/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('mkdirWorkspace: creates a nested directory tree', async () => {
  const root = await makeTempWorkspace()
  try {
    await mkdirWorkspace(root, 'a/b/c')
    const entries = await listDir(root, 'a/b')
    assert.deepEqual(entries.map(e => e.name), ['c'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
