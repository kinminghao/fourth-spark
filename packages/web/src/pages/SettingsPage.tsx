import { useCallback, useEffect, useState } from "react"
import { AlertTriangle, Ban, Bot, Check, Clock, Edit3, Eye, EyeOff, FileText, Gauge, GitBranch, Loader2, Plus, RefreshCw, Save, Trash2, User, Users, X, Zap } from "lucide-react"
import clsx from "clsx"
import * as api from "../lib/api-client"
import type { AccountUsage, CustomAgent, GitHost, PromptFragment, UsageResult, UsageWindow } from "../lib/api-client"

let usageCache: { data: UsageResult; fetchedAt: number } | null = null

function formatElapsed(ts: number): string {
  const ms = Date.now() - ts
  const m = Math.floor(ms / 60_000)
  if (m < 1) return "刚刚"
  if (m < 60) return `${m} 分钟前`
  return `${Math.floor(m / 60)} 小时前`
}

type Tab = "usage" | "git" | "custom-agents" | "agents"

const TABS: { id: Tab; label: string; icon: typeof Zap }[] = [
  { id: "usage", label: "订阅额度", icon: Zap },
  { id: "git", label: "Git 源站", icon: GitBranch },
  { id: "custom-agents", label: "Custom Agents", icon: Bot },
  { id: "agents", label: "AGENTS.md", icon: FileText },
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

function AccountCard({ account, onSwitch, switching }: { account: AccountUsage; onSwitch?: (id: string) => void; switching?: boolean }) {
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
        {!active && onSwitch && (
          <button
            type="button"
            onClick={() => onSwitch(account.id)}
            disabled={switching}
            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[10px] font-medium text-fg-4 transition-colors hover:border-blue-500/50 hover:text-blue-500 disabled:opacity-40"
          >
            {switching && <Loader2 className="h-2.5 w-2.5 fs-spin" />}
            切换
          </button>
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
  const [data, setData] = useState<UsageResult | null>(usageCache?.data ?? null)
  const [loading, setLoading] = useState(!usageCache)
  const [error, setError] = useState<string | null>(null)
  const [switchingId, setSwitchingId] = useState<string | null>(null)
  const [cachedAt, setCachedAt] = useState<number | null>(usageCache?.fetchedAt ?? null)
  const [, setTick] = useState(0)

  const applyResult = useCallback((r: UsageResult) => {
    const now = Date.now()
    usageCache = { data: r, fetchedAt: now }
    setData(r)
    setCachedAt(now)
  }, [])

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    api.fetchUsage()
      .then((r) => { applyResult(r); setLoading(false) })
      .catch((e) => { setError(e instanceof Error ? e.message : String(e)); setLoading(false) })
  }, [applyResult])

  useEffect(() => {
    if (!usageCache) load()
  }, [load])

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  const handleSwitch = useCallback((accountId: string) => {
    setSwitchingId(accountId)
    api.switchUsageAccount(accountId)
      .then((r) => { applyResult(r); setSwitchingId(null) })
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e))
        setSwitchingId(null)
      })
  }, [applyResult])

  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500">
            <Gauge className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-fg">Claude 订阅额度</h2>
            <p className="mt-0.5 text-xs text-fg-4">各账号的 Pro/Max 订阅窗口用量。</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {cachedAt && (
            <span className="text-[10px] tabular-nums text-fg-5">{formatElapsed(cachedAt)}</span>
          )}
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="rounded-md p-1.5 text-fg-4 transition-colors hover:bg-elevated hover:text-fg-2 disabled:opacity-40"
          >
            <RefreshCw className={clsx("h-4 w-4", loading && "fs-spin")} />
          </button>
        </div>
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
          data.accounts.map((a) => (
            <AccountCard key={a.id} account={a} onSwitch={handleSwitch} switching={switchingId === a.id} />
          ))
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

