import { useCallback, useEffect, useState } from "react"
import { AlertTriangle, Ban, Check, Clock, Eye, EyeOff, Gauge, GitBranch, Loader2, Plus, RefreshCw, Trash2, User, Users, X, Zap } from "lucide-react"
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
  const danger = pct >= 90
  const warn = pct >= 70
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate text-xs font-medium text-fg-3">{label}</span>
        <div className="flex shrink-0 items-center gap-2">
          {reset && (
            <span className="inline-flex items-center gap-1 rounded-full bg-elevated px-1.5 py-0.5 text-[10px] font-medium text-fg-4 tabular-nums">
              <Clock className="h-2.5 w-2.5" />
              {reset}
            </span>
          )}
          <span
            className={clsx(
              "text-sm font-bold leading-none tabular-nums",
              danger ? "text-red-400" : warn ? "text-amber-400" : "text-fg",
            )}
          >
            {pct}%
          </span>
        </div>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-elevated ring-1 ring-inset ring-line/60">
        <div
          className={clsx(
            "h-full rounded-full transition-all duration-500 ease-out",
            barColor(pct),
            danger ? "shadow-sm shadow-red-500/50" : warn ? "shadow-sm shadow-amber-500/40" : null,
          )}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
    </div>
  )
}

function AccountCard({ account }: { account: AccountUsage }) {
  const active = account.active
  return (
    <div
      className={clsx(
        "relative overflow-hidden rounded-xl border bg-base p-4 shadow-sm transition-colors",
        active ? "border-blue-500/30 ring-1 ring-inset ring-blue-500/20" : "border-line",
      )}
    >
      {active && <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-blue-500" />}

      <div className="flex items-center gap-2.5">
        <div
          className={clsx(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
            active ? "bg-blue-500/15 text-blue-500" : "bg-elevated text-fg-4",
          )}
        >
          <User className="h-3.5 w-3.5" />
        </div>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">{account.label}</span>

        {active && (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] font-semibold text-blue-500">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-500 shadow-sm shadow-blue-500/60" />
            当前
          </span>
        )}
        {account.excluded && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-elevated px-2 py-0.5 text-[10px] font-medium text-fg-5">
            <Ban className="h-2.5 w-2.5" />
            不自动切
          </span>
        )}
        {account.needsReauth && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-medium text-red-400">
            <AlertTriangle className="h-2.5 w-2.5" />
            需重新登录
          </span>
        )}
      </div>

      {account.error && !account.usage ? (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 break-words">{account.error}</span>
        </div>
      ) : account.usage ? (
        <div className="mt-4 space-y-3">
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
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500">
            <Gauge className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-fg">Claude 订阅额度</h2>
            <p className="mt-0.5 text-xs text-fg-4">各账号的 Pro/Max 订阅窗口用量，数据实时从 Anthropic 获取。</p>
          </div>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="shrink-0 rounded-md p-1.5 text-fg-4 transition-colors hover:bg-elevated hover:text-fg-2 disabled:opacity-40"
        >
          <RefreshCw className={clsx("h-4 w-4", loading && "fs-spin")} />
        </button>
      </div>

      <div className="mt-4 space-y-2.5">
        {loading && !data ? (
          <div className="flex flex-col items-center gap-2.5 py-10 text-fg-5">
            <Loader2 className="h-5 w-5 fs-spin" />
            <p className="text-xs">加载中…</p>
          </div>
        ) : error && !data ? (
          <div className="flex flex-col items-center gap-2.5 py-10 text-red-400">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-500/10">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <p className="max-w-xs text-center text-xs leading-relaxed">{error}</p>
          </div>
        ) : data && data.accounts.length === 0 ? (
          <div className="flex flex-col items-center gap-2.5 py-10 text-fg-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-elevated text-fg-4">
              <Users className="h-5 w-5" />
            </div>
            <p className="max-w-xs text-center text-xs leading-relaxed">
              未找到账号。请在 OpenCode TUI 中通过 claude-accounts-usage 插件登录。
            </p>
          </div>
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
