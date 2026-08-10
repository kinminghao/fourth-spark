// ---------------------------------------------------------------------------
// Claude Code event adapter — converts Claude Code CLI's NDJSON stream into
// OpenCode-compatible SSE blocks that routes/events.ts and the frontend's
// sse-events.ts already know how to parse.
//
// Each SSE block is:
//   event: <event-name>\ndata: {"type":"<event-name>","properties":{...}}\n\n
//
// Filtering in routes/events.ts uses properties.sessionID — so every block we
// emit MUST carry that field.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Session-scoped mutable state — tracks the current in-flight Claude message
// (its parts, tool_use IDs, cumulative text lengths) so partial streaming
// messages can be reconciled with our part model and emitted as deltas.
// ---------------------------------------------------------------------------

export interface ClaudeSessionState {
  messageCounter: number
  partCounter: number
  currentMessageId: string | null
  currentParts: Array<{
    id: string
    type: string
    content?: string
    toolName?: string
    input?: unknown
    output?: unknown
  }>
  ourMessageId: string | null
  toolUseIdToPartId: Map<string, string>
  textPartLengths: Map<string, number>
  lastModelId: string | null
}

export function createSessionState(continueFrom?: { messageCounter: number; partCounter: number }): ClaudeSessionState {
  return {
    messageCounter: continueFrom?.messageCounter ?? 0,
    partCounter: continueFrom?.partCounter ?? 0,
    currentMessageId: null,
    currentParts: [],
    ourMessageId: null,
    toolUseIdToPartId: new Map(),
    textPartLengths: new Map(),
    lastModelId: null,
  }
}

// ---------------------------------------------------------------------------
// SSE block builder — the wire format expected by routes/events.ts parseBlock
// and the browser EventSource. Data payload mirrors OpenCode's envelope so the
// frontend's sse-events.ts dispatches without a special case.
// ---------------------------------------------------------------------------

function buildSseBlock(eventType: string, properties: Record<string, unknown>): string {
  const data = { type: eventType, properties }
  return `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`
}

// ---------------------------------------------------------------------------
// Type-narrowing helpers on the raw parsed JSON — Claude's NDJSON schema is
// untyped from our perspective, so every field is defensively narrowed.
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined
}

// ---------------------------------------------------------------------------
// system.init — Claude emits this once per subprocess when the session is
// established. We forward it as a "busy" status marker so the UI shows the
// spinner while the first tokens arrive.
// ---------------------------------------------------------------------------

function handleSystem(
  event: Record<string, unknown>,
  sessionId: string,
  state: ClaudeSessionState,
): string[] {
  if (event.subtype !== "init") return []
  const model = asString(event.model)
  if (model) state.lastModelId = model
  return [buildSseBlock("session.status", { sessionID: sessionId, type: "busy" })]
}

// ---------------------------------------------------------------------------
// Part construction — Claude content blocks are mapped 1:1 to our part model.
// The `_seq` index in state.currentParts is used both to reconcile updates in
// place (when partial streaming re-sends the same block) and to detect newly
// appended blocks.
// ---------------------------------------------------------------------------

function handleAssistant(
  event: Record<string, unknown>,
  sessionId: string,
  state: ClaudeSessionState,
): string[] {
  const msg = asRecord(event.message)
  if (!msg) return []
  const claudeMsgId = asString(msg.id)
  if (!claudeMsgId) return []

  const isNewMessage = state.currentMessageId !== claudeMsgId
  if (isNewMessage) {
    state.currentMessageId = claudeMsgId
    state.messageCounter += 1
    state.ourMessageId = `claude-${sessionId.slice(0, 8)}-${state.messageCounter}`
    state.currentParts = []
    state.toolUseIdToPartId = new Map()
    state.textPartLengths = new Map()
  }

  const model = asString(msg.model)
  if (model) state.lastModelId = model

  const content = Array.isArray(msg.content) ? msg.content : []
  const deltas: string[] = []

  for (let i = 0; i < content.length; i++) {
    const block = asRecord(content[i])
    if (!block) continue
    const blockType = asString(block.type)

    if (blockType === "text") {
      const text = asString(block.text) ?? ""
      const existing = state.currentParts[i]
      if (existing && existing.type === "text") {
        const prevLen = state.textPartLengths.get(existing.id) ?? 0
        if (text.length > prevLen && state.ourMessageId) {
          const delta = text.slice(prevLen)
          existing.content = text
          state.textPartLengths.set(existing.id, text.length)
          deltas.push(buildSseBlock("message.part.delta", {
            sessionID: sessionId,
            messageID: state.ourMessageId,
            partID: existing.id,
            field: "text",
            delta,
          }))
        }
      } else {
        state.partCounter += 1
        const partId = `p-${state.partCounter}`
        state.currentParts[i] = { id: partId, type: "text", content: text }
        state.textPartLengths.set(partId, text.length)
      }
    } else if (blockType === "tool_use") {
      const toolId = asString(block.id)
      const toolName = asString(block.name) ?? ""
      const input = block.input
      const existing = state.currentParts[i]
      const trackedPartId = toolId ? state.toolUseIdToPartId.get(toolId) : undefined
      if (existing && existing.type === "tool-invocation" && trackedPartId === existing.id) {
        existing.input = input
        existing.toolName = toolName
      } else {
        state.partCounter += 1
        const partId = `p-${state.partCounter}`
        state.currentParts[i] = { id: partId, type: "tool-invocation", toolName, input }
        if (toolId) state.toolUseIdToPartId.set(toolId, partId)
      }
    } else if (blockType === "thinking") {
      const thinking = asString(block.thinking) ?? ""
      const existing = state.currentParts[i]
      if (existing && existing.type === "thinking") {
        existing.content = thinking
      } else {
        state.partCounter += 1
        const partId = `p-${state.partCounter}`
        state.currentParts[i] = { id: partId, type: "thinking", content: thinking }
      }
    }
  }

  if (!state.ourMessageId) return deltas

  const props: Record<string, unknown> = {
    sessionID: sessionId,
    id: state.ourMessageId,
    role: "assistant",
    parts: state.currentParts.slice(),
  }
  if (state.lastModelId) {
    props.modelID = state.lastModelId
    props.providerID = "anthropic"
  }
  return [buildSseBlock("message.updated", props), ...deltas]
}

