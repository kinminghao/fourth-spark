import { useCallback, useEffect, useState } from "react"
import { Cloud, Zap } from "lucide-react"
import clsx from "clsx"
import * as api from "../../lib/api-client"
import { UsageSection } from "./UsageSection"
import { CloudPoolSection } from "./CloudPoolSection"

type AccountMode = "local" | "cloud"

export function AccountSection() {
  const [mode, setMode] = useState<AccountMode>("local")
  const [isWorker, setIsWorker] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    api.getCloudStatus()
      .then((s) => {
        const worker = s.mode === "worker"
        setIsWorker(worker)
        setMode(worker ? "cloud" : "local")
      })
      .catch(() => {})
      .finally(() => setLoaded(true))
  }, [])

  const handleStatusChange = useCallback((s: api.CloudStatus) => {
    const worker = s.mode === "worker"
    setIsWorker(worker)
    if (worker) setMode("cloud")
  }, [])

  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-lg border border-line bg-base p-1">
        <button
          type="button"
          onClick={() => { if (!isWorker) setMode("local") }}
          disabled={isWorker}
          className={clsx(
            "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            mode === "local" ? "bg-surface text-fg shadow-sm" : "text-fg-4 hover:text-fg-3",
            isWorker && mode !== "local" && "cursor-not-allowed opacity-40",
          )}
          title={isWorker ? "需先断开账号池连接" : undefined}
        >
          <Zap className="h-3.5 w-3.5" />
          本地模式
        </button>
        <button
          type="button"
          onClick={() => setMode("cloud")}
          className={clsx(
            "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            mode === "cloud" ? "bg-surface text-fg shadow-sm" : "text-fg-4 hover:text-fg-3",
          )}
        >
          <Cloud className="h-3.5 w-3.5" />
          账号池
        </button>
      </div>
      {loaded && mode === "local" && <UsageSection />}
      {loaded && mode === "cloud" && <CloudPoolSection onStatusChange={handleStatusChange} />}
    </div>
  )
}
