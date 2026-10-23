import { useCallback, useEffect, useState } from "react"
import { completePairing, getPairStatus, authenticateWithToken } from "../lib/api-client"
import { setAuthToken } from "../lib/config"
import { useAuthStore } from "../stores/auth-store"

type View = "landing" | "token-input" | "pairing"

export function AuthPage() {
  const [view, setView] = useState<View>("landing")
  const [token, setToken] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [pairChecking, setPairChecking] = useState(false)
  const setAuthenticated = useAuthStore((s) => s.setAuthenticated)

  const handleTokenSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (!token.trim()) return
      setError("")
      setLoading(true)
      try {
        const deviceName = detectDeviceName()
        const res = await authenticateWithToken(token.trim(), deviceName)
        if (res.ok || res.deviceId) {
          setAuthToken(token.trim())
          setAuthenticated()
        }
      } catch {
        setError("Token 无效，请检查后重试")
      } finally {
        setLoading(false)
      }
    },
    [token, setAuthenticated],
  )

  const handlePairCheck = useCallback(async () => {
    setPairChecking(true)
    try {
      const status = await getPairStatus()
      if (status.open) {
        setView("pairing")
      } else {
        setError("当前没有设备开启配对窗口。请在已认证的设备上点击「添加设备」。")
      }
    } catch {
      setError("无法连接服务器")
    } finally {
      setPairChecking(false)
    }
  }, [])

  return (
    <div className="flex min-h-screen items-center justify-center bg-base px-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-fg">Fourth Spark</h1>
          <p className="mt-2 text-sm text-fg-4">AI 编程助手管理平台</p>
        </div>

        {view === "landing" && (
          <div className="space-y-4 rounded-lg border border-line bg-elevated p-6">
            <h2 className="text-base font-semibold text-fg">需要认证</h2>
            <p className="text-sm text-fg-3">
              此服务已启用设备认证。你可以通过以下方式接入：
            </p>
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => setView("token-input")}
                className="w-full rounded-md border border-line px-4 py-2.5 text-left text-sm text-fg hover:bg-base"
              >
                <span className="font-medium">输入 Token</span>
                <span className="mt-0.5 block text-fg-4">从服务器终端获取 Token 手动输入</span>
              </button>
              <button
                type="button"
                onClick={handlePairCheck}
                disabled={pairChecking}
                className="w-full rounded-md border border-line px-4 py-2.5 text-left text-sm text-fg hover:bg-base disabled:opacity-50"
              >
                <span className="font-medium">设备配对</span>
                <span className="mt-0.5 block text-fg-4">从已认证的设备授权此设备</span>
              </button>
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <div className="border-t border-line pt-4">
              <p className="text-xs text-fg-5">
                首次使用？在服务器上运行 <code className="rounded bg-base px-1 py-0.5 font-mono">fourth-spark start</code> 启动时会自动打开已认证的浏览器。
              </p>
            </div>
          </div>
        )}

        {view === "token-input" && (
          <div className="space-y-4 rounded-lg border border-line bg-elevated p-6">
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => { setView("landing"); setError("") }} className="text-fg-4 hover:text-fg">
                ←
              </button>
              <h2 className="text-base font-semibold text-fg">输入 Token</h2>
            </div>
            <p className="text-sm text-fg-3">
              在服务器终端运行 <code className="rounded bg-base px-1 py-0.5 font-mono text-xs">fourth-spark status</code> 查看 Token。
            </p>
            <form onSubmit={handleTokenSubmit} className="space-y-3">
              <input
                type="text"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="输入 Token"
                autoFocus
                className="w-full rounded-md border border-line bg-base px-3 py-2 text-sm text-fg placeholder:text-fg-5 focus:border-accent focus:outline-none"
              />
              {error && <p className="text-sm text-red-500">{error}</p>}
              <button
                type="submit"
                disabled={loading || !token.trim()}
                className="w-full rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {loading ? "验证中..." : "确认"}
              </button>
            </form>
          </div>
        )}

        {view === "pairing" && <PairingView onSuccess={setAuthenticated} onBack={() => { setView("landing"); setError("") }} />}
      </div>
    </div>
  )
}

function PairingView({ onSuccess, onBack }: { onSuccess: () => void; onBack: () => void }) {
  const [status, setStatus] = useState<"waiting" | "success" | "expired">("waiting")
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false

    async function tryPair() {
      try {
        const deviceName = detectDeviceName()
        const result = await completePairing(deviceName)
        if (cancelled) return
        setAuthToken(result.token)
        setStatus("success")
        setTimeout(onSuccess, 500)
      } catch (err) {
        if (cancelled) return
        const msg = err instanceof Error ? err.message : ""
        if (msg.includes("403") || msg.includes("not open")) {
          setStatus("expired")
        } else {
          setError("配对失败，请重试")
        }
      }
    }

    void tryPair()
    return () => { cancelled = true }
  }, [onSuccess])

  return (
    <div className="space-y-4 rounded-lg border border-line bg-elevated p-6">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onBack} className="text-fg-4 hover:text-fg">←</button>
        <h2 className="text-base font-semibold text-fg">设备配对</h2>
      </div>
      {status === "waiting" && (
        <div className="flex items-center gap-3">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-fg-5 border-t-transparent" />
          <p className="text-sm text-fg-3">正在配对...</p>
        </div>
      )}
      {status === "success" && <p className="text-sm text-green-500">配对成功！正在跳转...</p>}
      {status === "expired" && <p className="text-sm text-red-500">配对窗口已关闭，请在已认证设备上重新开启。</p>}
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  )
}

function detectDeviceName(): string {
  const ua = navigator.userAgent
  if (/iPhone/i.test(ua)) return "iPhone"
  if (/iPad/i.test(ua)) return "iPad"
  if (/Android/i.test(ua)) return "Android"
  if (/Mac/i.test(ua)) return "Mac"
  if (/Windows/i.test(ua)) return "Windows"
  if (/Linux/i.test(ua)) return "Linux"
  return "Unknown Device"
}
