import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AlertTriangle, Ban, Bot, Check, Clipboard, Clock, Cloud, Cpu, Download, Edit3, Eye, EyeOff, FileText, Gauge, GitBranch, Loader2, Plus, RefreshCw, Save, Search, Trash2, Upload, User, Users, Wifi, X, Zap } from "lucide-react"
import clsx from "clsx"
import * as api from "../lib/api-client"
import type { AccountUsage, CustomAgent, CustomAgentExport, GitHost, ModelInfo, PromptFragment, UsageResult, UsageWindow } from "../lib/api-client"
import { useCustomAgentStore } from "../stores/custom-agent-store"
import { useRepoStore } from "../stores/repo-store"
import { isNativePlatform, getServerUrl, setServerUrl } from "../lib/config"


let usageCache: { data: UsageResult; fetchedAt: number } | null = null

function formatElapsed(ts: number): string {
  const ms = Date.now() - ts
  const m = Math.floor(ms / 60_000)
  if (m < 1) return "刚刚"
  if (m < 60) return `${m} 分钟前`
  return `${Math.floor(m / 60)} 小时前`
}

type Tab = "usage" | "git" | "models" | "custom-agents" | "agents" | "cloud" | "server"

const BASE_TABS: { id: Tab; label: string; icon: typeof Zap }[] = [
  { id: "usage", label: "订阅额度", icon: Zap },
  { id: "git", label: "Git 源站", icon: GitBranch },
  { id: "models", label: "模型", icon: Cpu },
  { id: "custom-agents", label: "Custom Agents", icon: Bot },
  { id: "agents", label: "AGENTS.md", icon: FileText },
  { id: "cloud", label: "账号池", icon: Cloud },
]

const SERVER_TAB: { id: Tab; label: string; icon: typeof Zap } = {
  id: "server", label: "服务器", icon: Wifi,
}

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

  const switchRef = useRef(false)
  const handleSwitch = useCallback((accountId: string) => {
    if (switchRef.current) return
    switchRef.current = true
    setSwitchingId(accountId)
    api.switchUsageAccount(accountId)
      .then((r) => { applyResult(r); setSwitchingId(null) })
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e))
        setSwitchingId(null)
      })
      .finally(() => { switchRef.current = false })
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

const PINNED_MODELS_KEY = "pinned_models"

type GroupedModels = { provider: string; models: ModelInfo[] }[]

function groupModelsByProvider(models: ModelInfo[]): GroupedModels {
  const map = new Map<string, ModelInfo[]>()
  for (const m of models) {
    const key = m.providerName || m.providerID
    const list = map.get(key)
    if (list) list.push(m)
    else map.set(key, [m])
  }
  return Array.from(map, ([provider, models]) => ({ provider, models })).sort((a, b) => {
    const aCfg = a.models.some((m) => m.configured)
    const bCfg = b.models.some((m) => m.configured)
    if (aCfg !== bCfg) return aCfg ? -1 : 1
    return a.provider.localeCompare(b.provider)
  })
}

function fmtCtx(limit: number | undefined): string {
  if (!limit) return ""
  if (limit >= 1_000_000) return `${(limit / 1_000_000).toFixed(limit % 1_000_000 === 0 ? 0 : 1)}M`
  if (limit >= 1_000) return `${Math.round(limit / 1_000)}K`
  return String(limit)
}

function fmtCost(cost: { input?: number; output?: number } | undefined): string {
  if (!cost) return ""
  const parts: string[] = []
  if (cost.input != null) parts.push(`$${cost.input}/Mi`)
  if (cost.output != null) parts.push(`$${cost.output}/Mo`)
  return parts.join(" ")
}

