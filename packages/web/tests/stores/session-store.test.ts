import { describe, expect, test, mock, beforeEach } from "bun:test"

// Mock api-client
const mockListSessions = mock(() => Promise.resolve({ items: [], total: 0 }))
const mockCreateSession = mock(() => Promise.resolve({ id: "ses-1", title: "New" }))
const mockGetSessionSnapshot = mock(() => Promise.resolve({}))
const mockGetMessages = mock(() => Promise.resolve({ messages: [], total: 0, hasMore: false }))
const mockGetSessionLinks = mock(() => Promise.resolve({}))
const mockGetAllSessionLinks = mock(() => Promise.resolve({}))
const mockSendMessage = mock(() => Promise.resolve())
const mockReplyQuestion = mock(() => Promise.resolve())
const mockRejectQuestion = mock(() => Promise.resolve())
const mockAbortSession = mock(() => Promise.resolve())
const mockRenameSession = mock(() => Promise.resolve())
const mockUpdateSessionPinned = mock(() => Promise.resolve())
const mockUpdateSessionCompleted = mock(() => Promise.resolve())
const mockAddSessionLink = mock(() => Promise.resolve())
const mockRemoveSessionLink = mock(() => Promise.resolve())
const mockRevertSession = mock(() => Promise.resolve())

mock.module("../../src/lib/api-client", () => ({
  listSessions: mockListSessions,
  createSession: mockCreateSession,
  getSessionSnapshot: mockGetSessionSnapshot,
  getMessages: mockGetMessages,
  getSessionLinks: mockGetSessionLinks,
  getAllSessionLinks: mockGetAllSessionLinks,
  sendMessage: mockSendMessage,
  replyQuestion: mockReplyQuestion,
  rejectQuestion: mockRejectQuestion,
  abortSession: mockAbortSession,
  renameSession: mockRenameSession,
  updateSessionPinned: mockUpdateSessionPinned,
  updateSessionCompleted: mockUpdateSessionCompleted,
  addSessionLink: mockAddSessionLink,
  removeSessionLink: mockRemoveSessionLink,
  revertSession: mockRevertSession,
}))

// Mock message-parts
mock.module("../../src/lib/message-parts", () => ({
  isQuestionTool: () => false,
  isQuestionPending: () => false,
}))

// Mock notifications
mock.module("../../src/stores/notifications", () => ({
  notify: mock(),
  removeNotification: mock(),
}))

const { useSessionStore } = await import("../../src/stores/session-store")

function resetStore() {
  useSessionStore.setState({
    sessions: [],
    activeSessionId: null,
    messages: {},
    messagesMeta: {},
    todos: {},
    sessionStatuses: {},
    errorReasons: {},
    queuedMessageIds: {},
    sessionLinks: {},
    allSessionLinks: {},
    sessionModels: {},
    sessionVariants: {},
    sessionFilter: "active",
    sessionSearch: "",
    loadingSessions: false,
    loadError: null,
    sendError: null,
  })
}

