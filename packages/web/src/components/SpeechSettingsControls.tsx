import clsx from "clsx"
import { useSpeechVoices } from "../hooks/use-speech-voices"
import { speechController } from "../lib/speech/speech-controller"
import { SPEECH_RATES, useSpeechSettingsStore } from "../stores/speech-settings-store"

const SELECT_CLASS =
  "mt-1 w-full rounded-md border border-line bg-base px-3 py-2 text-xs text-fg focus:border-blue-500 focus:outline-none"

function sortVoices(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  return [...voices].sort((a, b) => a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name))
}

export function SpeechSettingsControls() {
  const voices = useSpeechVoices()
  const voiceURI = useSpeechSettingsStore((state) => state.voiceURI)
  const rate = useSpeechSettingsStore((state) => state.rate)
  const setVoiceURI = useSpeechSettingsStore((state) => state.setVoiceURI)
  const setRate = useSpeechSettingsStore((state) => state.setRate)

  if (!speechController.isSupported()) {
    return <p className="text-xs text-fg-5">当前环境不支持语音朗读</p>
  }

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="text-xs font-medium text-fg-3">音色</span>
        <select
          value={voiceURI ?? ""}
          onChange={(event) => setVoiceURI(event.target.value || null)}
          className={SELECT_CLASS}
        >
          <option value="">系统默认</option>
          {sortVoices(voices).map((voice) => (
            <option key={voice.voiceURI} value={voice.voiceURI}>
              {`${voice.name} · ${voice.lang}`}
            </option>
          ))}
        </select>
      </label>

      <div>
        <span className="text-xs font-medium text-fg-3">语速</span>
        <div className="mt-1 flex flex-wrap gap-1">
          {SPEECH_RATES.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setRate(option)}
              className={clsx(
                "rounded-md px-2.5 py-1 text-xs transition-colors",
                rate === option ? "bg-blue-600 text-white" : "border border-line text-fg-3 hover:bg-elevated",
              )}
            >
              {`${option.toFixed(1)}x`}
            </button>
          ))}
        </div>
      </div>

      <p className="text-[11px] text-fg-5">音色由系统提供；调整将在下一句生效，且仅本设备生效。</p>
    </div>
  )
}