// ---------------------------------------------------------------------------
// tool_result — Claude sends the outcome of a tool_use in a separate NDJSON
// event. We locate the matching part by tool_use_id and attach the output.
// TodoWrite results also produce a todo.updated event so the UI's todo panel
// stays in sync without a dedicated Claude "todo" event.
// ---------------------------------------------------------------------------

function extractToolResultText(content: unknown): unknown {
  if (Array.isArray(content)) {
    const texts: string[] = []
    for (const item of content) {
      const rec = asRecord(item)
      if (rec && rec.type === "text") {
        const t = asString(rec.text)
        if (t) texts.push(t)
      }
    }
    if (texts.length > 0) return texts.join("\n")
  }
  return content
}

function buildTodoUpdateFromInput(input: unknown, sessionId: string): string | null {
  const rec = asRecord(input)
  if (!rec || !Array.isArray(rec.todos)) return null
  const todos = rec.todos.map((raw, idx) => {
    const t = asRecord(raw) ?? {}
    return {
      id: `todo-${idx}`,
      content: asString(t.content) ?? "",
      status: asString(t.status) ?? "pending",
      priority: asString(t.priority),
    }
  })
  return buildSseBlock("todo.updated", { sessionID: sessionId, todos })
}

function handleToolResult(
  event: Record<string, unknown>,
  sessionId: string,
  state: ClaudeSessionState,
): string[] {
  const toolUseId = asString(event.tool_use_id)
  if (!toolUseId) return []
  const partId = state.toolUseIdToPartId.get(toolUseId)
  if (!partId) return []
  const part = state.currentParts.find((p) => p.id === partId)
  if (!part) return []

  part.output = extractToolResultText(event.content)
  const blocks: string[] = []

  if (state.ourMessageId) {
    const props: Record<string, unknown> = {
      sessionID: sessionId,
      id: state.ourMessageId,
      role: "assistant",
      parts: state.currentParts.slice(),
    }
    if (state.lastModelId) {
      props.modelID = state.lastModelId
      props.providerID = "anthropic"
    }
    blocks.push(buildSseBlock("message.updated", props))
  }

  if (part.toolName === "TodoWrite") {
    const todoBlock = buildTodoUpdateFromInput(part.input, sessionId)
    if (todoBlock) blocks.push(todoBlock)
  }

  return blocks
}

// ---------------------------------------------------------------------------
// result — the terminal event for a Claude turn. Carries final usage/cost and
// the success/error verdict. We emit a session.updated (metadata) followed by
// a session.status idle (or session.error) so the UI drops the busy state.
// ---------------------------------------------------------------------------

function handleResult(
  event: Record<string, unknown>,
  sessionId: string,
  state: ClaudeSessionState,
): string[] {
  const blocks: string[] = []
  const isError = event.subtype === "error" || event.is_error === true

  const usage = asRecord(event.usage)
  const cost = asNumber(event.cost_usd) ?? asNumber(event.total_cost_usd)

  const sessionProps: Record<string, unknown> = {
    id: sessionId,
    sessionID: sessionId,
  }
  if (cost !== undefined) sessionProps.cost = cost
  if (usage) {
    sessionProps.tokens = {
      input: asNumber(usage.input_tokens) ?? 0,
      output: asNumber(usage.output_tokens) ?? 0,
      reasoning: 0,
      cache: {
        read: asNumber(usage.cache_read_input_tokens) ?? 0,
        write: asNumber(usage.cache_creation_input_tokens) ?? 0,
      },
    }
  }
  if (state.lastModelId) {
    sessionProps.model = { providerID: "anthropic", modelID: state.lastModelId }
  }
  blocks.push(buildSseBlock("session.updated", sessionProps))

  if (isError) {
    const message = asString(event.result)
      ?? asString(event.message)
      ?? asString(event.error)
      ?? "Claude Code returned an error"
    blocks.push(buildSseBlock("session.error", { sessionID: sessionId, message }))
  }

  blocks.push(buildSseBlock("session.status", { sessionID: sessionId, type: "idle" }))
  return blocks
}

// ---------------------------------------------------------------------------
// Entry point — parse one NDJSON line and route to the type-specific handler.
// Malformed / unknown events are silently dropped so the stream keeps flowing.
// ---------------------------------------------------------------------------

export function claudeEventToSseBlocks(
  line: string,
  sessionId: string,
  state: ClaudeSessionState,
): string[] {
  const trimmed = line.trim()
  if (!trimmed) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return []
  }
  const event = asRecord(parsed)
  if (!event) return []

  switch (event.type) {
    case "system":
      return handleSystem(event, sessionId, state)
    case "assistant":
      return handleAssistant(event, sessionId, state)
    case "tool_result":
      return handleToolResult(event, sessionId, state)
    case "result":
      return handleResult(event, sessionId, state)
    default:
      return []
  }
}
