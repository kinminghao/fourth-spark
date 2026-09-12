/*
 * Central Zustand store: session list, per-session messages/todos/status, and
 * the actions that mutate them from both user intent and SSE events.
 *
 * All API-calling actions receive `repoId` as an explicit parameter — no
 * cross-store getState() reads.  UI notifications go through the lightweight
 * `notify()` / `removeNotification()` abstraction (see notifications.ts).
 */

import { create } from "zustand"
import * as api from "../lib/api-client"
import type { Message, MessagePart, PromptFile, Session, Todo, SessionLinks, SessionLinkSummary } from "../lib/api-client"

type SessionFilter = "active" | "all"
import { isQuestionTool, isQuestionPending } from "../lib/message-parts"
import { notify, removeNotification } from "./notifications"

/** Monotonic version counter for stale-response discarding on loadSessions. */
let _loadVersion = 0

function questionToastId(sessionId: string): string {
  return `question-${sessionId}`
}

function fireQuestionToast(sessionId: string, sessions: Session[]): void {
  const session = sessions.find((s) => s.id === sessionId)
  const label = session?.title || sessionId.slice(-8)
  notify(
    `${label} — 等待回复`,
    "warning",
    sessionId,
    { id: questionToastId(sessionId), persistent: true },
  )
}

function hasAnyPendingQuestion(msgs: Message[]): boolean {
  for (const m of msgs) {
    if (m.parts?.some((p) => isQuestionTool(p) && isQuestionPending(p))) return true
  }
  return false
}

export const EMPTY_MESSAGES: readonly Message[] = []
export const EMPTY_TODOS: readonly Todo[] = []
export const EMPTY_QUEUE: readonly string[] = []

const _pendingQueueMarks: Record<string, number> = {}

function partKey(part: MessagePart): string | undefined {
  return part.id ?? part.callID
}

async function refreshSessionLinks(repoId: string, id: string, set: (fn: (s: SessionState) => Partial<SessionState>) => void): Promise<void> {
  try {
    const [links, allLinks] = await Promise.all([
      api.getSessionLinks(repoId, id),
      api.getAllSessionLinks(repoId).catch(() => null),
    ])
    set((state) => {
      const next: Partial<SessionState> = { sessionLinks: { ...state.sessionLinks, [id]: links } }
      if (allLinks) next.allSessionLinks = allLinks
      return next
    })
  } catch {
    // best-effort
  }
}

const MESSAGES_PAGE_SIZE = 20

interface MessagesMeta {
  total: number
  hasMore: boolean
  loading: boolean
}

interface SessionState {
  sessions: Session[]
  activeSessionId: string | null
  messages: Record<string, Message[]>
  messagesMeta: Record<string, MessagesMeta>
  todos: Record<string, Todo[]>
  sessionStatuses: Record<string, string>
  errorReasons: Record<string, string>
  queuedMessageIds: Record<string, string[]>
  sessionLinks: Record<string, SessionLinks>
  allSessionLinks: Record<string, SessionLinkSummary>
  sessionModels: Record<string, string>
  sessionVariants: Record<string, string>
  sessionFilter: SessionFilter
  sessionSearch: string
  loadingSessions: boolean
  loadError: string | null
  sendError: string | null

