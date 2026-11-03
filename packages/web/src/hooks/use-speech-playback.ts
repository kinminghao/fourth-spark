import { useCallback, useSyncExternalStore } from "react"
import { type SpeechPlaybackStatus, speechController } from "../lib/speech/speech-controller"
import { useSpeechSettingsStore } from "../stores/speech-settings-store"

export interface SpeechPlayback {
  supported: boolean
  status: SpeechPlaybackStatus
  playing: boolean
  paused: boolean
  play: () => void
  pause: () => void
  resume: () => void
  stop: () => void
}

export function useSpeechPlayback(params: { ownerId: string; text: string; enabled?: boolean }): SpeechPlayback {
  const { ownerId, text, enabled } = params
  const snapshot = useSyncExternalStore(
    speechController.subscribe,
    speechController.getSnapshot,
    speechController.getSnapshot,
  )
  const voiceURI = useSpeechSettingsStore((state) => state.voiceURI)
  const rate = useSpeechSettingsStore((state) => state.rate)
  const supported = speechController.isSupported()
  const status: SpeechPlaybackStatus = snapshot.ownerId === ownerId ? snapshot.status : "idle"
  const playing = status === "playing"
  const paused = status === "paused"

  const play = useCallback(() => {
    if (enabled !== false && text.trim().length > 0) {
      speechController.play(ownerId, text, { voiceURI, rate })
    }
  }, [enabled, text, ownerId, voiceURI, rate])

  const pause = useCallback(() => {
    speechController.pause()
  }, [])

  const resume = useCallback(() => {
    speechController.resume()
  }, [])

  const stop = useCallback(() => {
    speechController.stop()
  }, [])

  return { supported, status, playing, paused, play, pause, resume, stop }
}
