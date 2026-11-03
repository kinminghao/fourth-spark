import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { act, type ReactElement } from "react"
import { createRoot, type Root } from "react-dom/client"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

class FakeUtterance {
  text: string
  lang = ""
  rate = 1
  voice: SpeechSynthesisVoice | null = null
  onend: (() => void) | null = null
  onerror: (() => void) | null = null

  constructor(text: string) {
    this.text = text
  }
}

const fakeVoice = {
  name: "Test Voice",
  lang: "zh-CN",
  voiceURI: "test-voice",
  default: false,
  localService: true,
} as SpeechSynthesisVoice

const synth = {
  speak: mock(),
  cancel: mock(),
  pause: mock(),
  resume: mock(),
  getVoices: () => [fakeVoice],
  addEventListener: mock(),
  removeEventListener: mock(),
}

function setGlobal(target: object, key: string, value: unknown) {
  Object.defineProperty(target, key, { configurable: true, writable: true, value })
}

setGlobal(globalThis, "SpeechSynthesisUtterance", FakeUtterance)
setGlobal(globalThis, "speechSynthesis", synth)
if (typeof window !== "undefined") {
  setGlobal(window, "SpeechSynthesisUtterance", FakeUtterance)
  setGlobal(window, "speechSynthesis", synth)
}

if (typeof localStorage !== "undefined") {
  localStorage.clear()
}

const { SpeechPlayer } = await import("../../src/components/SpeechPlayer")
const { speechController } = await import("../../src/lib/speech/speech-controller")
const { useSpeechSettingsStore } = await import("../../src/stores/speech-settings-store")

type Mounted = { container: HTMLDivElement; root: Root }

const mounted: Mounted[] = []

function render(ui: ReactElement): Mounted {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(ui)
  })
  const view = { container, root }
  mounted.push(view)
  return view
}

function findButton(container: HTMLElement, label: string) {
  return container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
}

function readStoredSettings(): Record<string, unknown> {
  return JSON.parse(localStorage.getItem("fs-speech-settings") ?? "{}") as Record<string, unknown>
}

function startPlayback(): void {
  act(() => {
    speechController.play("msg-1", "第一句。第二句。")
  })
}

beforeEach(() => {
  act(() => {
    speechController.stop()
  })
  synth.speak.mockClear()
  synth.cancel.mockClear()
  synth.pause.mockClear()
  synth.resume.mockClear()
  synth.addEventListener.mockClear()
  synth.removeEventListener.mockClear()
  localStorage.clear()
  useSpeechSettingsStore.setState({ voiceURI: null, rate: 1 })
})

afterEach(() => {
  for (const { container, root } of mounted.splice(0)) {
    act(() => {
      root.unmount()
    })
    container.remove()
  }
  act(() => {
    speechController.stop()
  })
})

describe("SpeechPlayer", () => {
  test("shows the preview and supports pause and resume", () => {
    startPlayback()
    const { container } = render(<SpeechPlayer />)

    expect(container.textContent).toContain("第一句。")
    expect(container.textContent).toContain("正在朗读")

    act(() => {
      findButton(container, "暂停朗读")?.click()
    })

    expect(synth.pause).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain("已暂停")
    expect(findButton(container, "继续朗读")).not.toBeNull()

    act(() => {
      findButton(container, "继续朗读")?.click()
    })

    expect(synth.resume).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain("正在朗读")
    expect(findButton(container, "暂停朗读")).not.toBeNull()
  })

  test("opens settings and persists the rate and voice", () => {
    startPlayback()
    const { container } = render(<SpeechPlayer />)

    expect(container.querySelector("select")).toBeNull()

    act(() => {
      findButton(container, "朗读设置")?.click()
    })

    const select = container.querySelector<HTMLSelectElement>("select")
    expect(select).not.toBeNull()
    expect(select?.textContent).toContain("Test Voice · zh-CN")

    const rateButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.trim() === "2.5x",
    )
    expect(rateButton).not.toBeUndefined()

    act(() => {
      rateButton?.click()
    })

    expect(readStoredSettings().rate).toBe(2.5)

    act(() => {
      if (select) {
        select.value = "test-voice"
        select.dispatchEvent(new Event("change", { bubbles: true }))
      }
    })

    expect(readStoredSettings().voiceURI).toBe("test-voice")
  })

  test("stops playback and disappears", () => {
    startPlayback()
    const { container } = render(<SpeechPlayer />)

    expect(findButton(container, "停止朗读")).not.toBeNull()

    act(() => {
      findButton(container, "停止朗读")?.click()
    })

    expect(synth.cancel).toHaveBeenCalledTimes(1)
    expect(findButton(container, "停止朗读")).toBeNull()
    expect(container.textContent).toBe("")
  })
})