  setSessionModel: (sessionId: string, model: string) => void
  setSessionVariant: (sessionId: string, variant: string) => void
  setSessionFilter: (filter: SessionFilter) => void
  setSessionSearch: (search: string) => void
  toggleSessionComplete: (repoId: string, id: string) => Promise<void>
  toggleSessionPin: (repoId: string, id: string) => Promise<void>
  loadSessions: (repoId: string) => Promise<void>
  createSession: (repoId: string, message: string, agent?: string, model?: string, variant?: string, issueId?: string, customAgentId?: string, files?: PromptFile[]) => Promise<Session | null>
  setActiveSession: (repoId: string, id: string) => Promise<void>
  refreshSessionData: (repoId: string, id: string) => Promise<void>
  loadMoreMessages: (repoId: string, sessionId: string) => Promise<void>
  addLink: (repoId: string, sessionId: string, type: "issue" | "pr", targetId: string) => Promise<boolean>
  removeLink: (repoId: string, sessionId: string, type: "issue" | "pr", targetId: string) => Promise<boolean>
  sendMessage: (repoId: string, content: string, model?: string, variant?: string, files?: PromptFile[]) => Promise<boolean>
  replyQuestion: (repoId: string, answers: string[][]) => Promise<void>
  rejectQuestion: (repoId: string) => Promise<void>
  abortSession: (repoId: string) => Promise<void>
  clearSessions: () => void
  updateMessage: (sessionId: string, message: Message) => void
  updateMessagePart: (
    sessionId: string,
    messageId: string,
    part: MessagePart,
  ) => void
  appendMessagePartDelta: (
    sessionId: string,
    messageId: string,
    partId: string,
    delta: string,
  ) => void
  updateTodos: (sessionId: string, todos: Todo[]) => void
  setSessionStatus: (sessionId: string, status: string, reason?: string) => void
  bulkSetStatuses: (statuses: Record<string, string>) => void
  updateSessionInfo: (info: Partial<Session> & { id: string }) => void
  renameSession: (repoId: string, id: string, title: string) => Promise<void>
  revertToMessage: (repoId: string, sessionId: string, messageID: string) => Promise<boolean>
}

