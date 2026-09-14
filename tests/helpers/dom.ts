// DOM harness for component tests run under `node --test`.
//
// Import this FIRST in any component test — the registrator has to install the
// browser globals before React (or anything touching `document`) is evaluated,
// and ESM evaluates imported modules in declaration order:
//
//   import { stubVibe } from './helpers/dom'
//   import MergePanel from '../src/components/MergePanel'
//
// It also installs a `window.vibe` stub, since every component reaches for the
// preload bridge. Use `stubVibe()` per test to swap in the calls you care about.

import { GlobalRegistrator } from '@happy-dom/global-registrator'

if (!globalThis.document) {
  GlobalRegistrator.register({ url: 'http://localhost/' })
}

// React 18's act() support checks this flag.
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

type AnyFn = (...args: never[]) => unknown

/**
 * Install a partial `window.vibe`. Deep-merges one level so a test can override
 * just `agents.merge` without restating the rest of the bridge. Returns a
 * restore function; call it in a test's `finally`.
 */
export function stubVibe(partial: Record<string, Record<string, AnyFn>>): () => void {
  const w = globalThis as unknown as { vibe?: unknown }
  const previous = w.vibe
  const base: Record<string, Record<string, AnyFn>> = {
    tasks: { create: async () => ({}) },
    agents: {
      checkOverlap: async () => ({ own: [], overlaps: {} }),
      merge: async () => ({ ok: true, conflicts: [], output: '' }),
      previewDiff: async () => ({ files: [], totalAdded: 0, totalRemoved: 0 }),
      resolveConflicts: async () => ({ files: [] }),
      acceptResolution: async () => undefined,
      abortMerge: async () => undefined
    },
    config: { get: async () => ({}), set: async () => undefined }
  }
  for (const [ns, fns] of Object.entries(partial)) {
    base[ns] = { ...(base[ns] ?? {}), ...fns }
  }
  w.vibe = base
  return () => { w.vibe = previous }
}

/** Records every call to a stubbed bridge method, for assertions. */
export function spy<T>(result: T): ((...args: unknown[]) => Promise<T>) & { calls: unknown[][] } {
  const calls: unknown[][] = []
  const fn = async (...args: unknown[]) => { calls.push(args); return result }
  return Object.assign(fn, { calls })
}
