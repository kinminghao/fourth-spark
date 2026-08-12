// ---------------------------------------------------------------------------
// StdioRuntimeClient — RuntimeClient backed by one `claude -p` subprocess per
// session. Each subprocess speaks the Claude Code CLI stream-json protocol on
// stdin/stdout; we translate its NDJSON into OpenCode-compatible SSE blocks
// via ./event-adapter.ts and fan them out to all attached SSE consumers.
//
// Session state:
//   * sessionInfo — durable metadata (id, title, createdAt) so listSessions()
//     returns a session even after its subprocess exited.
//   * managed    — subprocess + per-turn state, only alive while a turn is in
//     flight (or waiting for the next user message on stream-json stdin).
// ---------------------------------------------------------------------------

import { type Subprocess } from "bun"

import type { RuntimeClient } from "../../core/runtime-client"
import {
  RuntimeError,
  type Agent,
  type Message,
  type MessagePart,
  type PendingQuestion,
  type ProviderListResponse,
  type PromptFile,
  type PromptOpts,
  type Session,
  type SessionStatus,
  type Todo,
} from "../../core/runtime-types"
import { logger } from "../../middleware/logger"

import {
  type ClaudeSessionState,
  claudeEventToSseBlocks,
  createSessionState,
} from "./event-adapter"

const RUNTIME_ID = "claude-code"
const EVENT_BUFFER_CAP = 1000

// ---------------------------------------------------------------------------
// Session bookkeeping
// ---------------------------------------------------------------------------

interface SessionInfo {
  id: string
  title?: string
  createdAt: string
  agent?: string
}

interface ManagedSession {
  proc: Subprocess<"pipe", "pipe", "pipe">
  status: SessionStatus["type"]
  state: ClaudeSessionState
  eventBuffer: string[]
  eventListeners: Set<(block: string) => void>
  messages: Message[]
  messageIndex: Map<string, number>
  todos: Todo[]
  userCounter: number
  stderrChunks: string[]
}

// ---------------------------------------------------------------------------
// Helpers — model ID extraction, todo parsing from TodoWrite tool_use input.
// ---------------------------------------------------------------------------

// Text block MUST stay first: the CLI silently drops image blocks that lead the
// content array — it echoes them back on --replay-user-messages, model never sees them
function streamJsonUserMessage(content: string, files: PromptFile[]): string {
  const message = {
    role: "user",
    content: [
      { type: "text", text: content },
      ...files.map((f) => ({
        type: "image",
        source: { type: "base64", media_type: f.mime, data: f.url.slice(f.url.indexOf(",") + 1) },
      })),
    ],
  }
  return JSON.stringify({ type: "user", message }) + "\n"
}

