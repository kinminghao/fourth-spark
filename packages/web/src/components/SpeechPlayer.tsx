import { Pause, Play, Settings2, Square, Volume2 } from "lucide-react"
import { useState, useSyncExternalStore } from "react"
import { speechController } from "../lib/speech/speech-controller"
import { SpeechSettingsControls } from "./SpeechSettingsControls"

const ICON_BUTTON_CLASS =
  "flex h-7 w-7 items-center justify-center rounded-md text-fg-4 transition-colors hover:bg-elevated hover:text-fg-2"

export function SpeechPlayer() {
  const snapshot = useSyncExternalStore(
    speechController.subscribe,
    speechController.getSnapshot,
    speechController.getSnapshot,
  )
  const [settingsOpen, setSettingsOpen] = useState(false)

  if (!speechController.isSupported() || snapshot.status === "idle") {
    return null
  }

  const paused = snapshot.status === "paused"

  return (
    <div
      data-testid="speech-player"
      className="fixed right-4 bottom-60 z-40 w-[min(24rem,calc(100vw-2rem))] md:bottom-48"
    >
      <div className="rounded-xl border border-line bg-surface/95 shadow-xl backdrop-blur">
        {settingsOpen && (
          <div className="max-h-[55vh] overflow-y-auto rounded-t-xl border-b border-line bg-base/60 p-3">
            <SpeechSettingsControls />
          </div>
        )}

        <div className="flex items-center gap-2 px-3 py-2">
          <Volume2 className="h-4 w-4 shrink-0 text-blue-500" />
          <div className="min-w-0 flex-1">
            <p data-testid="speech-player-preview" className="truncate text-xs text-fg-2">
              {snapshot.preview}
            </p>
            <p className="text-[10px] text-fg-5">{paused ? "已暂停" : "正在朗读"}</p>
          </div>
          <button
            type="button"
            aria-label={paused ? "继续朗读" : "暂停朗读"}
            onClick={paused ? speechController.resume : speechController.pause}
            className={ICON_BUTTON_CLASS}
          >
            {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
          </button>
          <button type="button" aria-label="停止朗读" onClick={speechController.stop} className={ICON_BUTTON_CLASS}>
            <Square className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="朗读设置"
            aria-pressed={settingsOpen}
            onClick={() => setSettingsOpen((value) => !value)}
            className={ICON_BUTTON_CLASS}
          >
            <Settings2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
