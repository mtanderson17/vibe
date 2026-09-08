import React, { useState } from 'react'

export interface ResolvedFile {
  path: string
  originalConflict: string
  resolved: string
}

export default function ResolvedFileView({ file }: { file: ResolvedFile }) {
  const [expanded, setExpanded] = useState(true)

  if (!file.resolved) {
    return (
      <div className="resolved-file unresolvable">
        <div className="resolved-file-header">
          ⨯ {file.path} <span style={{ opacity: 0.7 }}>(binary or unresolvable — manual review required)</span>
        </div>
      </div>
    )
  }

  return (
    <div className="resolved-file">
      <div className="resolved-file-header" onClick={() => setExpanded(!expanded)}>
        <span>{expanded ? '▼' : '▶'} ✓ {file.path}</span>
      </div>
      {expanded && (
        <div className="resolved-file-body">
          <div className="resolved-col">
            <div className="resolved-col-label">Original (with conflict markers)</div>
            <pre className="resolved-code conflict-markers">{annotateConflict(file.originalConflict)}</pre>
          </div>
          <div className="resolved-col">
            <div className="resolved-col-label">Resolved</div>
            <pre className="resolved-code resolved">{file.resolved}</pre>
          </div>
        </div>
      )}
    </div>
  )
}

function annotateConflict(text: string): React.ReactNode {
  return text.split('\n').map((line, i) => {
    let cls = ''
    if (line.startsWith('<<<<<<<')) cls = 'conflict-ours-marker'
    else if (line.startsWith('=======')) cls = 'conflict-sep-marker'
    else if (line.startsWith('>>>>>>>')) cls = 'conflict-theirs-marker'
    return <div key={i} className={cls}>{line || ' '}</div>
  })
}
