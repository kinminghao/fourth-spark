import type { SpeechProvider } from "./types"

const DEFAULT_LANG = "zh-CN"
const MIN_RATE = 0.5
const MAX_RATE = 4

const CJK = /[\u3400-\u9fff]/

function defaultLang(text: string): string {
  if (CJK.test(text)) {
    return DEFAULT_LANG
  }
  if (typeof navigator !== "undefined" && typeof navigator.language === "string" && navigator.language.length > 0) {
    return navigator.language
  }
  return DEFAULT_LANG
}

function clampRate(rate: number): number {
  return Math.min(MAX_RATE, Math.max(MIN_RATE, rate))
}

function availableVoices(): SpeechSynthesisVoice[] {
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    return window.speechSynthesis.getVoices()
  }
  return []
}

function speechSynthesisAvailable(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window
}

export function createBrowserSpeechProvider(): SpeechProvider {
  return {
    isSupported(): boolean {
      return (
        typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined"
      )
    },

    speak({ text, lang, voiceURI, rate, onEnd, onError }): void {
      const utterance = new SpeechSynthesisUtterance(text)
      const voice = voiceURI ? availableVoices().find((item) => item.voiceURI === voiceURI) : undefined
      if (voice) {
        utterance.voice = voice
      }
      utterance.lang = voice?.lang || lang || defaultLang(text)
      utterance.rate = clampRate(rate ?? 1)
      utterance.onend = () => {
        onEnd()
      }
      utterance.onerror = (event) => {
        onError(event.error)
      }
      window.speechSynthesis.speak(utterance)
    },

    pause(): void {
      if (speechSynthesisAvailable()) {
        window.speechSynthesis.pause()
      }
    },

    resume(): void {
      if (speechSynthesisAvailable()) {
        window.speechSynthesis.resume()
      }
    },

    stop(): void {
      if (speechSynthesisAvailable()) {
        window.speechSynthesis.cancel()
      }
    },
  }
}
