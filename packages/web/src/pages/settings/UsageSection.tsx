import { useCallback, useEffect, useRef, useState } from "react"
import { AlertTriangle, Check, Loader2, Plus, RefreshCw, User, Users, X, Zap } from "lucide-react"
import clsx from "clsx"
import * as api from "../../lib/api-client"
import type { AccountUsage, UsageResult, UsageWindow } from "../../lib/api-client"
import { usageCache, formatElapsed, formatReset, barColor } from "./account-utils"

function UsageBar({ label, window: w }: { label: string; window: (UsageWindow & { label?: string }) | null | undefined }) {
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
              <span className="h-2.5 w-2.5">🕐</span>
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
            <AlertTriangle className="h-2.5 w-2.5" />
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

      {account.holders && account.holders.length > 0 && (
        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-fg-5">
          <Users className="h-3 w-3 shrink-0" />
          <span className="truncate">{account.holders.join(", ")}</span>
        </div>
      )}

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

type LoginStep = "idle" | "loading" | "waiting" | "exchanging" | "done" | "error"

function ClaudeLoginModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [step, setStep] = useState<LoginStep>("idle")
  const [url, setUrl] = useState("")
  const [pendingId, setPendingId] = useState("")
  const [code, setCode] = useState("")
  const [error, setError] = useState("")
  const [resultLabel, setResultLabel] = useState("")
  const [existing, setExisting] = useState(false)

  const startAuth = async () => {
    setStep("loading")
    setError("")
    try {
      const result = await api.authorizeAccount()
      setUrl(result.url)
      setPendingId(result.pendingId)
      setStep("waiting")
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStep("error")
    }
  }

  const submitCode = async () => {
    if (!code.trim() || !pendingId) return
    setStep("exchanging")
    setError("")
    try {
      const result = await api.exchangeAccount(pendingId, code.trim())
      if (result.ok) {
        setResultLabel(result.label)
        setExisting(result.existing)
        setStep("done")
      } else {
        const detail = result.detail || result.reason
        if (result.attemptsLeft !== undefined && result.attemptsLeft > 0) {
          setError(`${detail}（还可重试 ${result.attemptsLeft} 次）`)
          setStep("waiting")
        } else if (result.reason === "throttled") {
          setError(`请求过快，请稍后再试`)
          setStep("waiting")
        } else {
          setError(detail)
          setStep("error")
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStep("error")
    }
  }

  useEffect(() => {
    startAuth()
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div
        className="flex w-full max-w-lg flex-col rounded-t-2xl border border-line bg-surface p-5 shadow-2xl sm:rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-fg">登录 Claude 账号</h2>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-fg-4 transition-colors hover:bg-elevated hover:text-fg-3">
            <X className="h-4 w-4" />
          </button>
        </div>

        {step === "loading" && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 fs-spin text-fg-4" />
          </div>
        )}

        {step === "waiting" && (
          <div className="mt-4 space-y-4">
            <div className="space-y-2">
              <p className="text-xs text-fg-3">
                <span className="font-medium text-fg">第 1 步：</span>点击下方链接，在浏览器中登录你的 Claude 账号。
              </p>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 rounded-lg border border-blue-500/30 bg-blue-500/5 px-3 py-2.5 text-xs font-medium text-blue-400 transition-colors hover:bg-blue-500/10"
              >
                <Zap className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">打开 Claude 登录页面</span>
              </a>
            </div>

            <div className="space-y-2">
              <p className="text-xs text-fg-3">
                <span className="font-medium text-fg">第 2 步：</span>登录成功后，页面会显示一个授权码，复制粘贴到下方。
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void submitCode() }}
                  placeholder="粘贴授权码…"
                  className="min-w-0 flex-1 rounded-md border border-line bg-base px-3 py-2 font-mono text-sm text-fg placeholder:text-fg-6 focus:border-blue-500 focus:outline-none"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => void submitCode()}
                  disabled={!code.trim()}
                  className="shrink-0 rounded-md bg-blue-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-40"
                >
                  确认
                </button>
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-1.5 rounded-md border border-red-400/30 bg-red-400/5 px-3 py-2">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
                <span className="text-xs text-red-400">{error}</span>
              </div>
            )}
          </div>
        )}

        {step === "exchanging" && (
          <div className="flex flex-col items-center gap-2 py-12">
            <Loader2 className="h-5 w-5 fs-spin text-blue-500" />
            <p className="text-xs text-fg-4">正在验证授权码…</p>
          </div>
        )}

        {step === "done" && (
          <div className="mt-4 space-y-4">
            <div className="flex flex-col items-center gap-2 py-6">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-500/10">
                <Check className="h-5 w-5 text-green-500" />
              </div>
              <p className="text-sm font-medium text-fg">
                {existing ? "账号已更新" : "账号添加成功"}
              </p>
              <p className="text-xs text-fg-4">{resultLabel}</p>
            </div>
            <button
              type="button"
              onClick={onSuccess}
              className="w-full rounded-md bg-blue-600 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-500"
            >
              完成
            </button>
          </div>
        )}

        {step === "error" && (
          <div className="mt-4 space-y-4">
            <div className="flex flex-col items-center gap-2 py-6">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-500/10">
                <AlertTriangle className="h-5 w-5 text-red-400" />
              </div>
              <p className="max-w-xs text-center text-xs text-red-400">{error}</p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setCode(""); void startAuth() }}
                className="flex-1 rounded-md border border-line py-2 text-xs font-medium text-fg-3 transition-colors hover:bg-elevated"
              >
                重试
              </button>
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-md bg-blue-600 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-500"
              >
                关闭
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export function UsageSection() {
  const [data, setData] = useState<UsageResult | null>(usageCache.fetchedAt > 0 ? usageCache.data : null)
  const [loading, setLoading] = useState(usageCache.fetchedAt === 0)
  const [error, setError] = useState<string | null>(null)
  const [switchingId, setSwitchingId] = useState<string | null>(null)
  const [cachedAt, setCachedAt] = useState<number | null>(usageCache.fetchedAt > 0 ? usageCache.fetchedAt : null)
  const [, setTick] = useState(0)
  const [showLogin, setShowLogin] = useState(false)

  const applyResult = useCallback((r: UsageResult) => {
    const now = Date.now()
    usageCache.data = r
    usageCache.fetchedAt = now
    setData(r)
    setCachedAt(now)
  }, [usageCache])

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    api.fetchUsage()
      .then((r) => { applyResult(r); setLoading(false) })
      .catch((e) => { setError(e instanceof Error ? e.message : String(e)); setLoading(false) })
  }, [applyResult])

  useEffect(() => {
    if (usageCache.fetchedAt === 0) load()
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
            <span className="text-lg">📊</span>
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
              暂无账号，点击下方按钮登录 Claude 账号。
            </p>
          </div>
        ) : data ? (
          data.accounts.map((a) => (
            <AccountCard key={a.id} account={a} onSwitch={handleSwitch} switching={switchingId === a.id} />
          ))
        ) : null}

        <button
          type="button"
          onClick={() => setShowLogin(true)}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-line py-2.5 text-xs text-fg-4 transition-colors hover:border-fg-5 hover:text-fg-3"
        >
          <Plus className="h-3.5 w-3.5" /> 添加 Claude 账号
        </button>
      </div>

      {showLogin && (
        <ClaudeLoginModal
          onClose={() => setShowLogin(false)}
          onSuccess={() => { setShowLogin(false); load() }}
        />
      )}
    </section>
  )
}
