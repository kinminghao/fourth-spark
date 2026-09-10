import { useEffect, useState } from "react"
import { AlertTriangle, Check, Cloud, Loader2, RefreshCw, User } from "lucide-react"
import clsx from "clsx"
import * as api from "../../lib/api-client"
import { formatReset } from "./account-utils"
import { AccountSwitchModal } from "./AccountSwitchModal"

export function CloudPoolSection({ onStatusChange }: { onStatusChange?: (s: api.CloudStatus) => void }) {
  const [url, setUrl] = useState("")
  const [workerId, setWorkerId] = useState("")
  const [savedUrl, setSavedUrl] = useState("")
  const [savedWorkerId, setSavedWorkerId] = useState("")
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<"ok" | "fail" | null>(null)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<api.CloudStatus | null>(null)
  const [showSwitchModal, setShowSwitchModal] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [settings, cloudStatus] = await Promise.all([
        api.getSettings().catch(() => ({}) as Record<string, string>),
        api.getCloudStatus().catch(() => null),
      ])
      if (cancelled) return
      const masterUrl = settings.cloud_master_url ?? ""
      const cwid = settings.cloud_worker_id || cloudStatus?.defaultWorkerId || ""
      setUrl(masterUrl)
      setSavedUrl(masterUrl)
      setWorkerId(cwid)
      setSavedWorkerId(settings.cloud_worker_id ?? "")
      setStatus(cloudStatus)
    })()
    return () => { cancelled = true }
  }, [])

  const mode = status?.mode ?? (savedUrl ? "worker" : "local")
  const isWorker = mode === "worker"
  const needsReload = !isWorker && !!url.trim() && !!workerId.trim()
  const dirty = url !== savedUrl || workerId !== savedWorkerId || needsReload

  const testConnection = async () => {
    const target = url.replace(/\/+$/, "")
    if (!target) return
    setTesting(true)
    setResult(null)
    const ok = await api.testMasterConnection(target)
    setResult(ok ? "ok" : "fail")
    setTesting(false)
  }

  const handleSave = async () => {
    const normalized = url.replace(/\/+$/, "")
    const trimmedId = workerId.trim()
    setSaving(true)
    try {
      await api.updateSetting("cloud_master_url", normalized)
      await api.updateSetting("cloud_worker_id", trimmedId)
      setSavedUrl(normalized)
      setSavedWorkerId(trimmedId)
      setUrl(normalized)
      setWorkerId(trimmedId)
      const fresh = await api.reloadCloudPool().catch(() => null)
      if (fresh) {
        setStatus(fresh)
        onStatusChange?.(fresh)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500">
          <Cloud className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-fg">账号池配置</h2>
          <p className="mt-0.5 text-xs text-fg-4">连接 claude-accounts-pool Master，共享多账号池。</p>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        <div className="flex items-center gap-2 rounded-lg border border-line bg-base px-3 py-2">
          <span
            className={clsx(
              "h-2 w-2 shrink-0 rounded-full",
              isWorker ? "bg-blue-500 shadow-sm shadow-blue-500/60" : "bg-green-500 shadow-sm shadow-green-500/60",
            )}
          />
          <span className="text-xs font-medium text-fg-3">{isWorker ? "Worker 模式" : "本地模式"}</span>
          {isWorker && status?.workerId && (
            <span className="rounded bg-elevated px-1.5 py-0.5 font-mono text-[10px] text-fg-4">{status.workerId}</span>
          )}
          {isWorker && status?.connected != null && (
            <span
              className={clsx(
                "ml-auto text-[10px] font-medium",
                status.connected ? "text-green-500" : "text-red-400",
              )}
            >
              {status.connected ? "已连接" : "未连接"}
            </span>
          )}
        </div>
        {isWorker && status?.heldAccount && (
          <div className="flex items-center gap-2 rounded-lg border border-line bg-base px-3 py-2">
            <User className="h-3.5 w-3.5 shrink-0 text-blue-500" />
            <span className="text-xs text-fg-4">当前账号</span>
            <span className="min-w-0 truncate text-xs font-medium text-fg">{status.heldAccount.label}</span>
            <button
              type="button"
              onClick={() => setShowSwitchModal(true)}
              className="ml-auto rounded-md border border-line px-2 py-0.5 text-[10px] font-medium text-fg-4 transition-colors hover:bg-elevated hover:text-fg-3"
            >
              切换账号
            </button>
          </div>
        )}
      </div>

      <div className="mt-4 space-y-3">
        <label className="block">
          <span className="text-xs font-medium text-fg-3">Master URL</span>
          <input
            type="url"
            value={url}
            onChange={(e) => { setUrl(e.target.value); setResult(null) }}
            placeholder="http://100.64.0.36:8787"
            className="mt-1 w-full rounded-md border border-line bg-base px-3 py-2 font-mono text-sm text-fg placeholder:text-fg-6 focus:border-blue-500 focus:outline-none"
          />
        </label>

        <label className="block">
          <span className="text-xs font-medium text-fg-3">Worker ID</span>
          <input
            type="text"
            value={workerId}
            onChange={(e) => setWorkerId(e.target.value)}
            placeholder="fourth-spark-1"
            className="mt-1 w-full rounded-md border border-line bg-base px-3 py-2 font-mono text-sm text-fg placeholder:text-fg-6 focus:border-blue-500 focus:outline-none"
          />
          <span className="mt-1 block text-[11px] text-fg-5">此 Worker 在账号池中的唯一标识，建议用小写字母、数字和连字符。</span>
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
            onClick={() => void handleSave()}
            disabled={!dirty || saving}
            className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-40"
          >
            <span className="text-lg">💾</span>
            {saving ? "保存中…" : "保存"}
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
        清空 Master URL 可切回本地模式。
      </p>

      {showSwitchModal && (
        <AccountSwitchModal
          onClose={() => setShowSwitchModal(false)}
          onSwitched={async () => {
            const fresh = await api.getCloudStatus().catch(() => null)
            if (fresh) {
              setStatus(fresh)
              onStatusChange?.(fresh)
            }
          }}
        />
      )}
    </section>
  )
}
