import type { SpeechProvider } from "./types"

const DEFAULT_LANG = "zh-CN"

function defaultLang(): string {
  if (typeof navigator !== "undefined" && typeof navigator.language === "string" && navigator.language.length > 0) {
    return navigator.language
  }
  return DEFAULT_LANG
}

export function createBrowserSpeechProvider(): SpeechProvider {
  return {
    isSupported(): boolean {
      return (
        typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined"
      )
    },

    speak({ text, lang, onEnd, onError }): void {
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = lang ?? defaultLang()
      utterance.rate = 1
      utterance.onend = () => {
        onEnd()
      }
      utterance.onerror = (event) => {
        onError(event.error)
      }
      window.speechSynthesis.speak(utterance)
    },

    stop(): void {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel()
      }
    },
  }
}
