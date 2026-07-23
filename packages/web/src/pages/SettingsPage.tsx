import { useCallback, useEffect, useState } from "react"
import { Check, Eye, EyeOff, GitBranch, Plus, RefreshCw, Trash2, X, Zap } from "lucide-react"
import clsx from "clsx"
import * as api from "../lib/api-client"
import type { AccountUsage, GitHost, UsageResult, UsageWindow } from "../lib/api-client"

type Tab = "usage" | "git"

const TABS: { id: Tab; label: string; icon: typeof Zap }[] = [
  { id: "usage", label: "订阅额度", icon: Zap },
  { id: "git", label: "Git 源站", icon: GitBranch },
]

function formatReset(resetsAt: string | undefined): string | null {
  if (!resetsAt) return null
  const diff = new Date(resetsAt).getTime() - Date.now()
  if (diff <= 0) return "已重置"
  const h = Math.floor(diff / 3_600_000)
  const m = Math.floor((diff % 3_600_000) / 60_000)
  if (h > 0) return `${h}h ${m}m 后重置`
  return `${m}m 后重置`
}

function barColor(pct: number): string {
  if (pct >= 90) return "bg-red-500"
  if (pct >= 70) return "bg-amber-500"
  return "bg-blue-500"
}

function UsageBar({ label, window: w }: { label: string; window: UsageWindow | null | undefined }) {
  if (!w) return null
  const pct = Math.round(w.utilization)
  const reset = formatReset(w.resets_at)
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium text-fg-3">{label}</span>
        <div className="flex items-baseline gap-2">
          <span className={clsx("text-xs font-semibold", pct >= 90 ? "text-red-400" : pct >= 70 ? "text-amber-400" : "text-fg-2")}>
            {pct}%
          </span>
          {reset && <span className="text-[10px] text-fg-5">{reset}</span>}
        </div>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-elevated">
        <div className={clsx("h-full rounded-full transition-all", barColor(pct))} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
    </div>
  )
}

