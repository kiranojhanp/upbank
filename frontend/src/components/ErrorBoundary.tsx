import { Component, type ErrorInfo, type ReactNode } from 'react'
import { clearAllLocalData } from '../persistence'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  failed: boolean
  detail: string | null
}

/**
 * Last line of defence for a render/lifecycle crash. It offers a plain reload
 * and a "clear local data" escape hatch for a corrupt cache or a bad deploy.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false, detail: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { failed: true, detail: error.message || 'Unknown render error' }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Do not log component props or transaction data, only the failure shape.
    console.error('[app] render failed:', error.name, error.message, info.componentStack)
  }

  private reload = (): void => {
    window.location.reload()
  }

  private clearAndReload = async (): Promise<void> => {
    try {
      await clearAllLocalData()
    } finally {
      window.location.reload()
    }
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children

    return (
      <div className="boot-screen error-screen">
        <p className="login-error">The app hit an unexpected error.</p>
        {this.state.detail && <p className="transactions-error-detail">{this.state.detail}</p>}
        <div className="error-actions">
          <button type="button" className="login-btn" onClick={this.reload}>
            Reload
          </button>
          <button
            type="button"
            className="load-more-btn"
            onClick={() => void this.clearAndReload()}
          >
            Clear local data and reload
          </button>
        </div>
      </div>
    )
  }
}
