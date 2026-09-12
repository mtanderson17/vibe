// Workspace file explorer: list dirs lazily, read/write files.
// All paths are workspace-relative on the wire; main resolves against
// the current workspace and refuses anything that escapes.

import { readdir, readFile, writeFile, stat, mkdir } from 'node:fs/promises'
import path from 'node:path'

const IGNORED = new Set([
  'node_modules', '.git', '.vibe', '.venv', 'venv', '__pycache__',
  'dist', 'build', 'out', '.next', '.cache', '.turbo', '.parcel-cache',
  'target', '.gradle', '.idea', '.vscode-test', '.DS_Store'
])

export interface FileEntry {
  name: string
  path: string        // workspace-relative, forward-slash normalized
  kind: 'file' | 'dir'
  size?: number       // only for files
}

function resolveInside(root: string, rel: string): string {
  const clean = rel.replace(/^[/\\]+/, '')
  const abs = path.resolve(root, clean)
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error(`Path escapes workspace: ${rel}`)
  }
  return abs
}

function toPosix(p: string): string { return p.split(path.sep).join('/') }

export async function listDir(workspaceRoot: string, relPath: string): Promise<FileEntry[]> {
  const abs = resolveInside(workspaceRoot, relPath || '.')
  const entries = await readdir(abs, { withFileTypes: true })
  const out: FileEntry[] = []
  for (const e of entries) {
    if (IGNORED.has(e.name)) continue
    if (e.name.startsWith('.') && e.name !== '.gitignore' && e.name !== '.env.example') continue
    const rel = toPosix(path.relative(workspaceRoot, path.join(abs, e.name)))
    if (e.isDirectory()) {
      out.push({ name: e.name, path: rel, kind: 'dir' })
    } else if (e.isFile()) {
      let size: number | undefined
      try { size = (await stat(path.join(abs, e.name))).size } catch { /* ignore */ }
      out.push({ name: e.name, path: rel, kind: 'file', size })
    }
  }
  // dirs first, then files, each alphabetized
  out.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return out
}

const MAX_READ_BYTES = 4 * 1024 * 1024  // 4 MB — Monaco struggles above this
const BINARY_SNIFF_BYTES = 8000

// Very rough: if the first 8kb contain a NUL byte, treat as binary.
function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, BINARY_SNIFF_BYTES)
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true
  return false
}

export interface ReadFileResult {
  content: string
  truncated: boolean
  binary: boolean
  size: number
}

export async function readWorkspaceFile(workspaceRoot: string, relPath: string): Promise<ReadFileResult> {
  const abs = resolveInside(workspaceRoot, relPath)
  const s = await stat(abs)
  if (!s.isFile()) throw new Error(`Not a file: ${relPath}`)
  const buf = await readFile(abs)
  const binary = looksBinary(buf)
  if (binary) {
    return { content: '', truncated: false, binary: true, size: s.size }
  }
  const truncated = buf.length > MAX_READ_BYTES
  const sliced = truncated ? buf.subarray(0, MAX_READ_BYTES) : buf
  return { content: sliced.toString('utf8'), truncated, binary: false, size: s.size }
}

export async function writeWorkspaceFile(workspaceRoot: string, relPath: string, content: string): Promise<void> {
  const abs = resolveInside(workspaceRoot, relPath)
  await mkdir(path.dirname(abs), { recursive: true })
  await writeFile(abs, content, 'utf8')
}

export async function mkdirWorkspace(workspaceRoot: string, relPath: string): Promise<void> {
  const abs = resolveInside(workspaceRoot, relPath)
  await mkdir(abs, { recursive: true })
}
