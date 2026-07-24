import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'

interface Props {
  children: ReactNode
  /** Optional context shown in the fallback (e.g. the section name). */
  label?: string
}

interface State {
  error: Error | null
}

/**
 * Catches render/lifecycle errors in its subtree and shows a recoverable
 * fallback instead of unmounting the whole app to a blank screen. Error
 * boundaries must be class components (no hook equivalent).
 *
 * Used twice: once around the whole app (catastrophic catch-all) and once around
 * the routed content inside Layout, keyed by pathname so navigating away clears
 * a crashed screen while the nav chrome stays usable.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface for debugging; a real backend logger can hook in here later.
    console.error('[ErrorBoundary]', this.props.label ?? '', error, info.componentStack)
  }

  reset = () => this.setState({ error: null })

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="grid min-h-[60vh] place-items-center p-8 text-center">
        <div className="max-w-md">
          <AlertTriangle className="mx-auto mb-3 text-amber-500" size={36} />
          <h2 className="text-lg font-bold text-slate-800">Something went wrong</h2>
          <p className="mt-1 text-sm text-slate-500">
            {this.props.label ? `The ${this.props.label} view hit an error.` : 'This view hit an error.'} You can
            try again or reload the app.
          </p>
          <pre className="mt-3 max-h-40 overflow-auto rounded-lg bg-slate-100 p-3 text-left text-xs text-slate-600">
            {error.message}
          </pre>
          <div className="mt-4 flex justify-center gap-2">
            <button className="btn-ghost" onClick={this.reset}>
              Try again
            </button>
            <button className="btn-primary" onClick={() => window.location.reload()}>
              Reload app
            </button>
          </div>
        </div>
      </div>
    )
  }
}
