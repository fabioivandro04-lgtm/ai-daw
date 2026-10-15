import { Component, type ReactNode } from 'react'

/** Shows the error instead of a black screen, with a way out if the saved project is the cause. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="crash" role="alert">
        <h2>Something went wrong</h2>
        <pre>{error.message}</pre>
        <p>Your project is saved. Try reloading first. If it keeps happening, reset the project (your API key is kept).</p>
        <div className="modal-buttons">
          <button onClick={() => location.reload()}>Reload</button>
          <button
            className="primary"
            onClick={() => {
              localStorage.removeItem('ai-daw:project')
              location.reload()
            }}
          >
            Reset project
          </button>
        </div>
      </div>
    )
  }
}
