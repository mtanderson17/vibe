// Settings → Workspace. Project folder, agent/step budgets, submit behavior.
// Purely controlled — Setup owns the draft state and the save.

interface Props {
  workspace: string
  setWorkspace: (v: string) => void
  onPickWorkspace: () => void
  agentCount: number
  setAgentCount: (v: number) => void
  maxSteps: number
  setMaxSteps: (v: number) => void
  submitOnEnter: boolean
  setSubmitOnEnter: (v: boolean) => void
}

export default function WorkspaceTab({
  workspace, setWorkspace, onPickWorkspace,
  agentCount, setAgentCount, maxSteps, setMaxSteps,
  submitOnEnter, setSubmitOnEnter
}: Props) {
  return (
    <section className="settings-section">
      <div className="settings-section-title">Workspace</div>
      <div className="settings-section-body">
        <div className="settings-field">
          <label>Project folder</label>
          <div className="row-inline">
            <input
              value={workspace}
              onChange={e => setWorkspace(e.target.value)}
              placeholder="C:\path\to\your\project"
            />
            <button onClick={onPickWorkspace}>Browse…</button>
          </div>
          <p className="hint">A git repo (with a sensible <code>.gitignore</code>) will be initialized here if one doesn't exist.</p>
        </div>

        <div className="settings-field">
          <label>Concurrent agents (1–8)</label>
          <input
            type="number"
            min={1}
            max={8}
            value={agentCount}
            onChange={e => setAgentCount(parseInt(e.target.value) || 1)}
            style={{ width: 100 }}
          />
          <p className="hint">More agents = more parallelism, more RAM, more API load.</p>
        </div>

        <div className="settings-field">
          <label>Steps per agent turn budget (5–200)</label>
          <input
            type="number"
            min={5}
            max={200}
            value={maxSteps}
            onChange={e => setMaxSteps(parseInt(e.target.value) || 25)}
            style={{ width: 100 }}
          />
          <p className="hint">
            Max tool-call turns before an agent pauses for user input. Hitting the limit shows a
            Continue button — click to add another {maxSteps} steps of runway.
          </p>
        </div>

        <div className="settings-field">
          <label>Submit behavior</label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginTop: 4 }}>
            <input
              type="checkbox"
              checked={submitOnEnter}
              onChange={e => setSubmitOnEnter(e.target.checked)}
            />
            <span>Press Enter to send (Shift+Enter for newline)</span>
          </label>
          <p className="hint">
            Applies to agent chat, PM chat, and task descriptions. If off, Enter adds a newline and
            Cmd/Ctrl+Enter sends — better for long multi-line prompts.
          </p>
        </div>
      </div>
    </section>
  )
}
