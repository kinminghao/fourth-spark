import { useEffect, useState } from "react"
import { AlertTriangle, Loader2, X } from "lucide-react"
import clsx from "clsx"
import * as api from "../../lib/api-client"
import type { AccountUsage } from "../../lib/api-client"
import { formatReset } from "./account-utils"

export function AccountSwitchModal({ onClose, onSwitched }: { onClose: () => void; onSwitched: () => void }) {
  const [accounts, setAccounts] = useState<AccountUsage[]>([])
  const [loading, setLoading] = useState(true)
  const [switching, setSwitching] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.fetchUsage()
      .then((r) => setAccounts(r.accounts))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const handleSwitch = async (id: string) => {
    setSwitching(id)
    setError(null)
    try {
      await api.switchUsageAccount(id)
      onSwitched()
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg || "切换失败")
      setSwitching(null)
    }
  }

  const fiveHour = (a: AccountUsage) => a.usage?.five_hour
  const sevenDay = (a: AccountUsage) => a.usage?.seven_day

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full flex-col rounded-t-2xl border border-line bg-surface p-4 shadow-2xl sm:mx-4 sm:max-w-lg sm:rounded-xl sm:p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex shrink-0 items-center justify-between">
          <h2 className="text-sm font-semibold text-fg">切换账号</h2>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-fg-4 transition-colors hover:bg-elevated hover:text-fg-3">
            <X className="h-4 w-4" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 fs-spin text-fg-4" />
          </div>
        ) : accounts.length === 0 ? (
          <p className="py-10 text-center text-xs text-fg-4">暂无可用账号</p>
        ) : (
          <div className="mt-3 min-h-0 flex-1 space-y-1.5 overflow-y-auto pb-[var(--safe-bottom)]">
            {accounts.map((a) => (
              <button
                key={a.id}
                type="button"
                disabled={switching !== null}
                onClick={() => { if (!a.active) void handleSwitch(a.id) }}
                className={clsx(
                  "flex w-full items-center gap-2 rounded-lg border px-3 py-2.5 text-left transition-colors sm:gap-3",
                  a.active
                    ? "border-blue-500/40 bg-blue-500/5"
                    : "border-line hover:bg-elevated",
                  switching === a.id && "opacity-60",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-xs font-medium text-fg">{a.label}</span>
                    {a.active && <span className="rounded bg-blue-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-blue-500">当前</span>}
                    {switching === a.id && <Loader2 className="h-3 w-3 fs-spin text-blue-500" />}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2 text-right sm:gap-4">
                  <div className="w-14 sm:w-20">
                    <div className="text-[10px] text-fg-5">5h</div>
                    {fiveHour(a) ? (
                      <>
                        <div className={clsx("text-xs font-medium", (fiveHour(a)!.utilization) > 80 ? "text-red-400" : "text-fg-3")}>{Math.round(fiveHour(a)!.utilization)}%</div>
                        <div className="hidden text-[9px] text-fg-5 sm:block">{fiveHour(a)!.resets_at ? formatReset(fiveHour(a)!.resets_at) : ""}</div>
                      </>
                    ) : (
                      <div className="text-[10px] text-fg-5">—</div>
                    )}
                  </div>
                  <div className="w-14 sm:w-20">
                    <div className="text-[10px] text-fg-5">7d</div>
                    {sevenDay(a) ? (
                      <>
                        <div className={clsx("text-xs font-medium", (sevenDay(a)!.utilization) > 80 ? "text-red-400" : "text-fg-3")}>{Math.round(sevenDay(a)!.utilization)}%</div>
                        <div className="hidden text-[9px] text-fg-5 sm:block">{sevenDay(a)!.resets_at ? formatReset(sevenDay(a)!.resets_at) : ""}</div>
                      </>
                    ) : (
                      <div className="text-[10px] text-fg-5">—</div>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {error && (
          <div className="mt-3 flex shrink-0 items-center gap-1.5 rounded-md border border-red-400/30 bg-red-400/5 px-3 py-2">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-400" />
            <span className="text-xs text-red-400">{error}</span>
          </div>
        )}
      </div>
    </div>
  )
}
