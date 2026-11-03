import { Volume2 } from "lucide-react"
import { SpeechSettingsControls } from "./SpeechSettingsControls"

export function SpeechSettingsSection() {
  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500">
          <Volume2 className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-fg">语音朗读</h2>
          <p className="mt-0.5 text-xs text-fg-4">选择朗读音色与语速，播放时可在浮窗中随时调整。</p>
        </div>
      </div>

      <div className="mt-4">
        <SpeechSettingsControls />
      </div>
    </section>
  )
}
