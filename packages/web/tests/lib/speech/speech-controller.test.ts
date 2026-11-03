import { describe, expect, test } from "bun:test"
import { createSpeechController } from "../../../src/lib/speech/speech-controller"
import type { SpeakRequest, SpeechProvider } from "../../../src/lib/speech/types"

function createFakeProvider(supported = true) {
  const calls: SpeakRequest[] = []
  const state = { stopCount: 0, pauseCount: 0, resumeCount: 0 }
  const provider: SpeechProvider = {
    isSupported: () => supported,
    speak: (request) => {
      calls.push(request)
    },
    pause: () => {
      state.pauseCount += 1
    },
    resume: () => {
      state.resumeCount += 1
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
    expect(controller.getSnapshot()).toEqual({ status: "playing", ownerId: "owner", preview: "第一。" })
    expect(fake.calls).toHaveLength(1)
    expect(fake.calls[0].text).toBe("第一。")

    fake.calls[0].onEnd()
    expect(fake.calls).toHaveLength(2)
    expect(fake.calls[1].text).toBe("第二。")
    expect(controller.getSnapshot()).toEqual({ status: "playing", ownerId: "owner", preview: "第一。" })

    fake.calls[1].onEnd()
    expect(fake.calls).toHaveLength(3)
    expect(fake.calls[2].text).toBe("第三。")

    fake.calls[2].onEnd()
    expect(controller.getSnapshot()).toEqual({ status: "idle", ownerId: null, preview: null })
    expect(fake.calls).toHaveLength(3)
  })

  test("stop cancels the provider and returns to idle", () => {
    const fake = createFakeProvider()
    const controller = createSpeechController(fake.provider)

    controller.play("owner", "一。二。")
    controller.stop()

    expect(fake.state.stopCount).toBe(1)
    expect(controller.getSnapshot()).toEqual({ status: "idle", ownerId: null, preview: null })

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
    expect(controller.getSnapshot()).toEqual({ status: "playing", ownerId: "second", preview: "新内容。" })
    expect(fake.calls).toHaveLength(3)
    expect(fake.calls[2].text).toBe("新内容。")

    fake.calls[1].onEnd()
    expect(fake.calls).toHaveLength(3)
    expect(controller.getSnapshot()).toEqual({ status: "playing", ownerId: "second", preview: "新内容。" })
  })

  test("stopIfOwner only stops the matching owner", () => {
    const fake = createFakeProvider()
    const controller = createSpeechController(fake.provider)

    controller.play("owner-a", "一。二。")

    controller.stopIfOwner("owner-b")
    expect(fake.state.stopCount).toBe(0)
    expect(controller.getSnapshot()).toEqual({ status: "playing", ownerId: "owner-a", preview: "一。" })

    controller.stopIfOwner("owner-a")
    expect(fake.state.stopCount).toBe(1)
    expect(controller.getSnapshot()).toEqual({ status: "idle", ownerId: null, preview: null })
  })

  test("unsupported provider makes play a no-op", () => {
    const fake = createFakeProvider(false)
    const controller = createSpeechController(fake.provider)

    controller.play("owner", "不应播放。")

    expect(fake.calls).toHaveLength(0)
    expect(controller.getSnapshot()).toEqual({ status: "idle", ownerId: null, preview: null })
  })

  test("provider error returns to idle and does not advance", () => {
    const fake = createFakeProvider()
    const controller = createSpeechController(fake.provider)

    controller.play("owner", "一。二。")
    fake.calls[0].onError(new Error("boom"))

    expect(controller.getSnapshot()).toEqual({ status: "idle", ownerId: null, preview: null })

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

    controller.setOptions({ rate: 2 })
    expect(notifications).toBe(2)

    unsubscribe()
    controller.play("owner", "二次。")
    expect(notifications).toBe(2)
  })

  test("snapshot stays referentially stable until status, owner or preview changes", () => {
    const fake = createFakeProvider()
    const controller = createSpeechController(fake.provider)

    const idle = controller.getSnapshot()
    expect(controller.getSnapshot()).toBe(idle)

    controller.play("owner", "一。")
    const playing = controller.getSnapshot()
    expect(playing).not.toBe(idle)
    expect(controller.getSnapshot()).toBe(playing)

    controller.setOptions({ rate: 2 })
    expect(controller.getSnapshot()).toBe(playing)
  })

  test("pause from playing calls provider.pause and sets paused", () => {
    const fake = createFakeProvider()
    const controller = createSpeechController(fake.provider)

    controller.play("owner", "一。二。")
    controller.pause()

    expect(fake.state.pauseCount).toBe(1)
    expect(controller.getSnapshot()).toEqual({ status: "paused", ownerId: "owner", preview: "一。" })
  })

  test("resume from paused calls provider.resume and sets playing", () => {
    const fake = createFakeProvider()
    const controller = createSpeechController(fake.provider)

    controller.play("owner", "一。二。")
    controller.pause()
    controller.resume()

    expect(fake.state.resumeCount).toBe(1)
    expect(controller.getSnapshot()).toEqual({ status: "playing", ownerId: "owner", preview: "一。" })

    fake.calls[0].onEnd()
    expect(fake.calls[1].text).toBe("二。")
  })

  test("pause is ignored when idle", () => {
    const fake = createFakeProvider()
    const controller = createSpeechController(fake.provider)

    controller.pause()

    expect(fake.state.pauseCount).toBe(0)
    expect(controller.getSnapshot()).toEqual({ status: "idle", ownerId: null, preview: null })
  })

  test("resume is ignored when playing", () => {
    const fake = createFakeProvider()
    const controller = createSpeechController(fake.provider)

    controller.play("owner", "一。")
    controller.resume()

    expect(fake.state.resumeCount).toBe(0)
    expect(controller.getSnapshot()).toEqual({ status: "playing", ownerId: "owner", preview: "一。" })
  })

  test("stop works from paused", () => {
    const fake = createFakeProvider()
    const controller = createSpeechController(fake.provider)

    controller.play("owner", "一。二。")
    controller.pause()
    controller.stop()

    expect(fake.state.stopCount).toBe(1)
    expect(controller.getSnapshot()).toEqual({ status: "idle", ownerId: null, preview: null })
  })

  test("stopIfOwner works while paused", () => {
    const fake = createFakeProvider()
    const controller = createSpeechController(fake.provider)

    controller.play("owner-a", "一。二。")
    controller.pause()

    controller.stopIfOwner("owner-b")
    expect(fake.state.stopCount).toBe(0)
    expect(controller.getSnapshot()).toEqual({ status: "paused", ownerId: "owner-a", preview: "一。" })

    controller.stopIfOwner("owner-a")
    expect(fake.state.stopCount).toBe(1)
    expect(controller.getSnapshot()).toEqual({ status: "idle", ownerId: null, preview: null })
  })

  test("setOptions rate and voice are used by the next play", () => {
    const fake = createFakeProvider()
    const controller = createSpeechController(fake.provider)

    controller.setOptions({ rate: 2, voiceURI: "v1" })
    controller.play("owner", "一。")

    expect(fake.calls[0].rate).toBe(2)
    expect(fake.calls[0].voiceURI).toBe("v1")
  })

  test("play options merge into controller options and override them", () => {
    const fake = createFakeProvider()
    const controller = createSpeechController(fake.provider)

    controller.setOptions({ rate: 2, voiceURI: "v1" })
    controller.play("owner", "一。", { rate: 3, voiceURI: "v2" })

    expect(fake.calls[0].rate).toBe(3)
    expect(fake.calls[0].voiceURI).toBe("v2")

    controller.play("owner", "二。")
    expect(fake.calls[1].rate).toBe(3)
    expect(fake.calls[1].voiceURI).toBe("v2")
  })

  test("setOptions mid-playback applies to the next chunk after onEnd", () => {
    const fake = createFakeProvider()
    const controller = createSpeechController(fake.provider)

    controller.play("owner", "一。二。", { rate: 1, voiceURI: "v1" })
    expect(fake.calls[0].rate).toBe(1)
    expect(fake.calls[0].voiceURI).toBe("v1")

    controller.setOptions({ rate: 2.5, voiceURI: "v2" })
    fake.calls[0].onEnd()

    expect(fake.calls[1].rate).toBe(2.5)
    expect(fake.calls[1].voiceURI).toBe("v2")
  })

  test("preview is the first chunk truncated at 48 characters", () => {
    const fake = createFakeProvider()
    const controller = createSpeechController(fake.provider)
    const text = `${"a".repeat(60)}。`

    controller.play("owner", text)

    expect(controller.getSnapshot().preview).toBe(`${"a".repeat(48)}…`)
  })
})
