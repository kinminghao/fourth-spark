import { afterAll, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { speechController } from "../../src/lib/speech/speech-controller"

const setOptionsSpy = spyOn(speechController, "setOptions")

localStorage.clear()
const { useSpeechSettingsStore } = await import("../../src/stores/speech-settings-store")

const STORAGE_KEY = "fs-speech-settings"

function storedSettings(): unknown {
  const raw = localStorage.getItem(STORAGE_KEY)
  return raw === null ? null : JSON.parse(raw)
}

describe("speech-settings-store", () => {
  beforeEach(() => {
    localStorage.clear()
    setOptionsSpy.mockClear()
    useSpeechSettingsStore.setState({ voiceURI: null, rate: 1 })
  })

  afterAll(() => {
    setOptionsSpy.mockRestore()
  })

  test("defaults are a null voice and 1x rate", async () => {
    localStorage.clear()
    const fresh = await import("../../src/stores/speech-settings-store?defaults")

    expect(fresh.useSpeechSettingsStore.getState().voiceURI).toBeNull()
    expect(fresh.useSpeechSettingsStore.getState().rate).toBe(1)
  })

  test("setRate updates state and localStorage", () => {
    useSpeechSettingsStore.getState().setRate(2.5)

    expect(useSpeechSettingsStore.getState().rate).toBe(2.5)
    expect(storedSettings()).toEqual({ voiceURI: null, rate: 2.5 })
    expect(setOptionsSpy).toHaveBeenCalledWith({ rate: 2.5 })
  })

  test("setVoiceURI updates state and localStorage", () => {
    useSpeechSettingsStore.getState().setVoiceURI("v1")

    expect(useSpeechSettingsStore.getState().voiceURI).toBe("v1")
    expect(storedSettings()).toEqual({ voiceURI: "v1", rate: 1 })
    expect(setOptionsSpy).toHaveBeenCalledWith({ voiceURI: "v1" })
  })

  test("setters persist the full current settings", () => {
    useSpeechSettingsStore.getState().setRate(3)
    useSpeechSettingsStore.getState().setVoiceURI("v2")

    expect(storedSettings()).toEqual({ voiceURI: "v2", rate: 3 })
  })

  test("invalid stored rate loads as 1", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ voiceURI: "v9", rate: 7 }))
    const fresh = await import("../../src/stores/speech-settings-store?invalid-rate")

    expect(fresh.useSpeechSettingsStore.getState().rate).toBe(1)
    expect(fresh.useSpeechSettingsStore.getState().voiceURI).toBe("v9")
    expect(setOptionsSpy).toHaveBeenCalledWith({ voiceURI: "v9", rate: 1 })
  })

  test("malformed JSON loads defaults", async () => {
    localStorage.setItem(STORAGE_KEY, "{not valid json")
    const fresh = await import("../../src/stores/speech-settings-store?malformed")

    expect(fresh.useSpeechSettingsStore.getState().voiceURI).toBeNull()
    expect(fresh.useSpeechSettingsStore.getState().rate).toBe(1)
  })
})