function AgentsMdSection() {
  const [content, setContent] = useState("")
  const [saved, setSaved] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.getGlobalAgentsMd()
      .then((r) => { setContent(r.content); setSaved(r.content); setLoading(false) })
      .catch((e) => { setError(e instanceof Error ? e.message : String(e)); setLoading(false) })
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      await api.updateGlobalAgentsMd(content)
      setSaved(content)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setSaving(false)
  }

  const dirty = content !== saved

  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-fg">全局 AGENTS.md</h2>
          <p className="mt-1 text-xs text-fg-4">
            此内容会注入到所有仓库的 Agent 系统指令中。修改后 opencode 热加载，即时生效。
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving || !dirty}
          className="flex shrink-0 items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-40"
        >
          <Save className="h-3.5 w-3.5" />
          {saving ? "保存中…" : "保存"}
        </button>
      </div>

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 break-words">{error}</span>
        </div>
      )}

      <div className="mt-4">
        {loading ? (
          <div className="flex flex-col items-center gap-2.5 py-10 text-fg-5">
            <Loader2 className="h-5 w-5 fs-spin" />
            <p className="text-xs">加载中…</p>
          </div>
        ) : (
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            spellCheck={false}
            className="h-96 w-full resize-y rounded-lg border border-line bg-base px-4 py-3 font-mono text-sm leading-relaxed text-fg placeholder:text-fg-6 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            placeholder="# AGENTS.md&#10;&#10;在此编写全局 Agent 指令…"
          />
        )}
      </div>

      <p className="mt-3 text-[11px] text-fg-5">
        文件路径：~/.config/opencode/AGENTS.md
      </p>
    </section>
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

const BASE_AGENTS = ["sisyphus", "prometheus", "atlas"]

