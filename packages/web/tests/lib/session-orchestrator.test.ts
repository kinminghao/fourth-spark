import { describe, test, expect, beforeEach, mock } from "bun:test"

const mockWorkerStop = mock()
const mockWorkerActivate = mock()
const mockWorkerDeactivate = mock()
const mockWorkerDispatch = mock()

mock.module("../../src/lib/session-worker", () => ({
  SessionWorker: class {
    sessionId: string
    constructor(sessionId: string) { this.sessionId = sessionId }
    dispatch = mockWorkerDispatch
    stop = mockWorkerStop
    activate = mockWorkerActivate
    deactivate = mockWorkerDeactivate
    refreshOnIdle = mock()
  },
}))

const mockDispatcherStart = mock()
const mockDispatcherStop = mock()

mock.module("../../src/lib/global-event-dispatcher", () => ({
  GlobalEventDispatcher: class {
    start = mockDispatcherStart
    stop = mockDispatcherStop
  },
}))

const mockSupervisorStart = mock()
const mockSupervisorStop = mock()

mock.module("../../src/lib/session-supervisor", () => ({
  SessionSupervisor: class {
    start = mockSupervisorStart
    stop = mockSupervisorStop
    pause = mock()
    resume = mock()
  },
}))

const { orchestrator } = await import("../../src/lib/session-orchestrator")

describe("SessionOrchestrator", () => {
  beforeEach(() => {
    orchestrator.stop()
    mockDispatcherStart.mockClear()
    mockDispatcherStop.mockClear()
    mockSupervisorStart.mockClear()
    mockSupervisorStop.mockClear()
  })

  test("start initializes dispatcher and supervisor", () => {
    orchestrator.start("repo-1")

    expect(mockDispatcherStart).toHaveBeenCalledTimes(1)
    expect(mockSupervisorStart).toHaveBeenCalledTimes(1)
  })

  test("stop cleans up dispatcher and supervisor", () => {
    orchestrator.start("repo-1")
    orchestrator.stop()

    expect(mockDispatcherStop).toHaveBeenCalledTimes(1)
    expect(mockSupervisorStop).toHaveBeenCalledTimes(1)
  })

  test("start calls stop first (cleans previous state)", () => {
    orchestrator.start("repo-1")
    orchestrator.start("repo-2")

    expect(mockDispatcherStop).toHaveBeenCalledTimes(1)
    expect(mockSupervisorStop).toHaveBeenCalledTimes(1)
    expect(mockDispatcherStart).toHaveBeenCalledTimes(2)
  })

  test("stop is safe to call without start", () => {
    expect(() => orchestrator.stop()).not.toThrow()
  })

  test("activateSession is no-op without start", () => {
    expect(() => orchestrator.activateSession("ses-1")).not.toThrow()
  })

  test("deactivateSession is no-op for unknown session", () => {
    orchestrator.start("repo-1")
    expect(() => orchestrator.deactivateSession("unknown")).not.toThrow()
  })
})
