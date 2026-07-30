/*
 * Central Zustand store: session list, per-session messages/todos/status, and
 * the actions that mutate them from both user intent and SSE events.
 *
 * All API calls are scoped to the active repo from the repo store.
 */

import { create } from "zustand"
import * as api from "../lib/api-client"
import type { Message, MessagePart, Session, Todo, SessionLinks, SessionLinkSummary } from "../lib/api-client"
import { isQuestionTool, isQuestionPending, getPartText } from "../lib/message-parts"
import { useRepoStore } from "./repo-store"
import { useToastStore } from "./toast-store"

function questionToastId(sessionId: string): string {
  return `question-${sessionId}`
}

function fireQuestionToast(sessionId: string, sessions: Session[]): void {
  const session = sessions.find((s) => s.id === sessionId)
  const label = session?.title || sessionId.slice(-8)
  useToastStore.getState().addToast(
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

function partKey(part: MessagePart): string | undefined {
  return part.id ?? part.callID
}

function getRepoId(): string | null {
  return useRepoStore.getState().activeRepoId
}

interface SessionState {
  sessions: Session[]
  activeSessionId: string | null
  messages: Record<string, Message[]>
  todos: Record<string, Todo[]>
  sessionStatuses: Record<string, string>
  errorReasons: Record<string, string>
  sessionLinks: Record<string, SessionLinks>
  allSessionLinks: Record<string, SessionLinkSummary>
  loadingSessions: boolean
  loadError: string | null
  sendError: string | null

  loadSessions: () => Promise<void>
  createSession: (message: string, agent?: string, model?: string, variant?: string, issueId?: string, customAgentId?: string) => Promise<Session | null>
  setActiveSession: (id: string) => Promise<void>
  refreshSessionData: (id: string) => Promise<void>
  refreshSessionLinks: (id: string) => Promise<void>
  addLink: (sessionId: string, type: "issue" | "pr", targetId: string) => Promise<boolean>
  removeLink: (sessionId: string, type: "issue" | "pr", targetId: string) => Promise<boolean>
  deleteSession: (id: string) => Promise<void>
  sendMessage: (content: string, model?: string) => Promise<void>
  abortSession: () => Promise<void>
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
  renameSession: (id: string, title: string) => Promise<void>
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  messages: {},
  todos: {},
  sessionStatuses: {},
  errorReasons: {},
  sessionLinks: {},
  allSessionLinks: {},
  loadingSessions: false,
  loadError: null,
  sendError: null,

  loadSessions: async () => {
    const repoId = getRepoId()
    if (!repoId) {
      set({ sessions: [], loadingSessions: false })
      return
    }
    set({ loadingSessions: true, loadError: null })
    try {
      const [sessions, allLinks] = await Promise.all([
        api.listSessions(repoId),
        api.getAllSessionLinks(repoId).catch(() => null),
      ])
      const next: Partial<SessionState> = { sessions, loadingSessions: false }
      if (allLinks) next.allSessionLinks = allLinks
      set(next)
    } catch (error) {
      set({
        loadingSessions: false,
        loadError:
          error instanceof Error ? error.message : "Failed to load sessions",
      })
    }
  },

  createSession: async (message, agent, model, variant, issueId, customAgentId) => {
    const repoId = getRepoId()
    if (!repoId) return null
    set({ sendError: null })
    try {
      const session = await api.createSession(repoId, message, agent, model, variant, issueId, customAgentId)
      set((state) => ({
        sessions: [
          session,
          ...state.sessions.filter((s) => s.id !== session.id),
        ],
        activeSessionId: session.id,
        messages: { ...state.messages, [session.id]: [] },
      }))
      get().setSessionStatus(session.id, "busy")
      return session
    } catch (error) {
      set({
        sendError:
          error instanceof Error ? error.message : "Failed to create session",
      })
      return null
    }
  },

  setActiveSession: async (id) => {
    const repoId = getRepoId()
    if (!repoId) return
    set({ activeSessionId: id, sendError: null })
    await get().refreshSessionData(id)
  },

  refreshSessionData: async (id) => {
    const repoId = getRepoId()
    if (!repoId) return
    const [messages, todos, status, sessionInfo, links] = await Promise.allSettled([
      api.getMessages(repoId, id),
      api.getTodos(repoId, id),
      api.getSessionStatus(repoId, id),
      api.getSession(repoId, id),
      api.getSessionLinks(repoId, id),
    ])
    set((state) => {
      const next: Partial<SessionState> = {}
      if (messages.status === "fulfilled") {
        next.messages = { ...state.messages, [id]: messages.value }
      }
      if (todos.status === "fulfilled") {
        next.todos = { ...state.todos, [id]: todos.value }
      }
      if (status.status === "fulfilled") {
        next.sessionStatuses = {
          ...state.sessionStatuses,
          [id]: status.value.type,
        }
      }
      if (sessionInfo.status === "fulfilled") {
        const fresh = sessionInfo.value
        next.sessions = state.sessions.map((s) =>
          s.id === id ? { ...s, ...fresh } : s,
        )
      }
      if (links.status === "fulfilled") {
        next.sessionLinks = { ...state.sessionLinks, [id]: links.value }
      }
      return next
    })
    if (messages.status === "fulfilled" && hasAnyPendingQuestion(messages.value)) {
      fireQuestionToast(id, get().sessions)
    }
  },

  refreshSessionLinks: async (id) => {
    const repoId = getRepoId()
    if (!repoId) return
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
  },

  addLink: async (sessionId, type, targetId) => {
    const repoId = getRepoId()
    if (!repoId) return false
    try {
      await api.addSessionLink(repoId, sessionId, type, targetId)
      await get().refreshSessionLinks(sessionId)
      return true
    } catch {
      return false
    }
  },

  removeLink: async (sessionId, type, targetId) => {
    const repoId = getRepoId()
    if (!repoId) return false
    try {
      await api.removeSessionLink(repoId, sessionId, type, targetId)
      await get().refreshSessionLinks(sessionId)
      return true
    } catch {
      return false
    }
  },

  deleteSession: async (id) => {
    const repoId = getRepoId()
    if (repoId) {
      try {
        await api.deleteSession(repoId, id)
      } catch {
        // Best-effort.
      }
    }
    set((state) => {
      const { [id]: _removedMessages, ...messages } = state.messages
      const { [id]: _removedTodos, ...todos } = state.todos
      const { [id]: _removedStatus, ...sessionStatuses } = state.sessionStatuses
      const { [id]: _removedReason, ...errorReasons } = state.errorReasons
      const { [id]: _removedLinks, ...sessionLinks } = state.sessionLinks
      const { [id]: _removedAllLinks, ...allSessionLinks } = state.allSessionLinks
      return {
        sessions: state.sessions.filter((s) => s.id !== id),
        messages,
        todos,
        sessionStatuses,
        errorReasons,
        sessionLinks,
        allSessionLinks,
        activeSessionId:
          state.activeSessionId === id ? null : state.activeSessionId,
      }
    })
  },

  sendMessage: async (content, model?) => {
    const repoId = getRepoId()
    const sessionId = get().activeSessionId
    if (!repoId || !sessionId) return
    const session = get().sessions.find((s) => s.id === sessionId)
    set({ sendError: null })
    get().setSessionStatus(sessionId, "busy")
    try {
      await api.sendMessage(repoId, sessionId, content, session?.agent, model)
    } catch (error) {
      set({
        sendError:
          error instanceof Error ? error.message : "Failed to send message",
      })
      get().setSessionStatus(sessionId, "idle")
    }
  },

  abortSession: async () => {
    const repoId = getRepoId()
    const sessionId = get().activeSessionId
    if (!repoId || !sessionId) return
    try {
      await api.abortSession(repoId, sessionId)
    } catch {
      // Ignore abort failures.
    }
    get().setSessionStatus(sessionId, "idle")
  },

  clearSessions: () => {
    set({
      sessions: [],
      activeSessionId: null,
      messages: {},
      todos: {},
      sessionStatuses: {},
      errorReasons: {},
      sessionLinks: {},
      allSessionLinks: {},
      loadError: null,
      sendError: null,
    })
  },

  updateMessage: (sessionId, message) => {
    set((state) => {
      const list = state.messages[sessionId] ?? []
      const idx = list.findIndex((m) => m.id === message.id)
      let next: Message[]
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
      }
      return { messages: { ...state.messages, [sessionId]: next } }
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
        const nextText = getPartText(existing) + delta
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
        useToastStore.getState().removeToast(questionToastId(sessionId))
        useToastStore.getState().addToast(`${label} — 完成`, "success", sessionId)
      } else if (status === "busy" && (prev === undefined || prev === "idle")) {
        useToastStore.getState().addToast(`${label} — 开始运行`, "info", sessionId)
      } else if (status === "retry") {
        useToastStore.getState().addToast(`${label} — 进入重试`, "warning", sessionId)
      } else if (status === "error") {
        const msg = reason ? `${label} — 错误: ${reason}` : `${label} — 发生错误`
        useToastStore.getState().addToast(msg, "error", sessionId)
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

  renameSession: async (id, title) => {
    const repoId = getRepoId()
    if (!repoId) return
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id ? { ...s, title } : s,
      ),
    }))
    try {
      await api.renameSession(repoId, id, title)
    } catch {
      await get().loadSessions()
    }
  },
}))
