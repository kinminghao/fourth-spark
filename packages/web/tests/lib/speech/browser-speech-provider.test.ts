import { beforeEach, describe, expect, mock, test } from "bun:test"
import { createBrowserSpeechProvider } from "../../../src/lib/speech/browser-speech-provider"
import type { SpeakRequest } from "../../../src/lib/speech/types"

class FakeUtterance {
  text: string
  lang = ""
  rate = 1
  voice: SpeechSynthesisVoice | null = null
  onend: (() => void) | null = null
  onerror: ((event: { error: string }) => void) | null = null

  constructor(text: string) {
    this.text = text
  }
}

const voices: SpeechSynthesisVoice[] = [
  { name: "Chinese", lang: "zh-CN", voiceURI: "zh", default: false, localService: true },
  { name: "English", lang: "en-US", voiceURI: "en", default: true, localService: true },
]

const synth = {
  speak: mock(),
  cancel: mock(),
  pause: mock(),
  resume: mock(),
  getVoices: () => voices,
}

function setGlobal(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, { configurable: true, writable: true, value })
}

function installStubs(): void {
  for (const target of [globalThis, typeof window === "undefined" ? null : window]) {
    if (!target) continue
    setGlobal(target, "SpeechSynthesisUtterance", FakeUtterance)
    setGlobal(target, "speechSynthesis", synth)
  }
}

function speak(text: string, extra: Partial<SpeakRequest> = {}): FakeUtterance {
  const provider = createBrowserSpeechProvider()
  provider.speak({ text, onEnd: () => {}, onError: () => {}, ...extra })
  return synth.speak.mock.calls.at(-1)?.[0] as FakeUtterance
}

beforeEach(() => {
  installStubs()
  synth.speak.mockClear()
  synth.cancel.mockClear()
  synth.pause.mockClear()
  synth.resume.mockClear()
})

describe("createBrowserSpeechProvider", () => {
  test("uses zh-CN for Chinese text when no voice is selected", () => {
    expect(speak("你好，世界").lang).toBe("zh-CN")
  })

  test("uses the system language for non-Chinese text", () => {
    expect(speak("hello world").lang).toBe(navigator.language)
  })

  test("applies the selected voice and its language", () => {
    const utterance = speak("你好", { voiceURI: "zh" })
    expect(utterance.voice?.voiceURI).toBe("zh")
    expect(utterance.lang).toBe("zh-CN")
  })

  test("applies and clamps the requested rate", () => {
    expect(speak("hello", { rate: 2.5 }).rate).toBe(2.5)
    expect(speak("hello", { rate: 10 }).rate).toBe(4)
  })

  test("pauses, resumes and stops through speechSynthesis", () => {
    const provider = createBrowserSpeechProvider()
    provider.pause()
    provider.resume()
    provider.stop()

    expect(synth.pause).toHaveBeenCalledTimes(1)
    expect(synth.resume).toHaveBeenCalledTimes(1)
    expect(synth.cancel).toHaveBeenCalledTimes(1)
  })

  test("reports support from the current environment", () => {
    expect(createBrowserSpeechProvider().isSupported()).toBe(true)
  })
})
