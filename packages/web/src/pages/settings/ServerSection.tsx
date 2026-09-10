import { useState } from "react"
import { AlertTriangle, Check, Loader2, RefreshCw, Save, Wifi } from "lucide-react"
import { getServerUrl, setServerUrl } from "../../lib/config"

function ServerSection() {
  const [url, setUrl] = useState(getServerUrl)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<"ok" | "fail" | null>(null)
  const [saved, setSaved] = useState(getServerUrl)

  const dirty = url !== saved

  const testConnection = async () => {
    const target = url.replace(/\/+$/, "")
    if (!target) return
    setTesting(true)
    setResult(null)
    try {
      const res = await fetch(`${target}/api/health`, { signal: AbortSignal.timeout(5_000) })
      setResult(res.ok ? "ok" : "fail")
    } catch {
      setResult("fail")
    }
    setTesting(false)
  }

  const handleSave = () => {
    const normalized = url.replace(/\/+$/, "")
    setServerUrl(normalized)
    setSaved(normalized)
    setUrl(normalized)
  }

  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500">
          <Wifi className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-fg">服务器连接</h2>
          <p className="mt-0.5 text-xs text-fg-4">配置远程 Fourth Spark Server 地址。</p>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <label className="block">
          <span className="text-xs font-medium text-fg-3">服务器地址</span>
          <input
            type="url"
            value={url}
            onChange={(e) => { setUrl(e.target.value); setResult(null) }}
            placeholder="http://192.168.1.100:3000"
            className="mt-1 w-full rounded-md border border-line bg-base px-3 py-2 font-mono text-sm text-fg placeholder:text-fg-6 focus:border-blue-500 focus:outline-none"
          />
        </label>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void testConnection()}
            disabled={testing || !url.trim()}
            className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-xs font-medium text-fg-3 transition-colors hover:bg-elevated disabled:opacity-40"
          >
            {testing ? <Loader2 className="h-3.5 w-3.5 fs-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            测试连接
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!dirty}
            className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-40"
          >
            <Save className="h-3.5 w-3.5" />
            保存
          </button>
          {result === "ok" && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-green-500">
              <Check className="h-3.5 w-3.5" /> 连接成功
            </span>
          )}
          {result === "fail" && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-red-400">
              <AlertTriangle className="h-3.5 w-3.5" /> 连接失败
            </span>
          )}
        </div>
      </div>

      <p className="mt-4 text-[11px] text-fg-5">
        保存后需重新打开 App 生效。确保手机与开发机在同一局域网。
      </p>
    </section>
  )
}

export { ServerSection }
