import { useState } from 'react'

export interface FileDiff {
  path: string
  addedLines: number
  removedLines: number
  diff: string
}

interface Props {
  files: FileDiff[]
  totalAdded: number
  totalRemoved: number
}

export default function DiffView({ files, totalAdded, totalRemoved }: Props) {
  if (files.length === 0) {
    return (
      <div style={{ padding: 16, color: 'var(--fg-dim)', fontSize: 12 }}>
        (no changes on this branch — nothing to preview)
      </div>
    )
  }

  return (
    <div className="diff-view">
      <div className="diff-summary">
        <span>{files.length} file{files.length !== 1 ? 's' : ''} changed</span>
        <span className="diff-added">+{totalAdded}</span>
        <span className="diff-removed">−{totalRemoved}</span>
      </div>
      {files.map(f => <FileDiffBlock key={f.path} file={f} />)}
    </div>
  )
}

function FileDiffBlock({ file }: { file: FileDiff }) {
  const [expanded, setExpanded] = useState(file.addedLines + file.removedLines <= 200)

  return (
    <div className="diff-file">
      <div className="diff-file-header" onClick={() => setExpanded(!expanded)}>
        <span>{expanded ? '▼' : '▶'}</span>
        <span style={{ fontFamily: 'monospace', flex: 1 }}>{file.path}</span>
        <span className="diff-added">+{file.addedLines}</span>
        <span className="diff-removed">−{file.removedLines}</span>
      </div>
      {expanded && (
        <pre className="diff-body">{renderDiff(file.diff)}</pre>
      )}
    </div>
  )
}

function renderDiff(raw: string): React.ReactNode {
  return raw.split('\n').map((line, i) => {
    let cls = 'diff-line'
    if (line.startsWith('+') && !line.startsWith('+++')) cls += ' diff-line-add'
    else if (line.startsWith('-') && !line.startsWith('---')) cls += ' diff-line-del'
    else if (line.startsWith('@@')) cls += ' diff-line-hunk'
    else if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('+++') || line.startsWith('---')) cls += ' diff-line-meta'
    return <div key={i} className={cls}>{line || ' '}</div>
  })
}
