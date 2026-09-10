import { useCallback } from "react"
import { Activity } from "lucide-react"
import { freezeMonitor } from "../../lib/freeze-monitor"

function DiagnosticsSection() {
  const handleDownload = useCallback(() => {
    const data = freezeMonitor.exportData()
    const blob = new Blob([data], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `diagnostics-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [])

  return (
    <section className="space-y-4">
      <div className="rounded-lg border border-line bg-surface p-4">
        <p className="text-sm text-fg-3">
          页面运行期间持续记录性能指标（SSE 频率、消息更新频率、内存占用等）。
          遇到卡顿时点击下方按钮下载诊断文件，发给开发者排查。
        </p>
        <button
          type="button"
          onClick={handleDownload}
          className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-500"
        >
          <Activity className="h-3.5 w-3.5" />
          下载诊断数据
        </button>
      </div>
    </section>
  )
}

export { DiagnosticsSection }
