import { Component, type ComponentType, type ErrorInfo, type ReactNode } from "react"
import { useNavigate } from "react-router-dom"

// ---------------------------------------------------------------------------
// ErrorBoundary (class component — hooks cannot catch render errors)
// ---------------------------------------------------------------------------

interface ErrorBoundaryProps {
  children: ReactNode
  /** Render function receives the caught error and a reset callback. */
  fallback: (error: Error, reset: () => void) => ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack)
  }

  reset = () => {
    this.setState({ error: null })
  }

  render() {
    if (this.state.error) {
      return this.props.fallback(this.state.error, this.reset)
    }
    return this.props.children
  }
}

// ---------------------------------------------------------------------------
// App-level fallback — full-screen, no navigation available
// ---------------------------------------------------------------------------

export function AppCrashFallback(_props: { error: Error; reset: () => void }) {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 bg-base px-6 text-center">
      <div className="text-4xl">:(</div>
      <h1 className="text-lg font-semibold text-fg">应用发生了意外错误</h1>
      <p className="max-w-md text-sm text-fg-4">
        页面遇到了无法恢复的问题。请刷新页面重试，如果问题持续出现请联系管理员。
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
      >
        刷新页面
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page-level fallback — inside Layout, sidebar still works
// ---------------------------------------------------------------------------

function PageCrashFallbackInner({ error, reset }: { error: Error; reset: () => void }) {
  const navigate = useNavigate()

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="text-3xl">:/</div>
      <h2 className="text-base font-semibold text-fg">当前页面加载失败</h2>
      <p className="max-w-md text-sm text-fg-4">
        该页面发生渲染错误，但你可以继续使用侧边栏导航到其他页面。
      </p>
      {import.meta.env.DEV && (
        <pre className="max-h-40 max-w-lg overflow-auto rounded-md bg-elevated p-3 text-left text-xs text-fg-3">
          {error.message}
        </pre>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={reset}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          重试
        </button>
        <button
          type="button"
          onClick={() => navigate("/repos")}
          className="rounded-md border border-line px-4 py-2 text-sm font-medium text-fg-3 hover:bg-elevated"
        >
          返回首页
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// guarded() — wraps a page component with a route-level ErrorBoundary
// ---------------------------------------------------------------------------

export function guarded(Page: ComponentType) {
  return (
    <ErrorBoundary fallback={(error, reset) => <PageCrashFallbackInner error={error} reset={reset} />}>
      <Page />
    </ErrorBoundary>
  )
}
