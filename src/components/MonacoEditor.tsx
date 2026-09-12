// Thin wrapper around @monaco-editor/react that:
//   1. Bundles Monaco locally (no CDN fetch — required for Electron/offline).
//   2. Wires up language workers via Vite's ?worker imports.
//   3. Exposes just the props FilesView needs (value, language, onChange, save).
//
// All Monaco-specific plumbing should stay in this file so the rest of the app
// can treat the editor as a plain controlled component.

import { useEffect, useRef } from 'react'
import { Editor, loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import type * as MonacoNS from 'monaco-editor'

// Local worker registrations. Vite's ?worker suffix doesn't reliably resolve
// bare npm-package specifiers, so we route through tiny shim files under
// src/workers/ that just re-export monaco's worker entry points.
import editorWorker from '../workers/editor.worker.ts?worker'
import jsonWorker from '../workers/json.worker.ts?worker'
import cssWorker from '../workers/css.worker.ts?worker'
import htmlWorker from '../workers/html.worker.ts?worker'
import tsWorker from '../workers/ts.worker.ts?worker'

let installed = false
function installMonacoEnv() {
  if (installed) return
  installed = true
  ;(self as unknown as { MonacoEnvironment: { getWorker: (id: string, label: string) => Worker } }).MonacoEnvironment = {
    getWorker(_id, label) {
      if (label === 'json') return new jsonWorker()
      if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker()
      if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker()
      if (label === 'typescript' || label === 'javascript') return new tsWorker()
      return new editorWorker()
    }
  }
  loader.config({ monaco })
  // Vibe dark theme — matches --bg / --fg roughly. Registered once.
  monaco.editor.defineTheme('vibe-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#0f1115',
      'editor.foreground': '#d8dee9',
      'editorLineNumber.foreground': '#4c566a',
      'editorLineNumber.activeForeground': '#8898b0',
      'editor.selectionBackground': '#2a3140',
      'editorCursor.foreground': '#88c0d0',
      'editor.lineHighlightBackground': '#151922'
    }
  })
}

// Extension → Monaco language ID. Monaco has many more languages built-in;
// this is just the coarse mapping. Unknown extensions fall through to `plaintext`.
const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', swift: 'swift',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', cs: 'csharp',
  json: 'json', jsonc: 'json', yaml: 'yaml', yml: 'yaml', toml: 'ini', ini: 'ini',
  md: 'markdown', markdown: 'markdown',
  sh: 'shell', bash: 'shell', zsh: 'shell', ps1: 'powershell',
  sql: 'sql', html: 'html', htm: 'html', xml: 'xml', css: 'css', scss: 'scss', less: 'less',
  dockerfile: 'dockerfile', tf: 'hcl', hcl: 'hcl'
}
export function detectLanguage(pathOrName: string): string {
  const base = pathOrName.split('/').pop() ?? pathOrName
  if (base.toLowerCase() === 'dockerfile') return 'dockerfile'
  const ext = base.includes('.') ? base.slice(base.lastIndexOf('.') + 1).toLowerCase() : ''
  return EXT_TO_LANG[ext] ?? 'plaintext'
}

interface Props {
  value: string
  language: string
  readOnly?: boolean
  onChange?: (value: string) => void
  onSave?: () => void   // fired on Cmd/Ctrl+S — the parent decides whether to actually persist
}

export default function MonacoEditor({ value, language, readOnly, onChange, onSave }: Props) {
  installMonacoEnv()
  const editorRef = useRef<MonacoNS.editor.IStandaloneCodeEditor | null>(null)

  // Keep an up-to-date onSave in a ref so the Monaco keybinding always sees the latest.
  const onSaveRef = useRef(onSave)
  useEffect(() => { onSaveRef.current = onSave }, [onSave])

  function handleMount(ed: MonacoNS.editor.IStandaloneCodeEditor) {
    editorRef.current = ed
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      onSaveRef.current?.()
    })
  }

  return (
    <Editor
      value={value}
      language={language}
      theme="vibe-dark"
      onMount={handleMount}
      onChange={(v) => onChange?.(v ?? '')}
      options={{
        readOnly: readOnly ?? false,
        fontSize: 13,
        fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        smoothScrolling: true,
        tabSize: 2,
        renderWhitespace: 'selection',
        wordWrap: 'off',
        automaticLayout: true
      }}
    />
  )
}
