import { describe, expect, test } from "bun:test"
import { createSpeechController } from "../../../src/lib/speech/speech-controller"
import type { SpeakRequest, SpeechProvider } from "../../../src/lib/speech/types"

function createFakeProvider(supported = true) {
  const calls: SpeakRequest[] = []
  const state = { stopCount: 0 }
  const provider: SpeechProvider = {
    isSupported: () => supported,
    speak: (request) => {
      calls.push(request)
    },
    stop: () => {
      state.stopCount += 1
    },
  }
  return { provider, calls, state }
}

describe("speechController", () => {
  test("speaks chunks in order and returns to idle after the final onEnd", () => {
    const fake = createFakeProvider()
    const controller = createSpeechController(fake.provider)

    controller.play("owner", "第一。第二。第三。")
    expect(controller.getSnapshot()).toEqual({ status: "playing", ownerId: "owner" })
    expect(fake.calls).toHaveLength(1)
    expect(fake.calls[0].text).toBe("第一。")

    fake.calls[0].onEnd()
    expect(fake.calls).toHaveLength(2)
    expect(fake.calls[1].text).toBe("第二。")

    fake.calls[1].onEnd()
    expect(fake.calls).toHaveLength(3)
    expect(fake.calls[2].text).toBe("第三。")

    fake.calls[2].onEnd()
    expect(controller.getSnapshot()).toEqual({ status: "idle", ownerId: null })
    expect(fake.calls).toHaveLength(3)
  })

  test("stop cancels the provider and returns to idle", () => {
    const fake = createFakeProvider()
    const controller = createSpeechController(fake.provider)

    controller.play("owner", "一。二。")
    controller.stop()

    expect(fake.state.stopCount).toBe(1)
    expect(controller.getSnapshot()).toEqual({ status: "idle", ownerId: null })

    fake.calls[0].onEnd()
    expect(fake.calls).toHaveLength(1)
  })

  test("playing for another owner cancels the current playback and starts the new text", () => {
    const fake = createFakeProvider()
    const controller = createSpeechController(fake.provider)

    controller.play("first", "一。二。")
    fake.calls[0].onEnd()
    expect(fake.calls).toHaveLength(2)

    controller.play("second", "新内容。")
    expect(fake.state.stopCount).toBe(1)
    expect(controller.getSnapshot()).toEqual({ status: "playing", ownerId: "second" })
    expect(fake.calls).toHaveLength(3)
    expect(fake.calls[2].text).toBe("新内容。")

    fake.calls[1].onEnd()
    expect(fake.calls).toHaveLength(3)
    expect(controller.getSnapshot()).toEqual({ status: "playing", ownerId: "second" })
  })

  test("stopIfOwner only stops the matching owner", () => {
    const fake = createFakeProvider()
    const controller = createSpeechController(fake.provider)

    controller.play("owner-a", "一。二。")

    controller.stopIfOwner("owner-b")
    expect(fake.state.stopCount).toBe(0)
    expect(controller.getSnapshot()).toEqual({ status: "playing", ownerId: "owner-a" })

    controller.stopIfOwner("owner-a")
    expect(fake.state.stopCount).toBe(1)
    expect(controller.getSnapshot()).toEqual({ status: "idle", ownerId: null })
  })

  test("unsupported provider makes play a no-op", () => {
    const fake = createFakeProvider(false)
    const controller = createSpeechController(fake.provider)

    controller.play("owner", "不应播放。")

    expect(fake.calls).toHaveLength(0)
    expect(controller.getSnapshot()).toEqual({ status: "idle", ownerId: null })
  })

  test("provider error returns to idle and does not advance", () => {
    const fake = createFakeProvider()
    const controller = createSpeechController(fake.provider)

    controller.play("owner", "一。二。")
    fake.calls[0].onError(new Error("boom"))

    expect(controller.getSnapshot()).toEqual({ status: "idle", ownerId: null })

    fake.calls[0].onEnd()
    expect(fake.calls).toHaveLength(1)
  })

  test("subscribe only notifies on actual state changes", () => {
    const fake = createFakeProvider()
    const controller = createSpeechController(fake.provider)
    let notifications = 0
    const unsubscribe = controller.subscribe(() => {
      notifications += 1
    })

    controller.play("owner", "一次。")
    expect(notifications).toBe(1)

    controller.stop()
    expect(notifications).toBe(2)

    controller.stop()
    expect(notifications).toBe(2)

    unsubscribe()
    controller.play("owner", "二次。")
    expect(notifications).toBe(2)
  })
})
