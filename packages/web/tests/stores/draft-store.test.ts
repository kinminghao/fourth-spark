import { beforeEach, describe, expect, test } from "bun:test"
import { useDraftStore } from "../../src/stores/draft-store"

describe("draft-store", () => {
  beforeEach(() => {
    // Reset store state between tests
    useDraftStore.setState({ drafts: {} })
  })

  test("initial state has empty drafts", () => {
    expect(useDraftStore.getState().drafts).toEqual({})
  })

  test("setDraft stores content for a session", () => {
    useDraftStore.getState().setDraft("ses-1", "hello world")
    expect(useDraftStore.getState().drafts["ses-1"]).toBe("hello world")
  })

  test("setDraft overwrites existing draft", () => {
    useDraftStore.getState().setDraft("ses-1", "first")
    useDraftStore.getState().setDraft("ses-1", "second")
    expect(useDraftStore.getState().drafts["ses-1"]).toBe("second")
  })

  test("setDraft with empty string removes draft", () => {
    useDraftStore.getState().setDraft("ses-1", "content")
    useDraftStore.getState().setDraft("ses-1", "")
    expect(useDraftStore.getState().drafts["ses-1"]).toBeUndefined()
  })

  test("setDraft with whitespace-only removes draft", () => {
    useDraftStore.getState().setDraft("ses-1", "content")
    useDraftStore.getState().setDraft("ses-1", "   ")
    expect(useDraftStore.getState().drafts["ses-1"]).toBeUndefined()
  })

  test("clearDraft removes specific session draft", () => {
    useDraftStore.getState().setDraft("ses-1", "draft 1")
    useDraftStore.getState().setDraft("ses-2", "draft 2")
    useDraftStore.getState().clearDraft("ses-1")

    expect(useDraftStore.getState().drafts["ses-1"]).toBeUndefined()
    expect(useDraftStore.getState().drafts["ses-2"]).toBe("draft 2")
  })

  test("clearDraft on non-existent session is no-op", () => {
    useDraftStore.getState().setDraft("ses-1", "content")
    useDraftStore.getState().clearDraft("ses-999")

    expect(useDraftStore.getState().drafts["ses-1"]).toBe("content")
  })

  test("multiple sessions stored independently", () => {
    const { setDraft } = useDraftStore.getState()
    setDraft("ses-1", "draft A")
    setDraft("ses-2", "draft B")
    setDraft("ses-3", "draft C")

    const { drafts } = useDraftStore.getState()
    expect(Object.keys(drafts)).toHaveLength(3)
    expect(drafts["ses-1"]).toBe("draft A")
    expect(drafts["ses-2"]).toBe("draft B")
    expect(drafts["ses-3"]).toBe("draft C")
  })
})
