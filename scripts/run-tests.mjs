// Test entry point. Collects test files itself and hands node explicit paths.
//
// Why not just `node --test "tests/**/*.test.ts"`: that glob has to be expanded
// by *something*, and nothing expands it consistently.
//   - POSIX sh expands it before node sees it, but `**` behaves like `*`
//     without globstar, so it silently matches a different set of files.
//   - GitHub's Windows runner uses pwsh, which doesn't expand it at all.
//   - node expands it only on v22+; on v20 it fails with "Could not find".
// Walking the directory ourselves is deterministic on every platform and
// every supported node version.
//
// Extra args are forwarded, so `npm test -- --test-name-pattern=merge` works.

import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const testsDir = path.join(repoRoot, 'tests')

function collect(dir) {
  const found = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      found.push(...collect(full))
    } else if (/\.test\.tsx?$/.test(entry.name)) {
      found.push(full)
    }
  }
  return found
}

const files = collect(testsDir).sort()

if (files.length === 0) {
  console.error(`No test files found under ${testsDir}`)
  process.exit(1)
}

const result = spawnSync(
  process.execPath,
  ['--import', 'tsx', '--test', ...process.argv.slice(2), ...files],
  { stdio: 'inherit', cwd: repoRoot }
)

process.exit(result.status ?? 1)
