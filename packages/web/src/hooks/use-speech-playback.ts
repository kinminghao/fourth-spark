import { useCallback, useEffect, useSyncExternalStore } from "react"
import { speechController } from "../lib/speech/speech-controller"

export interface SpeechPlayback {
  supported: boolean
  playing: boolean
  toggle: () => void
}

export function useSpeechPlayback(params: { ownerId: string; text: string; enabled?: boolean }): SpeechPlayback {
  const { ownerId, text, enabled } = params
  const snapshot = useSyncExternalStore(
    speechController.subscribe,
    speechController.getSnapshot,
    speechController.getSnapshot,
  )
  const supported = speechController.isSupported()
  const playing = snapshot.status === "playing" && snapshot.ownerId === ownerId

  const toggle = useCallback(() => {
    if (playing) {
      speechController.stop()
      return
    }
    if (enabled !== false && text.trim().length > 0) {
      speechController.play(ownerId, text)
    }
  }, [playing, enabled, text, ownerId])

  useEffect(() => () => speechController.stopIfOwner(ownerId), [ownerId])

  return { supported, playing, toggle }
}
