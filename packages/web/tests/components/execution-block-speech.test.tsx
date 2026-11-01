import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { act, type ReactElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import type { Message } from "../../src/lib/api-client"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

class FakeUtterance {
  text: string
  lang = ""
  rate = 1
  onend: (() => void) | null = null
  onerror: (() => void) | null = null

  constructor(text: string) {
    this.text = text
  }
}

const synth = {
  speak: mock(),
  cancel: mock(),
  getVoices: () => [],
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

const { ExecutionBlock } = await import("../../src/components/ExecutionBlock")

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

beforeEach(() => {
  synth.speak.mockClear()
  synth.cancel.mockClear()
  synth.addEventListener.mockClear()
  synth.removeEventListener.mockClear()
})

afterEach(() => {
  for (const { container, root } of mounted.splice(0)) {
    act(() => {
      root.unmount()
    })
    container.remove()
  }
})

describe("ExecutionBlock speech control", () => {
  test("toggles playback for an assistant text message", () => {
    const message: Message = {
      id: "msg-speak",
      role: "assistant",
      parts: [{ type: "text", content: "Hello there, this is a reply." }],
      info: { agent: "build", modelID: "gpt-5" },
    }

    const { container } = render(<ExecutionBlock message={message} />)

    const button = findButton(container, "朗读回复")
    expect(button).not.toBeNull()

    act(() => {
      button?.click()
    })

    expect(synth.speak).toHaveBeenCalledTimes(1)
    const stopButton = findButton(container, "停止朗读")
    expect(stopButton).not.toBeNull()

    act(() => {
      stopButton?.click()
    })

    expect(synth.cancel).toHaveBeenCalledTimes(1)
    expect(findButton(container, "朗读回复")).not.toBeNull()
  })

  test("renders no control for thinking-only or tool-only messages", () => {
    const messages: Message[] = [
      {
        id: "msg-thinking",
        role: "assistant",
        parts: [{ type: "thinking", content: "internal reasoning" }],
        info: { agent: "build" },
      },
      {
        id: "msg-tool",
        role: "assistant",
        parts: [{ type: "tool", tool: "bash", state: { status: "completed", output: "done" } }],
        info: { agent: "build" },
      },
    ]

    for (const message of messages) {
      const { container } = render(<ExecutionBlock message={message} />)
      expect(findButton(container, "朗读回复")).toBeNull()
    }
  })

  test("disables the control while streaming", () => {
    const message: Message = {
      id: "msg-streaming",
      role: "assistant",
      parts: [{ type: "text", content: "Partial reply in progress" }],
      info: { agent: "build" },
    }

    const { container } = render(<ExecutionBlock message={message} isStreaming />)

    const button = findButton(container, "朗读回复")
    expect(button).not.toBeNull()
    expect(button?.disabled).toBe(true)
    expect(button?.title).toBe("回复完成后可朗读")
  })

  test("renders no control for user messages", () => {
    const message: Message = {
      id: "msg-user",
      role: "user",
      parts: [{ type: "text", content: "Please read this" }],
    }

    const { container } = render(<ExecutionBlock message={message} />)

    expect(findButton(container, "朗读回复")).toBeNull()
    expect(findButton(container, "停止朗读")).toBeNull()
  })

  test("renders no control when the text is only a fenced code block", () => {
    const message: Message = {
      id: "msg-code",
      role: "assistant",
      parts: [{ type: "text", content: "```ts\nconst answer = 42\n```" }],
      info: { agent: "build" },
    }

    const { container } = render(<ExecutionBlock message={message} />)

    expect(findButton(container, "朗读回复")).toBeNull()
  })

  test("speaks prose only, skipping code blocks and thinking", () => {
    const message: Message = {
      id: "msg-mixed",
      role: "assistant",
      parts: [
        { type: "text", content: "Intro **bold** text.\n\n```ts\nconst secret = 42\n```\n\nOutro." },
        { type: "thinking", content: "hidden reasoning" },
      ],
      info: { agent: "build" },
    }

    const { container } = render(<ExecutionBlock message={message} />)

    act(() => {
      findButton(container, "朗读回复")?.click()
    })

    const utterance = synth.speak.mock.calls[0]?.[0] as FakeUtterance
    expect(utterance.text).toBe("Intro bold text.")
    expect(utterance.text).not.toContain("secret")
    expect(utterance.text).not.toContain("hidden")
  })

  test("hides the control when speech synthesis is unsupported", () => {
    const message: Message = {
      id: "msg-unsupported",
      role: "assistant",
      parts: [{ type: "text", content: "Cannot be spoken here" }],
      info: { agent: "build" },
    }

    setGlobal(globalThis, "SpeechSynthesisUtterance", undefined)
    if (typeof window !== "undefined") {
      setGlobal(window, "SpeechSynthesisUtterance", undefined)
    }
    try {
      const { container } = render(<ExecutionBlock message={message} />)
      expect(findButton(container, "朗读回复")).toBeNull()
    } finally {
      setGlobal(globalThis, "SpeechSynthesisUtterance", FakeUtterance)
      if (typeof window !== "undefined") {
        setGlobal(window, "SpeechSynthesisUtterance", FakeUtterance)
      }
    }
  })

  test("keeps a single active player across messages", () => {
    const first: Message = {
      id: "msg-first",
      role: "assistant",
      parts: [{ type: "text", content: "First reply." }],
      info: { agent: "build" },
    }
    const second: Message = {
      id: "msg-second",
      role: "assistant",
      parts: [{ type: "text", content: "Second reply." }],
      info: { agent: "build" },
    }

    const { container } = render(
      <div>
        <ExecutionBlock message={first} />
        <ExecutionBlock message={second} />
      </div>,
    )

    const [firstButton, secondButton] = container.querySelectorAll<HTMLButtonElement>('button[aria-label="朗读回复"]')
    act(() => {
      firstButton.click()
    })
    expect(findButton(container, "停止朗读")).not.toBeNull()

    act(() => {
      secondButton.click()
    })
    expect(container.querySelectorAll('button[aria-label="停止朗读"]')).toHaveLength(1)
    expect(findButton(container, "朗读回复")).not.toBeNull()
    expect(synth.cancel).toHaveBeenCalledTimes(1)
  })

  test("stops playback when the message unmounts", () => {
    const message: Message = {
      id: "msg-unmount",
      role: "assistant",
      parts: [{ type: "text", content: "Stop when leaving the session." }],
      info: { agent: "build" },
    }

    const view = render(<ExecutionBlock message={message} />)
    act(() => {
      findButton(view.container, "朗读回复")?.click()
    })
    expect(findButton(view.container, "停止朗读")).not.toBeNull()

    act(() => {
      view.root.unmount()
    })
    view.container.remove()
    mounted.pop()

    expect(synth.cancel).toHaveBeenCalledTimes(1)
  })
})