function extractClaudeModelId(model: string): string {
  const slash = model.indexOf("/")
  return slash > 0 ? model.slice(slash + 1) : model
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

// ---------------------------------------------------------------------------
// StdioRuntimeClient
// ---------------------------------------------------------------------------

export class StdioRuntimeClient implements RuntimeClient {
  readonly directory: string
  private readonly sessionInfo = new Map<string, SessionInfo>()
  private readonly managed = new Map<string, ManagedSession>()
  private readonly spawnedOnce = new Set<string>()
  private readonly clientListeners = new Set<(block: string) => void>()
  private readonly persistentMessages = new Map<string, { messages: Message[]; messageIndex: Map<string, number>; todos: Todo[]; userCounter: number; lastMessageCounter: number; lastPartCounter: number }>()

  constructor(directory: string) {
    this.directory = directory
  }

  withDirectory(directory: string): RuntimeClient {
    return new StdioRuntimeClient(directory)
  }

  // -------------------------------------------------------------------------
  // Session CRUD (in-memory; Claude Code stores its own copy under ~/.claude)
  // -------------------------------------------------------------------------

  async listSessions(): Promise<Session[]> {
    return Array.from(this.sessionInfo.values()).map((s) => ({
      id: s.id,
      title: s.title,
      createdAt: s.createdAt,
    }))
  }

  async createSession(opts: { agent?: string; title?: string }): Promise<Session> {
    const id = crypto.randomUUID()
    const createdAt = new Date().toISOString()
    const info: SessionInfo = { id, title: opts.title, createdAt, agent: opts.agent }
    this.sessionInfo.set(id, info)
    return { id, title: info.title, createdAt }
  }

  async getSession(sessionId: string): Promise<Session> {
    const info = this.sessionInfo.get(sessionId)
    if (!info) {
      throw new RuntimeError(RUNTIME_ID, `Session ${sessionId} not found`, 404, "")
    }
    return { id: info.id, title: info.title, createdAt: info.createdAt }
  }

  async deleteSession(sessionId: string): Promise<void> {
    const m = this.managed.get(sessionId)
    if (m) {
      try {
        m.proc.kill()
      } catch {
        // already dead
      }
      this.managed.delete(sessionId)
    }
    this.sessionInfo.delete(sessionId)
    this.spawnedOnce.delete(sessionId)
  }

  async getMessages(sessionId: string): Promise<Message[]> {
    const p = this.persistentMessages.get(sessionId)
    return p ? p.messages.slice() : []
  }

  async getTodos(sessionId: string): Promise<Todo[]> {
    const p = this.persistentMessages.get(sessionId)
    return p ? p.todos.slice() : []
  }

  async getSessionStatus(): Promise<Record<string, SessionStatus>> {
    const out: Record<string, SessionStatus> = {}
    for (const [id, m] of this.managed) {
      out[id] = { type: m.status }
    }
    for (const id of this.sessionInfo.keys()) {
      if (!(id in out)) out[id] = { type: "idle" }
    }
    return out
  }

  // -------------------------------------------------------------------------
  // Prompt / abort — the core interaction. First prompt spawns the subprocess
  // with --session-id; subsequent turns after an abort resume with --resume.
  // -------------------------------------------------------------------------

  private ensurePersistent(sessionId: string) {
    let p = this.persistentMessages.get(sessionId)
    if (!p) {
      p = { messages: [], messageIndex: new Map(), todos: [], userCounter: 0, lastMessageCounter: 0, lastPartCounter: 0 }
      this.persistentMessages.set(sessionId, p)
    }
    return p
  }

  async prompt(sessionId: string, content: string, opts?: PromptOpts): Promise<void> {
    const existing = this.managed.get(sessionId)
    if (existing) {
      try { existing.proc.kill() } catch {}
      this.managed.delete(sessionId)
    }

    if (!this.sessionInfo.has(sessionId)) {
      this.sessionInfo.set(sessionId, { id: sessionId, createdAt: new Date().toISOString() })
    }

    const p = this.ensurePersistent(sessionId)
    const m = await this.spawnSession(sessionId, content, opts)

    const info = this.sessionInfo.get(sessionId)
    if (info && !info.title && content.length > 0) {
      info.title = content.length > 50 ? content.slice(0, 50) + "…" : content
    }

    p.userCounter += 1
    const userMsgId = `claude-${sessionId.slice(0, 8)}-user-${p.userCounter}`
    const userParts: MessagePart[] = [
      { type: "text", content },
      ...(opts?.files ?? []).map((f) => ({ type: "file", mime: f.mime, url: f.url, filename: f.filename })),
    ]
    const userMsg: Message = { id: userMsgId, role: "user", parts: userParts }
    p.messageIndex.set(userMsgId, p.messages.length)
    p.messages.push(userMsg)
    m.messages = p.messages
    m.messageIndex = p.messageIndex

    this.emitClientBlock(this.buildSseBlock("message.updated", {
      sessionID: sessionId,
      id: userMsgId,
      role: "user",
      parts: userParts,
    }))
    this.emitClientBlock(this.buildSseBlock("session.status", { sessionID: sessionId, type: "busy" }))
  }

  async abort(sessionId: string): Promise<void> {
    const m = this.managed.get(sessionId)
    if (!m) return
    try {
      m.proc.kill()
    } catch {
      // already dead
    }
    m.status = "idle"
    this.managed.delete(sessionId)
    this.emitClientBlock(this.buildSseBlock("session.status", { sessionID: sessionId, type: "idle" }))
  }

  // -------------------------------------------------------------------------
  // Event stream — a single ReadableStream that emits every SSE block we
  // produce across every managed session. routes/events.ts filters by
  // properties.sessionID, so we don't need per-session fan-out here.
  // -------------------------------------------------------------------------

  async eventStream(signal?: AbortSignal): Promise<Response> {
    const encoder = new TextEncoder()
    const client = this
    let listener: ((block: string) => void) | null = null
    let closed = false

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const m of client.managed.values()) {
          for (const block of m.eventBuffer) {
            try { controller.enqueue(encoder.encode(block)) } catch { /* backpressure */ }
          }
        }
        listener = (block: string) => {
          if (closed) return
          try {
            controller.enqueue(encoder.encode(block))
          } catch {
            closed = true
          }
        }
        client.clientListeners.add(listener)
      },
      cancel() {
        closed = true
        if (listener) {
          client.clientListeners.delete(listener)
          listener = null
        }
      },
    })

    if (signal) {
      const onAbort = () => {
        closed = true
        if (listener) {
          client.clientListeners.delete(listener)
          listener = null
        }
      }
      if (signal.aborted) onAbort()
      else signal.addEventListener("abort", onAbort, { once: true })
    }

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    })
  }

  // -------------------------------------------------------------------------
  // Interactive question protocol — Claude Code headless mode doesn't emit
  // structured questions; we return empty arrays / no-ops so the routes layer
  // stays uniform across runtimes.
  // -------------------------------------------------------------------------

  async listQuestions(): Promise<PendingQuestion[]> {
    return []
  }

  async replyQuestion(_requestID: string, _answers: string[][]): Promise<void> {
    // no-op: Claude Code headless mode has no interactive questions.
  }

  async rejectQuestion(_requestID: string): Promise<void> {
    // no-op: see replyQuestion.
  }

  async listAgents(): Promise<Agent[]> {
    return [{ id: "claude-code", name: "Claude Code" }]
  }

  async getProviders(): Promise<ProviderListResponse> {
    return {
      all: [
        {
          id: "anthropic",
          name: "Anthropic",
          models: {
            "claude-sonnet-4-20250514": {
              id: "claude-sonnet-4-20250514",
              name: "Claude Sonnet 4",
              status: "active",
            },
            "claude-opus-4-20250514": {
              id: "claude-opus-4-20250514",
              name: "Claude Opus 4",
              status: "active",
            },
          },
        },
      ],
      connected: ["anthropic"],
    }
  }

  // -------------------------------------------------------------------------
  // Subprocess spawn + stdout reader
  // -------------------------------------------------------------------------

  private async spawnSession(sessionId: string, content: string, opts?: PromptOpts): Promise<ManagedSession> {
    const files = opts?.files ?? []
    const args = [
      "claude", "-p",
      "--output-format", "stream-json",
      "--permission-mode", "bypassPermissions",
      "--verbose",
    ]
    if (files.length > 0) {
      args.push("--input-format", "stream-json")
    }
    if (this.spawnedOnce.has(sessionId)) {
      args.push("--resume", sessionId)
    } else {
      args.push("--session-id", sessionId)
    }
    const model = opts?.model
    if (model) {
      args.push("--model", extractClaudeModelId(model))
    }

    logger.info({ sessionId, cwd: this.directory, model, resume: this.spawnedOnce.has(sessionId) }, "spawning claude subprocess")

    const proc = Bun.spawn(args, {
      cwd: this.directory,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env },
    }) as Subprocess<"pipe", "pipe", "pipe">

    logger.info({ sessionId, pid: proc.pid, contentLength: content.length, files: files.length }, "writing prompt to claude stdin")
    try {
      proc.stdin.write(files.length > 0 ? streamJsonUserMessage(content, files) : content)
      proc.stdin.flush()
      proc.stdin.end()
    } catch (err) {
      logger.error({ err, sessionId }, "failed to write to claude subprocess stdin")
      throw new RuntimeError(RUNTIME_ID, "Failed to write prompt to Claude", 500, String(err))
    }

    const p = this.ensurePersistent(sessionId)
    const state = createSessionState({ messageCounter: p.lastMessageCounter, partCounter: p.lastPartCounter })
    const managed: ManagedSession = {
      proc,
      status: "busy",
      state,
      eventBuffer: [],
      eventListeners: new Set(),
      messages: [],
      messageIndex: new Map(),
      todos: [],
      userCounter: 0,
      stderrChunks: [],
    }
    this.managed.set(sessionId, managed)
    this.spawnedOnce.add(sessionId)

    // Background readers — one for stdout (event stream) and one for stderr
    // (debug logging only). Neither is awaited; both self-terminate on EOF.
    this.readStdout(sessionId, managed).catch((err) => {
      logger.error({ err, sessionId }, "claude stdout reader crashed")
    })
    this.readStderr(sessionId, managed).catch((err) => {
      logger.warn({ err, sessionId }, "claude stderr reader crashed")
    })
    proc.exited.then((code) => {
      const still = this.managed.get(sessionId)
      if (still !== managed) return
      this.managed.delete(sessionId)

      const stderrText = managed.stderrChunks.join("").trim()
      if (code !== 0 && code !== null) {
        const reason = stderrText || `claude exited with code ${code}`
        this.emitClientBlock(this.buildSseBlock("session.error", { sessionID: sessionId, message: reason }))
        logger.warn({ sessionId, code, stderr: stderrText.slice(0, 500) }, "claude subprocess exited with error")
      } else {
        this.emitClientBlock(this.buildSseBlock("session.status", { sessionID: sessionId, type: "idle" }))
        logger.info({ sessionId, code }, "claude subprocess exited normally")
      }
    }).catch(() => {})

    return managed
  }

  private async readStdout(sessionId: string, m: ManagedSession): Promise<void> {
    const reader = m.proc.stdout.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let idx = buffer.indexOf("\n")
        while (idx !== -1) {
          const line = buffer.slice(0, idx)
          buffer = buffer.slice(idx + 1)
          this.handleLine(sessionId, m, line)
          idx = buffer.indexOf("\n")
        }
      }
      const tail = buffer + decoder.decode()
      if (tail.trim()) this.handleLine(sessionId, m, tail)
    } finally {
      try {
        reader.releaseLock()
      } catch {
        // ignore
      }
    }
  }

  private async readStderr(sessionId: string, m: ManagedSession): Promise<void> {
    const reader = m.proc.stderr.getReader()
    const decoder = new TextDecoder()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const text = decoder.decode(value, { stream: true })
        if (text) {
          m.stderrChunks.push(text)
          logger.debug({ sessionId, stderr: text.trim() }, "claude stderr")
        }
      }
    } finally {
      try { reader.releaseLock() } catch {}
    }
  }

  // -------------------------------------------------------------------------
  // Per-line dispatch — feed the NDJSON line to the adapter, forward blocks
  // to listeners, sync our in-memory message/todo model, and toggle status.
  // -------------------------------------------------------------------------

  private handleLine(sessionId: string, m: ManagedSession, line: string): void {
    const trimmed = line.trim()
    if (!trimmed) return
    logger.debug({ sessionId, linePreview: trimmed.slice(0, 300) }, "claude stdout line")

    const blocks = claudeEventToSseBlocks(trimmed, sessionId, m.state)
    for (const block of blocks) {
      this.pushBlock(m, block)
      this.emitClientBlock(block)
    }

    this.syncFromState(sessionId, m)
    this.updateStatusFromLine(sessionId, m, trimmed)
  }

  private syncFromState(sessionId: string, m: ManagedSession): void {
    const id = m.state.ourMessageId
    if (!id) return
    const p = this.ensurePersistent(sessionId)
    p.lastMessageCounter = m.state.messageCounter
    p.lastPartCounter = m.state.partCounter
    const message: Message = {
      id,
      role: "assistant",
      parts: m.state.currentParts.slice(),
    }
    if (m.state.lastModelId) {
      message.info = { modelID: m.state.lastModelId, providerID: "anthropic" }
    }
    const idx = p.messageIndex.get(id)
    if (idx === undefined) {
      p.messageIndex.set(id, p.messages.length)
      p.messages.push(message)
    } else {
      p.messages[idx] = message
    }

    const todos: Todo[] = []
    for (const part of m.state.currentParts) {
      if (part.type !== "tool-invocation" || part.toolName !== "TodoWrite") continue
      const input = asRecord(part.input)
      if (!input || !Array.isArray(input.todos)) continue
      todos.length = 0
      for (let i = 0; i < input.todos.length; i++) {
        const rec = asRecord(input.todos[i]) ?? {}
        todos.push({
          id: `todo-${i}`,
          content: asString(rec.content) ?? "",
          status: asString(rec.status) ?? "pending",
          ...(asString(rec.priority) ? { priority: asString(rec.priority)! } : {}),
        })
      }
    }
    p.todos = todos
  }

  private updateStatusFromLine(sessionId: string, m: ManagedSession, line: string): void {
    // Cheap prefix check to avoid double-parsing — the adapter has already
    // parsed the JSON, but we need the top-level type to toggle status.
    if (line.includes(`"type":"result"`)) {
      m.status = "idle"
    } else if (line.includes(`"type":"system"`) || line.includes(`"type":"assistant"`)) {
      m.status = "busy"
    }
    // Suppress unused-var warning while keeping the sessionId parameter for
    // symmetry with other private helpers.
    void sessionId
  }

  private pushBlock(m: ManagedSession, block: string): void {
    m.eventBuffer.push(block)
    if (m.eventBuffer.length > EVENT_BUFFER_CAP) {
      m.eventBuffer.splice(0, m.eventBuffer.length - EVENT_BUFFER_CAP)
    }
    for (const listener of m.eventListeners) listener(block)
  }

  private emitClientBlock(block: string): void {
    for (const listener of this.clientListeners) {
      try {
        listener(block)
      } catch {
        // consumer error must not break the reader loop
      }
    }
  }

  private buildSseBlock(eventType: string, properties: Record<string, unknown>): string {
    const data = { type: eventType, properties }
    return `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`
  }

  // -------------------------------------------------------------------------
  // Internal — used by ClaudeCodeProvider for teardown so it doesn't need to
  // reach into private fields.
  // -------------------------------------------------------------------------

  killAll(): void {
    for (const [id, m] of this.managed) {
      try {
        m.proc.kill()
      } catch {
        // already dead
      }
      this.managed.delete(id)
    }
  }
}
