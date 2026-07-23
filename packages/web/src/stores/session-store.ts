/*
 * Central Zustand store: session list, per-session messages/todos/status, and
 * the actions that mutate them from both user intent and SSE events.
 *
 * All API calls are scoped to the active repo from the repo store.
 */

import { create } from "zustand"
import * as api from "../lib/api-client"
import type { Message, MessagePart, Session, Todo } from "../lib/api-client"
import { useRepoStore } from "./repo-store"

export const EMPTY_MESSAGES: readonly Message[] = []
export const EMPTY_TODOS: readonly Todo[] = []

function mapSet<K, V>(map: Map<K, V>, key: K, value: V): Map<K, V> {
  const next = new Map(map)
  next.set(key, value)
  return next
}

function mapDelete<K, V>(map: Map<K, V>, key: K): Map<K, V> {
  const next = new Map(map)
  next.delete(key)
  return next
}

function partKey(part: MessagePart): string | undefined {
  return part.id ?? part.callID
}

function getRepoId(): string | null {
  return useRepoStore.getState().activeRepoId
}

interface SessionState {
  sessions: Session[]
  activeSessionId: string | null
  messages: Map<string, Message[]>
  todos: Map<string, Todo[]>
  sessionStatuses: Map<string, string>
  loadingSessions: boolean
  loadError: string | null
  sendError: string | null

  loadSessions: () => Promise<void>
  createSession: (message: string, agent?: string, model?: string, variant?: string) => Promise<Session | null>
  setActiveSession: (id: string) => Promise<void>
  deleteSession: (id: string) => Promise<void>
  sendMessage: (content: string) => Promise<void>
  abortSession: () => Promise<void>
  clearSessions: () => void
  updateMessage: (sessionId: string, message: Message) => void
  updateMessagePart: (
    sessionId: string,
    messageId: string,
    part: MessagePart,
  ) => void
  updateTodos: (sessionId: string, todos: Todo[]) => void
  setSessionStatus: (sessionId: string, status: string) => void
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  messages: new Map(),
  todos: new Map(),
  sessionStatuses: new Map(),
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
      const sessions = await api.listSessions(repoId)
      set({ sessions, loadingSessions: false })
    } catch (error) {
      set({
        loadingSessions: false,
        loadError:
          error instanceof Error ? error.message : "Failed to load sessions",
      })
    }
  },

  createSession: async (message, agent, model, variant) => {
    const repoId = getRepoId()
    if (!repoId) return null
    set({ sendError: null })
    try {
      const session = await api.createSession(repoId, message, agent, model, variant)
      set((state) => ({
        sessions: [
          session,
          ...state.sessions.filter((s) => s.id !== session.id),
        ],
        activeSessionId: session.id,
        messages: mapSet(state.messages, session.id, []),
        sessionStatuses: mapSet(state.sessionStatuses, session.id, "busy"),
      }))
      void get().setActiveSession(session.id)
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
    const [messages, todos, status] = await Promise.allSettled([
      api.getMessages(repoId, id),
      api.getTodos(repoId, id),
      api.getSessionStatus(repoId, id),
    ])
    set((state) => {
      const next: Partial<SessionState> = {}
      if (messages.status === "fulfilled") {
        next.messages = mapSet(state.messages, id, messages.value)
      }
      if (todos.status === "fulfilled") {
        next.todos = mapSet(state.todos, id, todos.value)
      }
      if (status.status === "fulfilled") {
        next.sessionStatuses = mapSet(
          state.sessionStatuses,
          id,
          status.value.type,
        )
      }
      return next
    })
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
    set((state) => ({
      sessions: state.sessions.filter((s) => s.id !== id),
      messages: mapDelete(state.messages, id),
      todos: mapDelete(state.todos, id),
      sessionStatuses: mapDelete(state.sessionStatuses, id),
      activeSessionId:
        state.activeSessionId === id ? null : state.activeSessionId,
    }))
  },

  sendMessage: async (content) => {
    const repoId = getRepoId()
    const sessionId = get().activeSessionId
    if (!repoId || !sessionId) return
    set((state) => ({
      sendError: null,
      sessionStatuses: mapSet(state.sessionStatuses, sessionId, "busy"),
    }))
    try {
      await api.sendMessage(repoId, sessionId, content)
    } catch (error) {
      set((state) => ({
        sendError:
          error instanceof Error ? error.message : "Failed to send message",
        sessionStatuses: mapSet(state.sessionStatuses, sessionId, "idle"),
      }))
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
    set((state) => ({
      sessionStatuses: mapSet(state.sessionStatuses, sessionId, "idle"),
    }))
  },

  clearSessions: () => {
    set({
      sessions: [],
      activeSessionId: null,
      messages: new Map(),
      todos: new Map(),
      sessionStatuses: new Map(),
      loadError: null,
      sendError: null,
    })
  },

  updateMessage: (sessionId, message) => {
    set((state) => {
      const list = state.messages.get(sessionId) ?? []
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
      return { messages: mapSet(state.messages, sessionId, next) }
    })
  },

  updateMessagePart: (sessionId, messageId, part) => {
    set((state) => {
      const list = state.messages.get(sessionId) ?? []
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
      return { messages: mapSet(state.messages, sessionId, next) }
    })
  },

  updateTodos: (sessionId, todos) => {
    set((state) => ({ todos: mapSet(state.todos, sessionId, todos) }))
  },

  setSessionStatus: (sessionId, status) => {
    set((state) => ({
      sessionStatuses: mapSet(state.sessionStatuses, sessionId, status),
    }))
  },
}))