describe("session-store — synchronous actions", () => {
  beforeEach(resetStore)

  test("initial state", () => {
    const s = useSessionStore.getState()
    expect(s.sessions).toEqual([])
    expect(s.activeSessionId).toBeNull()
    expect(s.sessionFilter).toBe("active")
    expect(s.sessionSearch).toBe("")
  })

  test("setSessionFilter", () => {
    useSessionStore.getState().setSessionFilter("all")
    expect(useSessionStore.getState().sessionFilter).toBe("all")
  })

  test("setSessionSearch", () => {
    useSessionStore.getState().setSessionSearch("hello")
    expect(useSessionStore.getState().sessionSearch).toBe("hello")
  })

  test("setSessionModel", () => {
    useSessionStore.getState().setSessionModel("ses-1", "claude-4")
    expect(useSessionStore.getState().sessionModels["ses-1"]).toBe("claude-4")
  })

  test("setSessionVariant", () => {
    useSessionStore.getState().setSessionVariant("ses-1", "max")
    expect(useSessionStore.getState().sessionVariants["ses-1"]).toBe("max")
  })

  test("clearSessions resets all state", () => {
    useSessionStore.setState({
      sessions: [{ id: "ses-1" } as any],
      activeSessionId: "ses-1",
      messages: { "ses-1": [{ id: "msg-1", role: "user" }] as any },
      todos: { "ses-1": [{ id: "todo-1" }] as any },
      sessionStatuses: { "ses-1": "busy" },
      sessionSearch: "search",
    })

    useSessionStore.getState().clearSessions()

    const s = useSessionStore.getState()
    expect(s.sessions).toEqual([])
    expect(s.activeSessionId).toBeNull()
    expect(s.messages).toEqual({})
    expect(s.todos).toEqual({})
    expect(s.sessionStatuses).toEqual({})
    expect(s.sessionSearch).toBe("")
  })

  test("updateTodos stores todos for session", () => {
    const todos = [{ id: "t1", content: "Fix bug", status: "pending" }] as any
    useSessionStore.getState().updateTodos("ses-1", todos)
    expect(useSessionStore.getState().todos["ses-1"]).toEqual(todos)
  })

  test("updateSessionInfo updates existing session", () => {
    useSessionStore.setState({
      sessions: [{ id: "ses-1", title: "Old" } as any],
    })

    useSessionStore.getState().updateSessionInfo({ id: "ses-1", title: "New" })
    expect(useSessionStore.getState().sessions[0].title).toBe("New")
  })

  test("updateSessionInfo adds new session if not found", () => {
    useSessionStore.setState({ sessions: [] })

    useSessionStore.getState().updateSessionInfo({ id: "ses-new", title: "Child" } as any)
    expect(useSessionStore.getState().sessions).toHaveLength(1)
    expect(useSessionStore.getState().sessions[0].id).toBe("ses-new")
  })

  test("setSessionStatus tracks status", () => {
    useSessionStore.getState().setSessionStatus("ses-1", "busy")
    expect(useSessionStore.getState().sessionStatuses["ses-1"]).toBe("busy")

    useSessionStore.getState().setSessionStatus("ses-1", "idle")
    expect(useSessionStore.getState().sessionStatuses["ses-1"]).toBe("idle")
  })

  test("setSessionStatus with error reason", () => {
    useSessionStore.getState().setSessionStatus("ses-1", "error", "rate limited")
    expect(useSessionStore.getState().errorReasons["ses-1"]).toBe("rate limited")
  })

  test("setSessionStatus clears error reason on non-error status", () => {
    useSessionStore.getState().setSessionStatus("ses-1", "error", "something broke")
    useSessionStore.getState().setSessionStatus("ses-1", "idle")
    expect(useSessionStore.getState().errorReasons["ses-1"]).toBeUndefined()
  })

  test("bulkSetStatuses merges multiple statuses", () => {
    useSessionStore.getState().bulkSetStatuses({
      "ses-1": "busy",
      "ses-2": "idle",
    })
    const statuses = useSessionStore.getState().sessionStatuses
    expect(statuses["ses-1"]).toBe("busy")
    expect(statuses["ses-2"]).toBe("idle")
  })
})

describe("session-store — updateMessage", () => {
  beforeEach(resetStore)

  test("appends new message", () => {
    const msg = { id: "msg-1", role: "user", parts: [] } as any
    useSessionStore.getState().updateMessage("ses-1", msg)

    const msgs = useSessionStore.getState().messages["ses-1"]
    expect(msgs).toHaveLength(1)
    expect(msgs[0].id).toBe("msg-1")
  })

  test("merges existing message", () => {
    useSessionStore.setState({
      messages: {
        "ses-1": [{ id: "msg-1", role: "assistant", parts: [{ id: "p1", type: "text", content: "hello" }] }] as any,
      },
    })

    useSessionStore.getState().updateMessage("ses-1", { id: "msg-1", role: "assistant" } as any)

    const msgs = useSessionStore.getState().messages["ses-1"]
    expect(msgs).toHaveLength(1)
    // Existing parts preserved when update has no parts
    expect(msgs[0].parts).toHaveLength(1)
  })
})

describe("session-store — appendMessagePartDelta", () => {
  beforeEach(resetStore)

  test("appends delta to existing part", () => {
    useSessionStore.setState({
      messages: {
        "ses-1": [{
          id: "msg-1",
          role: "assistant",
          parts: [{ id: "p1", type: "text", text: "hel" }],
        }] as any,
      },
    })

    useSessionStore.getState().appendMessagePartDelta("ses-1", "msg-1", "p1", "lo")

    const parts = useSessionStore.getState().messages["ses-1"][0].parts!
    expect(parts[0].text).toBe("hello")
  })

  test("creates new part if partId not found", () => {
    useSessionStore.setState({
      messages: { "ses-1": [{ id: "msg-1", role: "assistant", parts: [] }] as any },
    })

    useSessionStore.getState().appendMessagePartDelta("ses-1", "msg-1", "p-new", "start")

    const parts = useSessionStore.getState().messages["ses-1"][0].parts!
    expect(parts).toHaveLength(1)
    expect(parts[0].id).toBe("p-new")
    expect(parts[0].text).toBe("start")
  })
})