function CustomAgentRow({ agent, onEdit, onDelete }: { agent: CustomAgent; onEdit: () => void; onDelete: () => void }) {
  const [confirming, setConfirming] = useState(false)

  return (
    <div className="group flex items-center gap-3 rounded-lg border border-line bg-base px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-fg">{agent.name}</span>
          <span className="rounded bg-elevated px-1.5 py-0.5 font-mono text-[10px] text-fg-4">{agent.baseAgent}</span>
          {agent.model && (
            <span className="rounded bg-elevated px-1.5 py-0.5 font-mono text-[10px] text-fg-5">{agent.model}</span>
          )}
          {agent.repoId && (
            <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-400">repo</span>
          )}
        </div>
        {agent.systemPrompt && (
          <p className="mt-0.5 truncate font-mono text-xs text-fg-5">{agent.systemPrompt}</p>
        )}
      </div>
      <div className="flex items-center gap-1">
        {confirming ? (
          <>
            <button type="button" onClick={onDelete} className="rounded p-1.5 text-red-400 hover:bg-red-500/10">
              <Check className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => setConfirming(false)} className="rounded p-1.5 text-fg-4 hover:bg-elevated">
              <X className="h-4 w-4" />
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={onEdit} className="rounded p-1.5 text-fg-5 opacity-0 transition-opacity hover:text-fg-3 group-hover:opacity-100">
              <Edit3 className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => setConfirming(true)} className="rounded p-1.5 text-fg-5 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100">
              <Trash2 className="h-4 w-4" />
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function CustomAgentForm({ initial, availableFragments, onSave, onCancel }: {
  initial?: CustomAgent
  availableFragments: PromptFragment[]
  onSave: (data: { name: string; baseAgent: string; model?: string; systemPrompt?: string; fragmentIds?: string[] }) => Promise<void>
  onCancel: () => void
}) {
  const [name, setName] = useState(initial?.name ?? "")
  const [baseAgent, setBaseAgent] = useState(initial?.baseAgent ?? "sisyphus")
  const [model, setModel] = useState(initial?.model ?? "")
  const [systemPrompt, setSystemPrompt] = useState(initial?.systemPrompt ?? "")
  const [selectedIds, setSelectedIds] = useState<string[]>(initial?.fragments.map((f) => f.id) ?? [])
  const [showPreview, setShowPreview] = useState(false)
  const [saving, setSaving] = useState(false)

  const toggleFragment = (id: string) => {
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])
  }

  const moveFragment = (idx: number, dir: -1 | 1) => {
    const target = idx + dir
    if (target < 0 || target >= selectedIds.length) return
    setSelectedIds((prev) => {
      const next = [...prev]
      ;[next[idx], next[target]] = [next[target], next[idx]]
      return next
    })
  }

  const preview = [...selectedIds.map((id) => availableFragments.find((f) => f.id === id)?.content).filter(Boolean), systemPrompt].filter(Boolean).join("\n\n---\n\n")

  const submit = async () => {
    if (!name.trim() || !baseAgent) return
    setSaving(true)
    try {
      await onSave({ name: name.trim(), baseAgent, model: model.trim() || undefined, systemPrompt, fragmentIds: selectedIds })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-line bg-base p-4">
      <div className="flex gap-3">
        <label className="flex-1">
          <span className="text-xs font-medium text-fg-3">名称</span>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="代码审查员"
            className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-fg placeholder:text-fg-6 focus:border-blue-500 focus:outline-none" />
        </label>
        <label className="w-36">
          <span className="text-xs font-medium text-fg-3">Base Agent</span>
          <select value={baseAgent} onChange={(e) => setBaseAgent(e.target.value)}
            className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-fg focus:border-blue-500 focus:outline-none">
            {BASE_AGENTS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
      </div>
      <label className="block">
        <span className="text-xs font-medium text-fg-3">模型（可选，如 anthropic/claude-sonnet-4-6）</span>
        <input type="text" value={model} onChange={(e) => setModel(e.target.value)} placeholder="留空使用默认模型"
          className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-1.5 font-mono text-sm text-fg placeholder:text-fg-6 focus:border-blue-500 focus:outline-none" />
      </label>

      {availableFragments.length > 0 && (
        <div>
          <span className="text-xs font-medium text-fg-3">提示词片段</span>
          <div className="mt-1 space-y-1">
            {selectedIds.map((id, idx) => {
              const frag = availableFragments.find((f) => f.id === id)
              if (!frag) return null
              return (
                <div key={id} className="flex items-center gap-2 rounded border border-blue-500/30 bg-blue-500/5 px-2 py-1">
                  <div className="flex flex-col">
                    <button type="button" onClick={() => moveFragment(idx, -1)} disabled={idx === 0}
                      className="text-[10px] leading-none text-fg-5 hover:text-fg-2 disabled:opacity-30">▲</button>
                    <button type="button" onClick={() => moveFragment(idx, 1)} disabled={idx === selectedIds.length - 1}
                      className="text-[10px] leading-none text-fg-5 hover:text-fg-2 disabled:opacity-30">▼</button>
                  </div>
                  <span className="flex-1 truncate text-xs text-fg">{frag.name}</span>
                  <button type="button" onClick={() => toggleFragment(id)} className="text-fg-5 hover:text-red-400">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )
            })}
            {availableFragments.filter((f) => !selectedIds.includes(f.id)).length > 0 && (
              <select
                value=""
                onChange={(e) => { if (e.target.value) toggleFragment(e.target.value) }}
                className="w-full rounded border border-dashed border-line bg-surface px-2 py-1 text-xs text-fg-4 focus:border-blue-500 focus:outline-none"
              >
                <option value="">+ 添加片段…</option>
                {availableFragments.filter((f) => !selectedIds.includes(f.id)).map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            )}
          </div>
        </div>
      )}

      <label className="block">
        <span className="text-xs font-medium text-fg-3">补充指令（systemPrompt）</span>
        <textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} rows={3}
          placeholder="agent 级别的补充指令，拼接在 fragments 之后…"
          className="mt-1 w-full resize-y rounded-md border border-line bg-surface px-3 py-2 font-mono text-sm leading-relaxed text-fg placeholder:text-fg-6 focus:border-blue-500 focus:outline-none" />
      </label>

      {(selectedIds.length > 0 || systemPrompt) && (
        <div>
          <button type="button" onClick={() => setShowPreview(!showPreview)}
            className="flex items-center gap-1 text-xs font-medium text-fg-4 hover:text-fg-3">
            <span>{showPreview ? "▾" : "▸"}</span> 预览最终提示词
          </button>
          {showPreview && (
            <pre className="mt-1 max-h-48 overflow-auto rounded border border-line bg-elevated px-3 py-2 font-mono text-xs leading-relaxed text-fg-4">
              {preview || "(空)"}
            </pre>
          )}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className="rounded-md px-3 py-1.5 text-xs text-fg-4 hover:bg-elevated">取消</button>
        <button type="button" onClick={() => void submit()} disabled={saving || !name.trim()}
          className="rounded-md bg-blue-600 px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-40">
          {saving ? "保存中…" : initial ? "更新" : "创建"}
        </button>
      </div>
    </div>
  )
}

function FragmentRow({ fragment, onEdit, onDelete }: { fragment: PromptFragment; onEdit: () => void; onDelete: () => void }) {
  const [confirming, setConfirming] = useState(false)
  return (
    <div className="group flex items-center gap-3 rounded-lg border border-line bg-base px-3 py-2">
      <div className="min-w-0 flex-1">
        <span className="text-xs font-medium text-fg">{fragment.name}</span>
        {fragment.content && <p className="mt-0.5 truncate font-mono text-[11px] text-fg-5">{fragment.content}</p>}
      </div>
      <div className="flex items-center gap-1">
        {confirming ? (
          <>
            <button type="button" onClick={onDelete} className="rounded p-1 text-red-400 hover:bg-red-500/10"><Check className="h-3.5 w-3.5" /></button>
            <button type="button" onClick={() => setConfirming(false)} className="rounded p-1 text-fg-4 hover:bg-elevated"><X className="h-3.5 w-3.5" /></button>
          </>
        ) : (
          <>
            <button type="button" onClick={onEdit} className="rounded p-1 text-fg-5 opacity-0 transition-opacity hover:text-fg-3 group-hover:opacity-100"><Edit3 className="h-3.5 w-3.5" /></button>
            <button type="button" onClick={() => setConfirming(true)} className="rounded p-1 text-fg-5 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"><Trash2 className="h-3.5 w-3.5" /></button>
          </>
        )}
      </div>
    </div>
  )
}

function FragmentForm({ initial, onSave, onCancel }: {
  initial?: PromptFragment
  onSave: (data: { name: string; content: string }) => Promise<void>
  onCancel: () => void
}) {
  const [name, setName] = useState(initial?.name ?? "")
  const [content, setContent] = useState(initial?.content ?? "")
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (!name.trim()) return
    setSaving(true)
    try { await onSave({ name: name.trim(), content }) } finally { setSaving(false) }
  }

  return (
    <div className="space-y-2 rounded-lg border border-line bg-base p-3">
      <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="片段名称"
        className="w-full rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-fg placeholder:text-fg-6 focus:border-blue-500 focus:outline-none" />
      <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={3} placeholder="提示词内容…"
        className="w-full resize-y rounded-md border border-line bg-surface px-3 py-2 font-mono text-sm leading-relaxed text-fg placeholder:text-fg-6 focus:border-blue-500 focus:outline-none" />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-md px-3 py-1 text-xs text-fg-4 hover:bg-elevated">取消</button>
        <button type="button" onClick={() => void submit()} disabled={saving || !name.trim()}
          className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-40">
          {saving ? "保存中…" : initial ? "更新" : "创建"}
        </button>
      </div>
    </div>
  )
}

function CustomAgentsSection() {
  const [agents, setAgents] = useState<CustomAgent[]>([])
  const [fragments, setFragments] = useState<PromptFragment[]>([])
  const [loading, setLoading] = useState(true)
  const [showAgentForm, setShowAgentForm] = useState(false)
  const [editingAgent, setEditingAgent] = useState<CustomAgent | null>(null)
  const [showFragForm, setShowFragForm] = useState(false)
  const [editingFrag, setEditingFrag] = useState<PromptFragment | null>(null)

  const load = () => {
    Promise.all([api.listGlobalCustomAgents(), api.listGlobalFragments()])
      .then(([a, f]) => { setAgents(a); setFragments(f); setLoading(false) })
      .catch(() => setLoading(false))
  }

  useEffect(load, [])

  const handleCreateAgent = async (data: { name: string; baseAgent: string; model?: string; systemPrompt?: string; fragmentIds?: string[] }) => {
    await api.createGlobalCustomAgent(data)
    setShowAgentForm(false)
    load()
  }

  const handleUpdateAgent = async (data: { name: string; baseAgent: string; model?: string; systemPrompt?: string; fragmentIds?: string[] }) => {
    if (!editingAgent) return
    await api.updateCustomAgent(editingAgent.id, data)
    setEditingAgent(null)
    load()
  }

  const handleDeleteAgent = async (id: string) => {
    await api.deleteCustomAgent(id)
    setAgents((prev) => prev.filter((a) => a.id !== id))
  }

  const handleCreateFrag = async (data: { name: string; content: string }) => {
    await api.createGlobalFragment(data)
    setShowFragForm(false)
    load()
  }

  const handleUpdateFrag = async (data: { name: string; content: string }) => {
    if (!editingFrag) return
    await api.updateFragment(editingFrag.id, data)
    setEditingFrag(null)
    load()
  }

  const handleDeleteFrag = async (id: string) => {
    await api.deleteFragment(id)
    setFragments((prev) => prev.filter((f) => f.id !== id))
  }

  if (loading) {
    return (
      <section className="rounded-xl border border-line bg-surface p-5">
        <p className="py-4 text-center font-mono text-xs text-fg-5">加载中…</p>
      </section>
    )
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-line bg-surface p-5">
        <h2 className="text-sm font-semibold text-fg">提示词片段</h2>
        <p className="mt-1 text-xs text-fg-4">可复用的提示词模块，可在多个 Custom Agent 间共享。</p>
        <div className="mt-3 space-y-1.5">
          {fragments.map((f) =>
            editingFrag?.id === f.id ? (
              <FragmentForm key={f.id} initial={f} onSave={handleUpdateFrag} onCancel={() => setEditingFrag(null)} />
            ) : (
              <FragmentRow key={f.id} fragment={f} onEdit={() => setEditingFrag(f)} onDelete={() => void handleDeleteFrag(f.id)} />
            ),
          )}
          {showFragForm ? (
            <FragmentForm onSave={handleCreateFrag} onCancel={() => setShowFragForm(false)} />
          ) : (
            <button type="button" onClick={() => setShowFragForm(true)}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-line py-2 text-xs text-fg-4 transition-colors hover:border-fg-5 hover:text-fg-3">
              <Plus className="h-3.5 w-3.5" /> 添加片段
            </button>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-line bg-surface p-5">
        <h2 className="text-sm font-semibold text-fg">Custom Agents</h2>
        <p className="mt-1 text-xs text-fg-4">组合 base agent + 模型 + 提示词片段 + 补充指令。创建 Session 时选择即可。</p>
        <div className="mt-3 space-y-2">
          {agents.map((a) =>
            editingAgent?.id === a.id ? (
              <CustomAgentForm key={a.id} initial={a} availableFragments={fragments} onSave={handleUpdateAgent} onCancel={() => setEditingAgent(null)} />
            ) : (
              <CustomAgentRow key={a.id} agent={a} onEdit={() => setEditingAgent(a)} onDelete={() => void handleDeleteAgent(a.id)} />
            ),
          )}
          {showAgentForm ? (
            <CustomAgentForm availableFragments={fragments} onSave={handleCreateAgent} onCancel={() => setShowAgentForm(false)} />
          ) : (
            <button type="button" onClick={() => setShowAgentForm(true)}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-line py-2.5 text-xs text-fg-4 transition-colors hover:border-fg-5 hover:text-fg-3">
              <Plus className="h-3.5 w-3.5" /> 添加 Custom Agent
            </button>
          )}
        </div>
        <p className="mt-4 text-[11px] text-fg-5">全局 Agent 对所有仓库可见。</p>
      </section>
    </div>
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
          {tab === "custom-agents" && <CustomAgentsSection />}
          {tab === "agents" && <AgentsMdSection />}
        </div>
      </div>
    </div>
  )
}