function ModelManagementSection() {
  const activeRepoId = useRepoStore((s) => s.activeRepoId)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeProvider, setActiveProvider] = useState<string | null>(null)
  const [query, setQuery] = useState("")

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [settings, modelList] = await Promise.all([
          api.getSettings(),
          activeRepoId ? api.listModels(activeRepoId) : Promise.resolve([]),
        ])
        if (cancelled) return
        const raw = settings[PINNED_MODELS_KEY]
        const pinned: string[] = raw ? JSON.parse(raw) : []
        setPinnedIds(new Set(pinned))
        setModels(modelList)
        setActiveProvider(null)
        setQuery("")
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
      if (!cancelled) setLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [activeRepoId])

  const toggleModel = async (modelId: string) => {
    const next = new Set(pinnedIds)
    if (next.has(modelId)) next.delete(modelId)
    else next.add(modelId)
    setPinnedIds(next)
    try {
      await api.updateSetting(PINNED_MODELS_KEY, JSON.stringify([...next]))
    } catch {
      setPinnedIds(pinnedIds)
    }
  }

  const grouped = useMemo(() => groupModelsByProvider(models), [models])
  const pinnedCount = models.filter((m) => pinnedIds.has(m.id)).length

  const selectedGroup = activeProvider
    ? grouped.find((g) => g.provider === activeProvider)
    : grouped[0]

  const q = query.trim().toLowerCase()
  const visibleModels = selectedGroup
    ? (q ? selectedGroup.models.filter((m) => (m.name || m.id).toLowerCase().includes(q) || m.id.toLowerCase().includes(q)) : selectedGroup.models)
    : []

  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500">
            <Cpu className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-fg">常用模型</h2>
            <p className="mt-0.5 text-xs text-fg-4">
              勾选常用模型，在新建对话时快速选择。
              {pinnedCount > 0 && <span className="ml-1 text-blue-400">已选 {pinnedCount} 个</span>}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4">
        {!activeRepoId ? (
          <div className="flex flex-col items-center gap-2.5 py-10 text-fg-5">
            <Cpu className="h-5 w-5" />
            <p className="text-xs">请先在左侧选择一个仓库以加载可用模型。</p>
          </div>
        ) : loading ? (
          <div className="flex flex-col items-center gap-2.5 py-10 text-fg-5">
            <Loader2 className="h-5 w-5 fs-spin" />
            <p className="text-xs">加载模型列表…</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-2.5 py-10 text-red-400">
            <AlertTriangle className="h-5 w-5" />
            <p className="max-w-xs text-center text-xs leading-relaxed">{error}</p>
          </div>
        ) : models.length === 0 ? (
          <div className="flex flex-col items-center gap-2.5 py-10 text-fg-5">
            <Cpu className="h-5 w-5" />
            <p className="text-xs">当前仓库没有可用模型。</p>
          </div>
        ) : (
          <>
            <div className="flex gap-1 overflow-x-auto rounded-lg border border-line bg-base p-1">
              {grouped.map((g) => {
                const isActive = g.provider === (activeProvider ?? grouped[0]?.provider)
                const count = g.models.filter((m) => pinnedIds.has(m.id)).length
                return (
                  <button
                    key={g.provider}
                    type="button"
                    onClick={() => { setActiveProvider(g.provider); setQuery("") }}
                    className={clsx(
                      "flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                      isActive ? "bg-surface text-fg shadow-sm" : "text-fg-4 hover:text-fg-3",
                    )}
                  >
                    {g.provider}
                    {count > 0 && (
                      <span className="rounded-full bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-blue-500">
                        {count}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>

            <div className="mt-3 flex items-center gap-2 rounded-md border border-line bg-base px-3 py-1.5">
              <Search className="h-3.5 w-3.5 shrink-0 text-fg-5" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索模型…"
                className="min-w-0 flex-1 bg-transparent text-xs text-fg placeholder:text-fg-6 focus:outline-none"
              />
              {query && (
                <button type="button" onClick={() => setQuery("")} className="text-fg-5 hover:text-fg-3">
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            <div className="mt-3 rounded-lg border border-line bg-base">
              {visibleModels.length === 0 ? (
                <div className="px-3 py-6 text-center text-xs text-fg-5">无匹配模型</div>
              ) : (
                <div className="divide-y divide-line/40">
                  {visibleModels.map((m) => {
                    const checked = pinnedIds.has(m.id)
                    const ctx = fmtCtx(m.contextLimit)
                    const cost = fmtCost(m.cost)
                    return (
                      <label
                        key={m.id}
                        className={clsx(
                          "flex cursor-pointer items-center gap-3 px-3 py-2 transition-colors hover:bg-elevated/60",
                          checked && "bg-blue-500/5",
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => void toggleModel(m.id)}
                          className="h-3.5 w-3.5 shrink-0 cursor-pointer rounded border-line accent-blue-500"
                        />
                        <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg">
                          {m.name || m.id}
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          {ctx && <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] text-fg-5">{ctx}</span>}
                          {cost && <span className="text-[10px] text-fg-6">{cost}</span>}
                        </span>
                      </label>
                    )
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  )
}

const BASE_AGENTS = ["Sisyphus - ultraworker", "Prometheus - Plan Builder", "Atlas - Plan Executor"]

function CustomAgentRow({ agent, onEdit, onDelete }: { agent: CustomAgent; onEdit: () => void; onDelete: () => void }) {
  const [confirming, setConfirming] = useState(false)
  const [copied, setCopied] = useState(false)

  const handleExportDownload = async () => {
    const data = await api.exportCustomAgent(agent.id)
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${agent.name.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, "_")}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleExportCopy = async () => {
    const data = await api.exportCustomAgent(agent.id)
    await navigator.clipboard.writeText(JSON.stringify(data, null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

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
            <button type="button" onClick={() => void handleExportDownload()} title="导出 JSON 文件"
              className="rounded p-1.5 text-fg-5 opacity-0 transition-opacity hover:text-fg-3 group-hover:opacity-100">
              <Download className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => void handleExportCopy()} title="复制 JSON 到剪贴板"
              className="rounded p-1.5 text-fg-5 opacity-0 transition-opacity hover:text-fg-3 group-hover:opacity-100">
              {copied ? <Check className="h-4 w-4 text-green-500" /> : <Clipboard className="h-4 w-4" />}
            </button>
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

const SP_KEY = "__system_prompt__"

function CustomAgentForm({ initial, availableFragments, onSave, onCancel }: {
  initial?: CustomAgent
  availableFragments: PromptFragment[]
  onSave: (data: { name: string; baseAgent: string; model?: string; systemPrompt?: string; systemPromptPosition?: number; fragmentIds?: string[] }) => Promise<void>
  onCancel: () => void
}) {
  const activeRepoId = useRepoStore((s) => s.activeRepoId)
  const [name, setName] = useState(initial?.name ?? "")
  const [baseAgent, setBaseAgent] = useState(initial?.baseAgent ?? "Sisyphus - ultraworker")
  const [model, setModel] = useState(initial?.model ?? "")
  const [systemPrompt, setSystemPrompt] = useState(initial?.systemPrompt ?? "")
  const [showPreview, setShowPreview] = useState(false)
  const [saving, setSaving] = useState(false)
  const [pinnedModels, setPinnedModels] = useState<ModelInfo[]>([])

  useEffect(() => {
    if (!activeRepoId) { setPinnedModels([]); return }
    let cancelled = false
    void (async () => {
      try {
        const [settings, models] = await Promise.all([
          api.getSettings(),
          api.listModels(activeRepoId),
        ])
        if (cancelled) return
        const raw = settings[PINNED_MODELS_KEY]
        const pinnedIds: string[] = raw ? JSON.parse(raw) : []
        setPinnedModels(pinnedIds.length > 0 ? models.filter((m) => pinnedIds.includes(m.id)) : [])
      } catch {
        if (!cancelled) setPinnedModels([])
      }
    })()
    return () => { cancelled = true }
  }, [activeRepoId])

  const [orderedItems, setOrderedItems] = useState<string[]>(() => {
    const fragIds = initial?.fragments.map((f) => f.id) ?? []
    const pos = initial?.systemPromptPosition ?? -1
    const insertAt = pos >= 0 && pos <= fragIds.length ? pos : fragIds.length
    const items = [...fragIds]
    items.splice(insertAt, 0, SP_KEY)
    return items
  })

  const toggleFragment = (id: string) => {
    setOrderedItems((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id)
      const spIdx = prev.indexOf(SP_KEY)
      const items = [...prev]
      items.splice(spIdx >= 0 ? spIdx : items.length, 0, id)
      return items
    })
  }

  const moveItem = (idx: number, dir: -1 | 1) => {
    const target = idx + dir
    if (target < 0 || target >= orderedItems.length) return
    setOrderedItems((prev) => {
      const next = [...prev]
      ;[next[idx], next[target]] = [next[target], next[idx]]
      return next
    })
  }

  const selectedIds = orderedItems.filter((id) => id !== SP_KEY)
  const spPosition = (() => {
    const spIdx = orderedItems.indexOf(SP_KEY)
    if (spIdx < 0) return -1
    return orderedItems.slice(0, spIdx).filter((id) => id !== SP_KEY).length
  })()

  const preview = orderedItems
    .map((id) => id === SP_KEY ? systemPrompt : availableFragments.find((f) => f.id === id)?.content)
    .filter(Boolean)
    .join("\n\n---\n\n")

  const submit = async () => {
    if (!name.trim() || !baseAgent) return
    setSaving(true)
    try {
      await onSave({ name: name.trim(), baseAgent, model: model.trim() || undefined, systemPrompt, systemPromptPosition: spPosition, fragmentIds: selectedIds })
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
      <div>
        <span className="text-xs font-medium text-fg-3">模型（可选）</span>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-1.5 font-mono text-sm text-fg focus:border-blue-500 focus:outline-none"
        >
          <option value="">默认模型</option>
          {pinnedModels.map((m) => (
            <option key={m.id} value={m.id}>{m.name || m.id}</option>
          ))}
        </select>
        {pinnedModels.length === 0 && (
          <p className="mt-1 text-[11px] text-fg-5">在「模型」Tab 中勾选常用模型后可选择。</p>
        )}
      </div>

      <div>
        <span className="text-xs font-medium text-fg-3">提示词组合</span>
        <p className="mt-0.5 text-[11px] text-fg-5">拖拽排序片段与补充指令的拼接顺序。</p>
        <div className="mt-1.5 space-y-1">
          {orderedItems.map((id, idx) => {
            if (id === SP_KEY) {
              return (
                <div key={id} className="flex items-center gap-2 rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1">
                  <div className="flex flex-col">
                    <button type="button" onClick={() => moveItem(idx, -1)} disabled={idx === 0}
                      className="text-[10px] leading-none text-fg-5 hover:text-fg-2 disabled:opacity-30">▲</button>
                    <button type="button" onClick={() => moveItem(idx, 1)} disabled={idx === orderedItems.length - 1}
                      className="text-[10px] leading-none text-fg-5 hover:text-fg-2 disabled:opacity-30">▼</button>
                  </div>
                  <span className="flex-1 truncate text-xs font-medium text-amber-400">✎ 补充指令</span>
                </div>
              )
            }
            const frag = availableFragments.find((f) => f.id === id)
            if (!frag) return null
            return (
              <div key={id} className="flex items-center gap-2 rounded border border-blue-500/30 bg-blue-500/5 px-2 py-1">
                <div className="flex flex-col">
                  <button type="button" onClick={() => moveItem(idx, -1)} disabled={idx === 0}
                    className="text-[10px] leading-none text-fg-5 hover:text-fg-2 disabled:opacity-30">▲</button>
                  <button type="button" onClick={() => moveItem(idx, 1)} disabled={idx === orderedItems.length - 1}
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

      <label className="block">
        <span className="text-xs font-medium text-fg-3">补充指令内容</span>
        <textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} rows={3}
          placeholder="agent 级别的补充指令…"
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

function ImportAgentForm({ onImported, onCancel }: { onImported: () => void; onCancel: () => void }) {
  const [jsonText, setJsonText] = useState("")
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const doImport = async (text: string) => {
    setError(null)
    let parsed: CustomAgentExport
    try {
      parsed = JSON.parse(text) as CustomAgentExport
    } catch {
      setError("JSON 格式无效")
      return
    }
    if (parsed.type !== "fourth-spark-custom-agent" || !parsed.agent) {
      setError("不是有效的 Custom Agent 导出文件")
      return
    }
    setImporting(true)
    try {
      await api.importCustomAgent(parsed)
      onImported()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setImporting(false)
    }
  }

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const text = reader.result as string
      setJsonText(text)
      void doImport(text)
    }
    reader.readAsText(file)
  }

  return (
    <div className="space-y-3 rounded-lg border border-line bg-base p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-fg-3">导入 Custom Agent</span>
        <button type="button" onClick={onCancel} className="rounded p-1 text-fg-5 hover:text-fg-3">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <input ref={fileRef} type="file" accept=".json" onChange={handleFile} className="hidden" />
      <button type="button" onClick={() => fileRef.current?.click()}
        className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-line py-2.5 text-xs text-fg-4 transition-colors hover:border-fg-5 hover:text-fg-3">
        <Upload className="h-3.5 w-3.5" /> 上传 JSON 文件
      </button>

      <div className="relative">
        <textarea value={jsonText} onChange={(e) => setJsonText(e.target.value)} rows={4}
          placeholder="或粘贴 JSON 内容…"
          className="w-full resize-y rounded-md border border-line bg-surface px-3 py-2 font-mono text-xs leading-relaxed text-fg placeholder:text-fg-6 focus:border-blue-500 focus:outline-none" />
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-md px-3 py-1.5 text-xs text-fg-4 hover:bg-elevated">取消</button>
        <button type="button" onClick={() => void doImport(jsonText)} disabled={importing || !jsonText.trim()}
          className="rounded-md bg-blue-600 px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-40">
          {importing ? "导入中…" : "导入"}
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
  const [showImport, setShowImport] = useState(false)

  const load = () => {
    Promise.all([api.listGlobalCustomAgents(), api.listGlobalFragments()])
      .then(([a, f]) => { setAgents(a); setFragments(f); setLoading(false) })
      .catch(() => setLoading(false))
  }

  useEffect(load, [])

  const handleCreateAgent = async (data: { name: string; baseAgent: string; model?: string; systemPrompt?: string; systemPromptPosition?: number; fragmentIds?: string[] }) => {
    await api.createGlobalCustomAgent(data)
    setShowAgentForm(false)
    load()
    void useCustomAgentStore.getState().loadAgents()
  }

  const handleUpdateAgent = async (data: { name: string; baseAgent: string; model?: string; systemPrompt?: string; systemPromptPosition?: number; fragmentIds?: string[] }) => {
    if (!editingAgent) return
    await api.updateCustomAgent(editingAgent.id, data)
    setEditingAgent(null)
    load()
    void useCustomAgentStore.getState().loadAgents()
  }

  const handleDeleteAgent = async (id: string) => {
    await api.deleteCustomAgent(id)
    setAgents((prev) => prev.filter((a) => a.id !== id))
    void useCustomAgentStore.getState().loadAgents()
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
          ) : showImport ? (
            <ImportAgentForm onImported={() => { setShowImport(false); load(); void useCustomAgentStore.getState().loadAgents() }} onCancel={() => setShowImport(false)} />
          ) : (
            <div className="flex gap-2">
              <button type="button" onClick={() => setShowAgentForm(true)}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-dashed border-line py-2.5 text-xs text-fg-4 transition-colors hover:border-fg-5 hover:text-fg-3">
                <Plus className="h-3.5 w-3.5" /> 添加 Custom Agent
              </button>
              <button type="button" onClick={() => setShowImport(true)}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-dashed border-line py-2.5 text-xs text-fg-4 transition-colors hover:border-fg-5 hover:text-fg-3">
                <Upload className="h-3.5 w-3.5" /> 导入 Agent
              </button>
            </div>
          )}
        </div>
        <p className="mt-4 text-[11px] text-fg-5">全局 Agent 对所有仓库可见。支持导出 JSON 分享给其他实例。</p>
      </section>
    </div>
  )
}

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

function CloudPoolSection() {
  const [url, setUrl] = useState("")
  const [workerId, setWorkerId] = useState("")
  const [savedUrl, setSavedUrl] = useState("")
  const [savedWorkerId, setSavedWorkerId] = useState("")
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<"ok" | "fail" | null>(null)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<api.CloudStatus | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [settings, cloudStatus] = await Promise.all([
        api.getSettings().catch(() => ({}) as Record<string, string>),
        api.getCloudStatus().catch(() => null),
      ])
      if (cancelled) return
      const masterUrl = settings.cloud_master_url ?? ""
      const cwid = settings.cloud_worker_id ?? ""
      setUrl(masterUrl)
      setSavedUrl(masterUrl)
      setWorkerId(cwid)
      setSavedWorkerId(cwid)
      setStatus(cloudStatus)
    })()
    return () => { cancelled = true }
  }, [])

  const dirty = url !== savedUrl || workerId !== savedWorkerId
  const mode = status?.mode ?? (savedUrl ? "worker" : "local")
  const isWorker = mode === "worker"

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

      <div className="mt-4 flex items-center gap-2 rounded-lg border border-line bg-base px-3 py-2">
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
            <Save className="h-3.5 w-3.5" />
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
        保存后需重启 Server 生效。清空 Master URL 可切回本地模式。
      </p>
    </section>
  )
}

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>("usage")
  const tabs = useMemo(() => (isNativePlatform() || getServerUrl()) ? [...BASE_TABS, SERVER_TAB] : BASE_TABS, [])

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-2xl">
        <h1 className="text-lg font-semibold text-fg">设置</h1>
        <p className="mt-0.5 text-sm text-fg-4">全局配置</p>

        <div className="mt-6 flex gap-1 rounded-lg border border-line bg-surface p-1">
          {tabs.map((t) => (
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
          {tab === "models" && <ModelManagementSection />}
          {tab === "custom-agents" && <CustomAgentsSection />}
          {tab === "agents" && <AgentsMdSection />}
          {tab === "cloud" && <CloudPoolSection />}
          {tab === "server" && <ServerSection />}
        </div>
      </div>
    </div>
  )
}