function AccountCard({ account }: { account: AccountUsage }) {
  return (
    <div className="rounded-lg border border-line bg-base px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="min-w-0 truncate text-sm font-medium text-fg">{account.label}</span>
        {account.active && (
          <span className="shrink-0 rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-medium text-blue-500">当前</span>
        )}
        {account.excluded && (
          <span className="shrink-0 rounded bg-elevated px-1.5 py-0.5 text-[10px] text-fg-5">不自动切</span>
        )}
        {account.needsReauth && (
          <span className="shrink-0 rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] text-red-400">需重新登录</span>
        )}
      </div>

      {account.error && !account.usage ? (
        <p className="mt-2 text-xs text-red-400">{account.error}</p>
      ) : account.usage ? (
        <div className="mt-3 space-y-2.5">
          <UsageBar label="5 小时窗口" window={account.usage.five_hour} />
          <UsageBar label="7 天窗口" window={account.usage.seven_day} />
          {account.usage.scoped?.map((s) => (
            <UsageBar key={s.label} label={s.label} window={s} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function UsageSection() {
  const [data, setData] = useState<UsageResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    api.fetchUsage()
      .then((r) => { setData(r); setLoading(false) })
      .catch((e) => { setError(e instanceof Error ? e.message : String(e)); setLoading(false) })
  }, [])

  useEffect(load, [load])

  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-fg">Claude 订阅额度</h2>
          <p className="mt-1 text-xs text-fg-4">各账号的 Pro/Max 订阅窗口用量，数据实时从 Anthropic 获取。</p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="rounded-md p-1.5 text-fg-4 transition-colors hover:bg-elevated hover:text-fg-2 disabled:opacity-40"
        >
          <RefreshCw className={clsx("h-4 w-4", loading && "fs-spin")} />
        </button>
      </div>

      <div className="mt-4 space-y-2">
        {loading && !data ? (
          <p className="py-4 text-center font-mono text-xs text-fg-5">加载中…</p>
        ) : error && !data ? (
          <p className="py-4 text-center text-xs text-red-400">{error}</p>
        ) : data && data.accounts.length === 0 ? (
          <p className="py-4 text-center text-xs text-fg-5">
            未找到账号。请在 OpenCode TUI 中通过 claude-accounts-usage 插件登录。
          </p>
        ) : data ? (
          data.accounts.map((a) => <AccountCard key={a.id} account={a} />)
        ) : null}
      </div>
    </section>
  )
}

function GitHostRow({ host, onDelete }: { host: GitHost; onDelete: () => void }) {
  const [confirming, setConfirming] = useState(false)

  return (
    <div className="group flex items-center gap-3 rounded-lg border border-line bg-base px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-fg">{host.name}</span>
          <span className="rounded bg-elevated px-1.5 py-0.5 font-mono text-[10px] text-fg-4">{host.platform}</span>
        </div>
        <div className="mt-0.5 flex items-center gap-2 font-mono text-xs text-fg-4">
          <span>{host.host}</span>
          <span className="text-fg-6">·</span>
          <span className="text-fg-5">{host.token}</span>
        </div>
      </div>
      {confirming ? (
        <div className="flex items-center gap-1">
          <button type="button" onClick={onDelete} className="rounded p-1.5 text-red-400 hover:bg-red-500/10">
            <Check className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => setConfirming(false)} className="rounded p-1.5 text-fg-4 hover:bg-elevated">
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="rounded p-1.5 text-fg-5 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}

function AddHostForm({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false)
  const [host, setHost] = useState("")
  const [name, setName] = useState("")
  const [token, setToken] = useState("")
  const [platform, setPlatform] = useState("gitea")
  const [saving, setSaving] = useState(false)
  const [visible, setVisible] = useState(false)

  const reset = () => { setHost(""); setName(""); setToken(""); setPlatform("gitea"); setOpen(false) }

  const submit = async () => {
    if (!host.trim() || !name.trim() || !token.trim()) return
    setSaving(true)
    try {
      await api.createGitHost(host.trim(), name.trim(), token.trim(), platform)
      reset()
      onAdded()
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-line py-2.5 text-xs text-fg-4 transition-colors hover:border-fg-5 hover:text-fg-3"
      >
        <Plus className="h-3.5 w-3.5" /> 添加 Git 源站
      </button>
    )
  }

  return (
    <div className="space-y-3 rounded-lg border border-line bg-base p-4">
      <div className="flex gap-3">
        <label className="flex-1">
          <span className="text-xs font-medium text-fg-3">名称</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="公司 Gitea"
            className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-fg placeholder:text-fg-6 focus:border-blue-500 focus:outline-none"
          />
        </label>
        <label className="w-28">
          <span className="text-xs font-medium text-fg-3">平台</span>
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-fg focus:border-blue-500 focus:outline-none"
          >
            <option value="gitea">Gitea</option>
            <option value="github">GitHub</option>
            <option value="gitlab">GitLab</option>
          </select>
        </label>
      </div>
      <label className="block">
        <span className="text-xs font-medium text-fg-3">Host</span>
        <input
          type="text"
          value={host}
          onChange={(e) => setHost(e.target.value)}
          placeholder="git.btsai.work"
          className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-1.5 font-mono text-sm text-fg placeholder:text-fg-6 focus:border-blue-500 focus:outline-none"
        />
      </label>
      <label className="block">
        <span className="text-xs font-medium text-fg-3">Token</span>
        <div className="relative mt-1">
          <input
            type={visible ? "text" : "password"}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Personal Access Token"
            className="w-full rounded-md border border-line bg-surface px-3 py-1.5 pr-9 font-mono text-sm text-fg placeholder:text-fg-6 focus:border-blue-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => setVisible(!visible)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-fg-5 hover:text-fg-3"
          >
            {visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        </div>
      </label>
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={reset} className="rounded-md px-3 py-1.5 text-xs text-fg-4 hover:bg-elevated">
          取消
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={saving || !host.trim() || !name.trim() || !token.trim()}
          className="rounded-md bg-blue-600 px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-40"
        >
          {saving ? "保存中…" : "保存"}
        </button>
      </div>
    </div>
  )
}

function GitHostSection() {
  const [hosts, setHosts] = useState<GitHost[]>([])
  const [loading, setLoading] = useState(true)

  const load = () => {
    api.listGitHosts().then((h) => { setHosts(h); setLoading(false) }).catch(() => setLoading(false))
  }

  useEffect(load, [])

  const handleDelete = async (id: string) => {
    await api.deleteGitHost(id)
    setHosts((prev) => prev.filter((h) => h.id !== id))
  }

  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      <h2 className="text-sm font-semibold text-fg">Git 源站管理</h2>
      <p className="mt-1 text-xs text-fg-4">
        为不同的 Git 托管平台配置访问凭证，用于同步 Issues。系统会根据仓库的 git URL 自动匹配对应的源站。
      </p>

      <div className="mt-4 space-y-2">
        {loading ? (
          <p className="py-4 text-center font-mono text-xs text-fg-5">加载中…</p>
        ) : (
          <>
            {hosts.map((h) => (
              <GitHostRow key={h.id} host={h} onDelete={() => void handleDelete(h.id)} />
            ))}
            <AddHostForm onAdded={load} />
          </>
        )}
      </div>

      <p className="mt-4 text-[11px] text-fg-5">
        Token 存储在数据库中。也可通过环境变量 GITEA_TOKEN 设置全局 fallback。
      </p>
    </section>
  )
}

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>("usage")

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-2xl">
        <h1 className="text-lg font-semibold text-fg">设置</h1>
        <p className="mt-0.5 text-sm text-fg-4">全局配置</p>

        <div className="mt-6 flex gap-1 rounded-lg border border-line bg-surface p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={clsx(
                "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                tab === t.id
                  ? "bg-base text-fg shadow-sm"
                  : "text-fg-4 hover:text-fg-3",
              )}
            >
              <t.icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          ))}
        </div>

        <div className="mt-4">
          {tab === "usage" && <UsageSection />}
          {tab === "git" && <GitHostSection />}
        </div>
      </div>
    </div>
  )
}
