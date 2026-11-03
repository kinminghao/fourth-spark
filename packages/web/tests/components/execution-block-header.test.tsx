import { afterEach, describe, expect, test } from "bun:test"
import { act, type ReactElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import type { Message } from "../../src/lib/api-client"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { ExecutionBlock } = await import("../../src/components/ExecutionBlock")

type Mounted = { container: HTMLDivElement; root: Root }

const mounted: Mounted[] = []

function render(ui: ReactElement): HTMLDivElement {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(ui)
  })
  mounted.push({ container, root })
  return container
}

afterEach(() => {
  for (const { container, root } of mounted.splice(0)) {
    act(() => {
      root.unmount()
    })
    container.remove()
  }
})

describe("ExecutionBlock header", () => {
  test("shows agent, model and relative time", () => {
    const message: Message = {
      id: "msg-header",
      role: "assistant",
      parts: [{ type: "text", content: "done" }],
      info: { agent: "build", modelID: "gpt-5" },
      time: { created: Date.now() - 5 * 60_000 },
    }

    const container = render(<ExecutionBlock message={message} />)
    const time = container.querySelector<HTMLSpanElement>("span[title]")

    expect(container.textContent).toContain("build")
    expect(container.textContent).toContain("gpt-5")
    expect(time?.textContent).toBe("5分钟前")
    expect(time?.title.length).toBeGreaterThan(0)
  })

  test("omits the time when the message has none", () => {
    const message: Message = {
      id: "msg-no-time",
      role: "assistant",
      parts: [{ type: "text", content: "done" }],
      info: { agent: "build", modelID: "gpt-5" },
    }

    const container = render(<ExecutionBlock message={message} />)

    expect(container.querySelector("span[title]")).toBeNull()
  })
})
