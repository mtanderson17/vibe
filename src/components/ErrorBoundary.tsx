// Catches render errors from a subtree so a bug in one view (e.g. Monaco
// choking on a specific file) doesn't remount App and reset navigation.

import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  label?: string
  onReset?: () => void
}
interface State { error: Error | null }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State { return { error } }
  componentDidCatch(error: Error) {
    console.error(`[vibe] error in ${this.props.label ?? 'view'}:`, error)
  }

  reset = () => {
    this.setState({ error: null })
    this.props.onReset?.()
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div style={{ padding: 24, color: 'var(--fg)' }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Something went wrong in {this.props.label ?? 'this view'}</div>
        <pre style={{
          background: 'var(--bg-2)',
          padding: 12,
          borderRadius: 4,
          fontSize: 11,
          color: 'var(--red)',
          whiteSpace: 'pre-wrap',
          maxHeight: 200,
          overflow: 'auto'
        }}>{this.state.error.message}</pre>
        <button onClick={this.reset} style={{ marginTop: 12 }}>Try again</button>
      </div>
    )
  }
}