export const useSessionStore = create<SessionState>((set, get) => ({
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

  setSessionModel: (sessionId, model) => set((state) => ({
    sessionModels: { ...state.sessionModels, [sessionId]: model },
  })),
  setSessionVariant: (sessionId, variant) => set((state) => ({
    sessionVariants: { ...state.sessionVariants, [sessionId]: variant },
  })),
  setSessionFilter: (filter) => set({ sessionFilter: filter }),
  setSessionSearch: (search) => set({ sessionSearch: search }),

  toggleSessionPin: async (repoId, id) => {
    const session = get().sessions.find((s) => s.id === id)
    if (!session) return
    const pinnedAt = session.pinnedAt ? null : Date.now()
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id ? { ...s, pinnedAt: pinnedAt ?? undefined } : s,
      ),
    }))
    try {
      await api.updateSessionPinned(repoId, id, pinnedAt)
    } catch {
      await get().loadSessions(repoId)
    }
  },

  toggleSessionComplete: async (repoId, id) => {
    const session = get().sessions.find((s) => s.id === id)
    if (!session) return
    const completedAt = session.completedAt ? null : Date.now()
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id ? { ...s, completedAt: completedAt ?? undefined } : s,
      ),
    }))
    try {
      await api.updateSessionCompleted(repoId, id, completedAt)
    } catch {
      await get().loadSessions(repoId)
    }
  },

  loadSessions: async (repoId) => {
    const version = ++_loadVersion
    set({ loadingSessions: true, loadError: null })
    try {
      const [result, allLinks] = await Promise.all([
        api.listSessions(repoId, { limit: 200 }),
        api.getAllSessionLinks(repoId).catch(() => null),
      ])
      if (_loadVersion !== version) return
      const next: Partial<SessionState> = { sessions: result.items, loadingSessions: false }
      if (allLinks) next.allSessionLinks = allLinks
      set(next)
    } catch (error) {
      if (_loadVersion !== version) return
      set({
        loadingSessions: false,
        loadError:
          error instanceof Error ? error.message : "Failed to load sessions",
      })
    }
  },

  createSession: async (repoId, message, agent, model, variant, issueId, customAgentId, files) => {
    set({ sendError: null })
    try {
      const session = await api.createSession(repoId, message, agent, model, variant, issueId, customAgentId, files)
      set((state) => ({
        sessions: [
          session,
          ...state.sessions.filter((s) => s.id !== session.id),
        ],
        activeSessionId: session.id,
        messages: { ...state.messages, [session.id]: [] },
      }))
      get().setSessionStatus(session.id, "busy")
      if (issueId) {
        notify("已自动分配为处理人", "success")
      }
      return session
    } catch (error) {
      set({
        sendError:
          error instanceof Error ? error.message : "Failed to create session",
      })
      return null
    }
  },

  setActiveSession: async (repoId, id) => {
    set({ activeSessionId: id, sendError: null })
    await get().refreshSessionData(repoId, id)
  },

  refreshSessionData: async (repoId, id) => {
    const isInitialLoad = !get().messages[id] || get().messages[id].length === 0
    const msgsOpts = isInitialLoad ? { limit: MESSAGES_PAGE_SIZE } : undefined

    const [snapResult, msgsResult] = await Promise.allSettled([
      api.getSessionSnapshot(repoId, id),
      api.getMessages(repoId, id, msgsOpts),
    ])

    const snap = snapResult.status === "fulfilled" ? snapResult.value : null
    const revertMessageID = snap?.session?.revert?.messageID

    set((state) => {
      const next: Partial<SessionState> = {}
      if (snap) {
        if (snap.status) {
          next.sessionStatuses = { ...state.sessionStatuses, [id]: snap.status.type }
        }
        if (snap.todos) {
          next.todos = { ...state.todos, [id]: snap.todos }
        }
        if (snap.links) {
          next.sessionLinks = { ...state.sessionLinks, [id]: snap.links }
        }
        if (snap.session) {
          next.sessions = state.sessions.map((s) =>
            s.id === id ? { ...s, ...snap.session } : s,
          )
        }
      }
      if (msgsResult.status === "fulfilled") {
        let msgs = msgsResult.value.messages
        if (revertMessageID) {
          const cutIdx = msgs.findIndex((m) => m.id === revertMessageID)
          if (cutIdx >= 0) msgs = msgs.slice(0, cutIdx + 1)
        }
        const current = state.messages[id] ?? []
        if (msgs.length >= current.length) {
          next.messages = { ...state.messages, [id]: msgs }
        }
        next.messagesMeta = {
          ...state.messagesMeta,
          [id]: { total: Math.max(msgsResult.value.total, current.length), hasMore: msgsResult.value.hasMore, loading: false },
        }
      }
      return next
    })
    if (msgsResult.status === "fulfilled" && hasAnyPendingQuestion(msgsResult.value.messages)) {
      fireQuestionToast(id, get().sessions)
    }
  },

  loadMoreMessages: async (repoId, sessionId) => {
    const meta = get().messagesMeta[sessionId]
    if (!meta?.hasMore || meta.loading) return

    const existing = get().messages[sessionId] ?? []
    const oldestId = existing[0]?.id

    set((state) => ({
      messagesMeta: {
        ...state.messagesMeta,
        [sessionId]: { ...meta, loading: true },
      },
    }))

    try {
      const result = await api.getMessages(repoId, sessionId, {
        limit: MESSAGES_PAGE_SIZE,
        before: oldestId,
      })
      set((state) => {
        const current = state.messages[sessionId] ?? []
        return {
          messages: { ...state.messages, [sessionId]: [...result.messages, ...current] },
          messagesMeta: {
            ...state.messagesMeta,
            [sessionId]: { total: result.total, hasMore: result.hasMore, loading: false },
          },
        }
      })
    } catch {
      set((state) => ({
        messagesMeta: {
          ...state.messagesMeta,
          [sessionId]: { ...meta, loading: false },
        },
      }))
    }
  },

  addLink: async (repoId, sessionId, type, targetId) => {
    try {
      await api.addSessionLink(repoId, sessionId, type, targetId)
      await refreshSessionLinks(repoId, sessionId, set)
      return true
    } catch {
      return false
    }
  },

  removeLink: async (repoId, sessionId, type, targetId) => {
    try {
      await api.removeSessionLink(repoId, sessionId, type, targetId)
      await refreshSessionLinks(repoId, sessionId, set)
      return true
    } catch {
      return false
    }
  },

  sendMessage: async (repoId, content, model?, variant?, files?) => {
    const sessionId = get().activeSessionId
    if (!sessionId) return false
    const session = get().sessions.find((s) => s.id === sessionId)
    const wasBusy = get().sessionStatuses[sessionId] === "busy"
    set({ sendError: null })
    if (session?.completedAt) {
      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.id === sessionId ? { ...s, completedAt: undefined } : s,
        ),
      }))
    }
    if (!wasBusy) {
      get().setSessionStatus(sessionId, "busy")
    }
    try {
      await api.sendMessage(repoId, sessionId, content, session?.agent, model, variant, files)
      if (wasBusy) {
        _pendingQueueMarks[sessionId] = (_pendingQueueMarks[sessionId] || 0) + 1
      }
      return true
    } catch (error) {
      set({
        sendError:
          error instanceof Error ? error.message : "Failed to send message",
      })
      if (!wasBusy) {
        get().setSessionStatus(sessionId, "idle")
      }
      return false
    }
  },

  replyQuestion: async (repoId, answers) => {
    const sessionId = get().activeSessionId
    if (!sessionId) return
    try {
      await api.replyQuestion(repoId, sessionId, answers)
    } catch (error) {
      set({
        sendError:
          error instanceof Error ? error.message : "Failed to reply to question",
      })
    }
  },

  rejectQuestion: async (repoId) => {
    const sessionId = get().activeSessionId
    if (!sessionId) return
    try {
      await api.rejectQuestion(repoId, sessionId)
    } catch {
      // best-effort
    }
  },

  abortSession: async (repoId) => {
    const sessionId = get().activeSessionId
    if (!sessionId) return
    try {
      await api.abortSession(repoId, sessionId)
    } catch {
      // Ignore abort failures.
    }
    get().setSessionStatus(sessionId, "idle")
  },

  clearSessions: () => {
    ++_loadVersion
    for (const k of Object.keys(_pendingQueueMarks)) delete _pendingQueueMarks[k]
    set({
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
      sessionSearch: "",
      loadError: null,
      sendError: null,
    })
  },

  updateMessage: (sessionId, message) => {
    set((state) => {
      const list = state.messages[sessionId] ?? []
      const idx = list.findIndex((m) => m.id === message.id)
      let next: Message[]
      let queuedMessageIds = state.queuedMessageIds

      let messagesMeta = state.messagesMeta
      if (idx >= 0) {
        const merged: Message = { ...list[idx], ...message }
        if (
          (!message.parts || message.parts.length === 0) &&
          list[idx].parts
        ) {
          merged.parts = list[idx].parts
        }
        next = [...list]
        next[idx] = merged
      } else {
        next = [...list, message]

        const meta = messagesMeta[sessionId]
        if (meta) {
          messagesMeta = { ...messagesMeta, [sessionId]: { ...meta, total: meta.total + 1 } }
        }

        const pending = _pendingQueueMarks[sessionId] || 0
        if (message.role === "user" && pending > 0) {
          const queue = [...(queuedMessageIds[sessionId] ?? [])]
          queue.push(message.id)
          queuedMessageIds = { ...queuedMessageIds, [sessionId]: queue }
          _pendingQueueMarks[sessionId] = pending - 1
        } else if (message.role === "assistant") {
          const queue = queuedMessageIds[sessionId]
          if (queue && queue.length > 0) {
            queuedMessageIds = { ...queuedMessageIds, [sessionId]: queue.slice(1) }
          }
        }
      }
      return {
        messages: { ...state.messages, [sessionId]: next },
        messagesMeta,
        queuedMessageIds,
      }
    })
    if (message.parts?.some((p) => isQuestionTool(p) && isQuestionPending(p))) {
      fireQuestionToast(sessionId, get().sessions)
    }
  },

  updateMessagePart: (sessionId, messageId, part) => {
    set((state) => {
      const list = state.messages[sessionId] ?? []
      const idx = list.findIndex((m) => m.id === messageId)
      const base: Message =
        idx >= 0 ? list[idx] : { id: messageId, role: "assistant" }
      const parts = base.parts ? [...base.parts] : []
      const key = partKey(part)
      const existingIdx =
        key != null ? parts.findIndex((p) => partKey(p) === key) : -1

      if (existingIdx >= 0) {
        parts[existingIdx] = { ...parts[existingIdx], ...part }
      } else {
        parts.push(part)
      }
      const updated: Message = { ...base, parts }
      const next = idx >= 0 ? [...list] : [...list, updated]
      if (idx >= 0) {
        next[idx] = updated
      }

      return { messages: { ...state.messages, [sessionId]: next } }
    })
    if (isQuestionTool(part) && isQuestionPending(part)) {
      fireQuestionToast(sessionId, get().sessions)
    }
  },

  appendMessagePartDelta: (sessionId, messageId, partId, delta) => {
    set((state) => {
      const list = state.messages[sessionId] ?? []
      const idx = list.findIndex((m) => m.id === messageId)
      const base: Message =
        idx >= 0 ? list[idx] : { id: messageId, role: "assistant" }
      const parts = base.parts ? [...base.parts] : []
      const partIdx = parts.findIndex((p) => p.id === partId)
      if (partIdx >= 0) {
        const existing = parts[partIdx]
        const nextText = (existing.content ?? existing.text ?? "") + delta
        parts[partIdx] =
          existing.content != null
            ? { ...existing, content: nextText }
            : { ...existing, text: nextText }
      } else {
        parts.push({ id: partId, type: "text", text: delta })
      }
      const updated: Message = { ...base, parts }
      const next = idx >= 0 ? [...list] : [...list, updated]
      if (idx >= 0) {
        next[idx] = updated
      }
      return { messages: { ...state.messages, [sessionId]: next } }
    })
  },

  updateTodos: (sessionId, todos) => {
    set((state) => ({ todos: { ...state.todos, [sessionId]: todos } }))
  },

  updateSessionInfo: (info) => {
    set((state) => {
      const exists = state.sessions.some((s) => s.id === info.id)
      if (exists) {
        return {
          sessions: state.sessions.map((s) =>
            s.id === info.id ? { ...s, ...info } : s,
          ),
        }
      }
      // New session (e.g. child session spawned by task tool) — add it
      return { sessions: [info as Session, ...state.sessions] }
    })
  },

  setSessionStatus: (sessionId, status, reason?) => {
    const prev: string | undefined = get().sessionStatuses[sessionId]
    if (prev !== status) {
      const session = get().sessions.find((s) => s.id === sessionId)
      const label = session?.title || sessionId.slice(-8)
      if (status === "idle" && prev !== undefined && prev !== "idle") {
        removeNotification(questionToastId(sessionId))
        notify(`${label} — 完成`, "success", sessionId)
      } else if (status === "busy" && (prev === undefined || prev === "idle")) {
        notify(`${label} — 开始运行`, "info", sessionId)
      } else if (status === "retry") {
        notify(`${label} — 进入重试`, "warning", sessionId)
      } else if (status === "error") {
        const msg = reason ? `${label} — 错误: ${reason}` : `${label} — 发生错误`
        notify(msg, "error", sessionId)
      }
    }
    set((state) => {
      const errorReasons = reason
        ? { ...state.errorReasons, [sessionId]: reason }
        : status !== "error"
          ? (() => { const { [sessionId]: _, ...rest } = state.errorReasons; return rest })()
          : state.errorReasons
      return {
        sessionStatuses: { ...state.sessionStatuses, [sessionId]: status },
        errorReasons,
      }
    })
  },

  bulkSetStatuses: (statuses) => {
    set({ sessionStatuses: { ...get().sessionStatuses, ...statuses } })
  },

  renameSession: async (repoId, id, title) => {
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id ? { ...s, title } : s,
      ),
    }))
    try {
      await api.renameSession(repoId, id, title)
    } catch {
      await get().loadSessions(repoId)
    }
  },

  revertToMessage: async (repoId, sessionId, messageID) => {
    try {
      await api.revertSession(repoId, sessionId, messageID)
      await get().refreshSessionData(repoId, sessionId)
      return true
    } catch {
      return false
    }
  },
}))
