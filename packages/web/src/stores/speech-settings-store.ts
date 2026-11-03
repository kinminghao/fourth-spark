import { create } from "zustand"
import { speechController } from "../lib/speech/speech-controller"

export const SPEECH_RATES = [1, 1.5, 2, 2.5, 3] as const
export type SpeechRate = (typeof SPEECH_RATES)[number]

export interface SpeechSettingsState {
  voiceURI: string | null
  rate: SpeechRate
  setVoiceURI(voiceURI: string | null): void
  setRate(rate: number): void
}

const STORAGE_KEY = "fs-speech-settings"

interface StoredSettings {
  voiceURI: string | null
  rate: SpeechRate
}

const DEFAULT_SETTINGS: StoredSettings = { voiceURI: null, rate: 1 }

function isSpeechRate(value: number): value is SpeechRate {
  return (SPEECH_RATES as readonly number[]).includes(value)
}

function loadSettings(): StoredSettings {
  if (typeof localStorage === "undefined") {
    return DEFAULT_SETTINGS
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) {
      return DEFAULT_SETTINGS
    }
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== "object" || parsed === null) {
      return DEFAULT_SETTINGS
    }
    const record = parsed as Record<string, unknown>
    const voiceURI = typeof record.voiceURI === "string" && record.voiceURI.length > 0 ? record.voiceURI : null
    const rate = typeof record.rate === "number" && isSpeechRate(record.rate) ? record.rate : 1
    return { voiceURI, rate }
  } catch {
    return DEFAULT_SETTINGS
  }
}

function persistSettings(settings: StoredSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    return
  }
}

const initialSettings = loadSettings()

speechController.setOptions(initialSettings)

export const useSpeechSettingsStore = create<SpeechSettingsState>((set, get) => ({
  voiceURI: initialSettings.voiceURI,
  rate: initialSettings.rate,

  setVoiceURI(voiceURI) {
    persistSettings({ voiceURI, rate: get().rate })
    set({ voiceURI })
    speechController.setOptions({ voiceURI })
  },

  setRate(rate) {
    if (!isSpeechRate(rate)) {
      return
    }
    persistSettings({ voiceURI: get().voiceURI, rate })
    set({ rate })
    speechController.setOptions({ rate })
  },
}))
