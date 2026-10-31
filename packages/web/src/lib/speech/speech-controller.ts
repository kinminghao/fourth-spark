import { createBrowserSpeechProvider } from "./browser-speech-provider"
import { splitSpeechChunks, toSpeakableText } from "./speakable-text"
import type { SpeechProvider } from "./types"

export type SpeechPlaybackStatus = "idle" | "playing"

export interface SpeechPlaybackSnapshot {
  status: SpeechPlaybackStatus
  ownerId: string | null
}

export interface SpeechController {
  isSupported(): boolean
  subscribe(listener: () => void): () => void
  getSnapshot(): SpeechPlaybackSnapshot
  play(ownerId: string, text: string, options?: { lang?: string }): void
  stop(): void
  stopIfOwner(ownerId: string): void
}

export function createSpeechController(provider: SpeechProvider): SpeechController {
  let snapshot: SpeechPlaybackSnapshot = { status: "idle", ownerId: null }
  const listeners = new Set<() => void>()
  let generation = 0

  const setSnapshot = (next: SpeechPlaybackSnapshot): void => {
    if (next.status === snapshot.status && next.ownerId === snapshot.ownerId) {
      return
    }
    snapshot = next
    for (const listener of listeners) {
      listener()
    }
  }

  const fail = (token: number): void => {
    if (token !== generation) {
      return
    }
    generation += 1
    setSnapshot({ status: "idle", ownerId: null })
  }

  const speakAt = (token: number, chunks: readonly string[], lang: string | undefined, index: number): void => {
    if (token !== generation) {
      return
    }
    if (index >= chunks.length) {
      setSnapshot({ status: "idle", ownerId: null })
      return
    }
    try {
      provider.speak({
        text: chunks[index],
        lang,
        onEnd: () => speakAt(token, chunks, lang, index + 1),
        onError: () => fail(token),
      })
    } catch {
      fail(token)
    }
  }

  const stop = (): void => {
    generation += 1
    provider.stop()
    setSnapshot({ status: "idle", ownerId: null })
  }

  return {
    isSupported(): boolean {
      return provider.isSupported()
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    getSnapshot(): SpeechPlaybackSnapshot {
      return snapshot
    },

    play(ownerId: string, text: string, options?: { lang?: string }): void {
      if (!provider.isSupported()) {
        return
      }
      const speakable = toSpeakableText(text)
      if (speakable.length === 0) {
        return
      }
      const chunks = splitSpeechChunks(speakable)
      if (chunks.length === 0) {
        return
      }

      generation += 1
      const token = generation
      if (snapshot.status === "playing") {
        provider.stop()
      }
      setSnapshot({ status: "playing", ownerId })
      speakAt(token, chunks, options?.lang, 0)
    },

    stop,

    stopIfOwner(ownerId: string): void {
      if (snapshot.status === "playing" && snapshot.ownerId === ownerId) {
        stop()
      }
    },
  }
}

export const speechController: SpeechController = createSpeechController(createBrowserSpeechProvider())
