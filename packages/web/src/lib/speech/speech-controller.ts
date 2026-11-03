import { createBrowserSpeechProvider } from "./browser-speech-provider"
import { splitSpeechChunks, toSpeakableText } from "./speakable-text"
import type { SpeechProvider } from "./types"

export type SpeechPlaybackStatus = "idle" | "playing" | "paused"

export interface SpeechPlaybackSnapshot {
  status: SpeechPlaybackStatus
  ownerId: string | null
  preview: string | null
}

export interface SpeechOptions {
  lang?: string
  voiceURI?: string | null
  rate?: number
}

export interface SpeechController {
  isSupported(): boolean
  subscribe(listener: () => void): () => void
  getSnapshot(): SpeechPlaybackSnapshot
  setOptions(options: SpeechOptions): void
  play(ownerId: string, text: string, options?: SpeechOptions): void
  pause(): void
  resume(): void
  stop(): void
  stopIfOwner(ownerId: string): void
}

const IDLE_SNAPSHOT: SpeechPlaybackSnapshot = { status: "idle", ownerId: null, preview: null }
const PREVIEW_LIMIT = 48

function buildPreview(chunk: string): string {
  const trimmed = chunk.trim()
  return trimmed.length > PREVIEW_LIMIT ? `${trimmed.slice(0, PREVIEW_LIMIT)}…` : trimmed
}

export function createSpeechController(provider: SpeechProvider): SpeechController {
  let snapshot: SpeechPlaybackSnapshot = IDLE_SNAPSHOT
  let options: SpeechOptions = {}
  const listeners = new Set<() => void>()
  let generation = 0

  const setSnapshot = (next: SpeechPlaybackSnapshot): void => {
    if (next.status === snapshot.status && next.ownerId === snapshot.ownerId && next.preview === snapshot.preview) {
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
    setSnapshot(IDLE_SNAPSHOT)
  }

  const speakAt = (token: number, chunks: readonly string[], index: number): void => {
    if (token !== generation) {
      return
    }
    if (index >= chunks.length) {
      setSnapshot(IDLE_SNAPSHOT)
      return
    }
    try {
      provider.speak({
        text: chunks[index],
        lang: options.lang,
        voiceURI: options.voiceURI,
        rate: options.rate,
        onEnd: () => speakAt(token, chunks, index + 1),
        onError: () => fail(token),
      })
    } catch {
      fail(token)
    }
  }

  const stop = (): void => {
    generation += 1
    provider.stop()
    setSnapshot(IDLE_SNAPSHOT)
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

    setOptions(next: SpeechOptions): void {
      options = { ...options, ...next }
    },

    play(ownerId: string, text: string, playOptions?: SpeechOptions): void {
      if (playOptions) {
        options = { ...options, ...playOptions }
      }
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
      if (snapshot.status === "playing" || snapshot.status === "paused") {
        provider.stop()
      }
      setSnapshot({ status: "playing", ownerId, preview: buildPreview(chunks[0]) })
      speakAt(token, chunks, 0)
    },

    pause(): void {
      if (snapshot.status !== "playing") {
        return
      }
      try {
        provider.pause()
      } catch {
        return
      }
      setSnapshot({ status: "paused", ownerId: snapshot.ownerId, preview: snapshot.preview })
    },

    resume(): void {
      if (snapshot.status !== "paused" || snapshot.ownerId === null) {
        return
      }
      try {
        provider.resume()
      } catch {
        return
      }
      setSnapshot({ status: "playing", ownerId: snapshot.ownerId, preview: snapshot.preview })
    },

    stop,

    stopIfOwner(ownerId: string): void {
      const active = snapshot.status === "playing" || snapshot.status === "paused"
      if (active && snapshot.ownerId === ownerId) {
        stop()
      }
    },
  }
}

export const speechController: SpeechController = createSpeechController(createBrowserSpeechProvider())
