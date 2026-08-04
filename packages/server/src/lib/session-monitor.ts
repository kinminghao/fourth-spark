import { autoSwitch, getActiveId, isUsageLimit, clearCooldown } from "./account-switcher"
import type { OpenCodeClient, SessionStatus, Message, Todo } from "./opencode"
import { notify } from "./notify"
import { pushNotify } from "./apns"
import { logger } from "../middleware/logger"
import { DEFAULT_VARIANT } from "./config"

const POLL_INTERVAL_MS = 3_000
const RECENT_SWITCH_GUARD_MS = 5_000
const REPROMPT_SETTLE_MS = 1_500
const MAX_AUTO_CONTINUES = 5
const MAX_EMPTY_RETRIES = 2
const MAX_IDLE_RESPONSES = 2
const MAX_STAGNATION = 3
const DEDUP_COOLDOWN_MS = 30_000
const NOTIFY_COOLDOWN_MS = 30_000

type ManagedEntry = {
  repoId: string
  client: OpenCodeClient
}

const handled = new Map<string, number>()
const repromptInFlight = new Set<string>()
const userAborted = new Set<string>()
const autoContinueCounts = new Map<string, number>()
const emptyRetryCounts = new Map<string, number>()
const idleResponseCounts = new Map<string, number>()
const lastUserMessageIds = new Map<string, string>()
const todoFingerprints = new Map<string, { fingerprint: string; count: number }>()
const prevStatuses = new Map<string, string>()
let lastSwitchAt = 0
let timer: ReturnType<typeof setInterval> | undefined
const entries: ManagedEntry[] = []

const STATUS_LABELS: Record<string, string> = { idle: "完成", busy: "运行中", retry: "重试中" }

function emitTransition(sessionId: string, from: string, to: string): void {
  const notifyKey = `notify:${sessionId}`
  const lastNotify = handled.get(notifyKey)
  if (lastNotify && Date.now() - lastNotify < NOTIFY_COOLDOWN_MS) return
  handled.set(notifyKey, Date.now())

  const fromLabel = STATUS_LABELS[from] ?? from
  const toLabel = STATUS_LABELS[to] ?? to
  const sid = sessionId.slice(-8)
  if (from === "idle" && to === "busy") {
    notify("Session 开始", `[${sid}] 开始运行`)
  } else if (to === "idle" && from !== "idle") {
    notify("Session 完成", `[${sid}] ${fromLabel} → ${toLabel}`)
    pushNotify("✅ 任务完成", `Session [${sid}] 已完成`, { sessionId }).catch(() => {})
  } else if (to === "retry") {
    notify("Session 重试", `[${sid}] ${fromLabel} → ${toLabel}`)
    pushNotify("❌ 执行出错", `Session [${sid}] 需要重试`, { sessionId }).catch(() => {})
  }
}

function dedup(key: string): boolean {
  const ts = handled.get(key)
  if (ts && Date.now() - ts < DEDUP_COOLDOWN_MS) return false
  handled.set(key, Date.now())
  if (handled.size > 500) {
    const cutoff = Date.now() - 10 * 60_000
    for (const [k, v] of handled) {
      if (v < cutoff) handled.delete(k)
    }
  }
  return true
}

async function getLastUserPrompt(
  client: OpenCodeClient,
  sessionId: string,
): Promise<{ content: string; agent?: string; model?: string; variant?: string } | undefined> {
  try {
    const messages = await client.getMessages(sessionId)
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg.role !== "user") continue
      const textParts = (msg.parts ?? []).filter((p) => p.type === "text")
      const text = textParts.map((p) => p.content ?? "").join("\n").trim()
      if (text.length > 0) {
        const assistantAfter = messages.slice(i + 1).find((m) => m.role === "assistant")
        return {
          content: text,
          agent: assistantAfter?.info?.agent,
          model: assistantAfter?.info?.modelID
            ? `${assistantAfter.info.providerID ?? "anthropic"}/${assistantAfter.info.modelID}`
            : undefined,
        }
      }
    }
  } catch (err) {
    logger.warn({ err, sessionId }, "failed to retrieve last user prompt")
  }
  return undefined
}

async function detectEmptyResponse(client: OpenCodeClient, sessionId: string): Promise<boolean> {
  const count = emptyRetryCounts.get(sessionId) ?? 0
  if (count >= MAX_EMPTY_RETRIES) {
    logger.info({ sessionId, count }, "empty-response retry limit reached, skipping")
    return false
  }
  try {
    const messages = await client.getMessages(sessionId)
    if (messages.length === 0) return false

    const lastMsg = messages[messages.length - 1]
    if (lastMsg.role !== "assistant") return false

    const parts = lastMsg.parts ?? []
    const hasVisibleContent = parts.some((p) => {
      if (p.type === "thinking") return false
      if (p.type === "text") return (p.content ?? "").trim().length > 0
      return true
    })

    return !hasVisibleContent
  } catch {
    return false
  }
}

async function autoRetryEmptyResponse(client: OpenCodeClient, sessionId: string): Promise<void> {
  const count = (emptyRetryCounts.get(sessionId) ?? 0) + 1
  emptyRetryCounts.set(sessionId, count)
  const sid = sessionId.slice(-8)
  try {
    const last = await getLastUserPrompt(client, sessionId)
    await client.prompt(sessionId, "continue", {
      agent: last?.agent,
      model: last?.model,
      variant: DEFAULT_VARIANT,
    })
    logger.info({ sessionId, count, max: MAX_EMPTY_RETRIES }, "auto-retried empty response (notification suppressed)")
  } catch (err) {
    logger.warn({ err, sessionId }, "empty-response retry failed")
  }
}

async function hasIncompleteTodos(client: OpenCodeClient, sessionId: string): Promise<boolean> {
  try {
    const todos = await client.getTodos(sessionId)
    return todos.some((t) => t.status === "in_progress" || t.status === "pending")
  } catch {
    return false
  }
}

function buildTodoFingerprint(todos: Todo[]): string {
  return todos
    .map((t) => `${t.content}:${t.status}`)
    .sort()
    .join("|")
}

function isStagnant(sessionId: string, todos: Todo[]): boolean {
  const fingerprint = buildTodoFingerprint(todos)
  const prev = todoFingerprints.get(sessionId)
  if (prev && prev.fingerprint === fingerprint) {
    const count = prev.count + 1
    todoFingerprints.set(sessionId, { fingerprint, count })
    if (count >= MAX_STAGNATION) {
      logger.info({ sessionId, count, max: MAX_STAGNATION }, "todo stagnation detected, stopping auto-continue")
      return true
    }
    return false
  }
  todoFingerprints.set(sessionId, { fingerprint, count: 1 })
  return false
}

function isIdleResponse(msg: Message): boolean {
  const parts = msg.parts ?? []
  const hasToolCall = parts.some((p) => p.type === "tool" || p.type === "tool_use" || p.type === "tool-invocation")
  if (hasToolCall) return false
  const textParts = parts.filter((p) => p.type === "text")
  if (textParts.length === 0) return false
  const text = textParts.map((p) => p.content ?? "").join("").trim()
  return text.length > 0 && text.length < 200
}

function detectAgentIdle(sessionId: string, messages: Message[]): boolean {
  const lastAssistant = findLastAssistant(messages)
  if (!lastAssistant || !isIdleResponse(lastAssistant)) {
    idleResponseCounts.set(sessionId, 0)
    return false
  }
  const count = (idleResponseCounts.get(sessionId) ?? 0) + 1
  idleResponseCounts.set(sessionId, count)
  if (count >= MAX_IDLE_RESPONSES) {
    logger.info({ sessionId, count, max: MAX_IDLE_RESPONSES }, "agent idle detected (short text-only responses), stopping auto-continue")
    return true
  }
  return false
}

function findLastAssistant(messages: Message[]): Message | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant") return messages[i]
  }
  return undefined
}

function findLastUserMessageId(messages: Message[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") return messages[i].id
  }
  return undefined
}

function resetCountersIfNewUserMessage(sessionId: string, messages: Message[]): void {
  const currentUserMsgId = findLastUserMessageId(messages)
  const prevUserMsgId = lastUserMessageIds.get(sessionId)
  if (currentUserMsgId && currentUserMsgId !== prevUserMsgId) {
    lastUserMessageIds.set(sessionId, currentUserMsgId)
    autoContinueCounts.delete(sessionId)
    idleResponseCounts.delete(sessionId)
    todoFingerprints.delete(sessionId)
    emptyRetryCounts.delete(sessionId)
    userAborted.delete(sessionId)
  }
}

function lastResponseWasTruncated(messages: Message[]): boolean {
  const lastAssistant = findLastAssistant(messages)
  if (!lastAssistant) return false
  const parts = lastAssistant.parts ?? []
  return !parts.some((p) => p.type === "step-finish")
}

async function detectTruncation(client: OpenCodeClient, sessionId: string): Promise<boolean> {
  const count = autoContinueCounts.get(sessionId) ?? 0
  if (count >= MAX_AUTO_CONTINUES) {
    logger.info({ sessionId, count }, "auto-continue limit reached, skipping")
    return false
  }

  let messages: Message[]
  try {
    messages = await client.getMessages(sessionId)
  } catch {
    return false
  }

  resetCountersIfNewUserMessage(sessionId, messages)

  const recheckedCount = autoContinueCounts.get(sessionId) ?? 0
  if (recheckedCount >= MAX_AUTO_CONTINUES) {
    logger.info({ sessionId, count: recheckedCount }, "auto-continue limit reached after counter reset check, skipping")
    return false
  }

  if (detectAgentIdle(sessionId, messages)) return false

  const truncated = lastResponseWasTruncated(messages)
  if (!truncated) return false

  let todos: Todo[]
  try {
    todos = await client.getTodos(sessionId)
  } catch {
    return false
  }

  if (!todos.some((t) => t.status === "in_progress" || t.status === "pending")) return false
  if (isStagnant(sessionId, todos)) return false

  return true
}

async function autoContinueSession(client: OpenCodeClient, sessionId: string): Promise<void> {
  const count = (autoContinueCounts.get(sessionId) ?? 0) + 1
  autoContinueCounts.set(sessionId, count)
  const sid = sessionId.slice(-8)
  try {
    const last = await getLastUserPrompt(client, sessionId)
    await client.prompt(sessionId, "continue", {
      agent: last?.agent,
      model: last?.model,
      variant: DEFAULT_VARIANT,
    })
    logger.info({ sessionId, count, max: MAX_AUTO_CONTINUES }, "auto-continued truncated session (notification suppressed)")
  } catch (err) {
    logger.warn({ err, sessionId }, "auto-continue prompt failed")
  }
}

function hasSubstantialProgress(messages: Message[]): boolean {
  const last = findLastAssistant(messages)
  if (!last) return false
  const parts = last.parts ?? []
  return parts.some((p) => {
    if (p.type === "tool" || p.type === "tool_use" || p.type === "tool-invocation") {
      return p.output !== undefined
    }
    if (p.type === "text") {
      return (p.content ?? "").trim().length > 0
    }
    return false
  })
}

async function repromptSession(client: OpenCodeClient, sessionId: string): Promise<void> {
  if (repromptInFlight.has(sessionId)) return
  repromptInFlight.add(sessionId)
  try {
    try {
      await client.abort(sessionId)
    } catch {
      // stream may already be settled
    }
    await new Promise((r) => setTimeout(r, REPROMPT_SETTLE_MS))

    let messages: Message[]
    try {
      messages = await client.getMessages(sessionId)
    } catch {
      messages = []
    }

    const last = await getLastUserPrompt(client, sessionId)
    if (hasSubstantialProgress(messages)) {
      await client.prompt(sessionId, "continue", { agent: last?.agent, model: last?.model, variant: DEFAULT_VARIANT })
      logger.info({ sessionId }, "sent continue after account switch (progress detected)")
      return
    }

    if (!last) {
      logger.warn({ sessionId }, "no user prompt found for reprompt, sending continue")
      await client.prompt(sessionId, "continue")
      return
    }
    await client.prompt(sessionId, last.content, { agent: last.agent, model: last.model, variant: last.variant })
    logger.info({ sessionId }, "resent original prompt after account switch (no progress)")
  } catch (err) {
    logger.warn({ err, sessionId }, "reprompt failed")
  } finally {
    repromptInFlight.delete(sessionId)
  }
}

let pollCount = 0
let polling = false

async function pollOnce(): Promise<void> {
  if (polling) return
  polling = true
  try {
    pollCount++
    if (pollCount <= 3 || pollCount % 20 === 0) logger.info({ pollCount, repos: entries.length }, "poll tick")
    for (const { repoId, client } of entries) {
      let statuses: Record<string, SessionStatus>
      try {
        statuses = await client.getSessionStatus()
      } catch {
        continue
      }

      const activeCount = Object.keys(statuses).length
      if (activeCount > 0) logger.info({ repoId, activeCount }, "poll: active sessions found")

      const currentIds = new Set(Object.keys(statuses))
      for (const [sessionId, prev] of prevStatuses) {
        if (!currentIds.has(sessionId) && prev !== "idle") {
          prevStatuses.set(sessionId, "idle")
          emitTransition(sessionId, prev, "idle")
          clearCooldown(await getActiveId() ?? "")

          if (prev === "busy") {
            const shouldContinue = await detectTruncation(client, sessionId)
            if (shouldContinue) {
              await autoContinueSession(client, sessionId)
              continue
            }

            const isEmpty = await detectEmptyResponse(client, sessionId)
            if (isEmpty) {
              await autoRetryEmptyResponse(client, sessionId)
              continue
            }

          }
        }
      }

      for (const [sessionId, status] of Object.entries(statuses)) {
        const prev = prevStatuses.get(sessionId)
        prevStatuses.set(sessionId, status.type)

        if (status.type === "idle") {
          clearCooldown(await getActiveId() ?? "")

          if (prev === "busy") {
            const shouldContinue = await detectTruncation(client, sessionId)
            if (shouldContinue) {
              await autoContinueSession(client, sessionId)
              continue
            }

            const isEmpty = await detectEmptyResponse(client, sessionId)
            if (isEmpty) {
              await autoRetryEmptyResponse(client, sessionId)
              continue
            }
          }

          if (prev && prev !== status.type) emitTransition(sessionId, prev, status.type)
          continue
        }

        if (prev && prev !== status.type) emitTransition(sessionId, prev, status.type)

        if (status.type !== "retry") continue

        if (userAborted.has(sessionId)) {
          logger.debug({ sessionId }, "skipping retry handling: user aborted")
          continue
        }

        const message = (status as { message?: string }).message ?? ""
        if (!isUsageLimit(message)) continue

        const dedupKey = `${sessionId}:${message.slice(0, 80)}`
        if (!dedup(dedupKey)) continue

        if (Date.now() - lastSwitchAt < RECENT_SWITCH_GUARD_MS) {
          logger.debug({ sessionId, repoId }, "skipping switch, recent switch guard active")
          await repromptSession(client, sessionId)
          continue
        }

        logger.info({ sessionId, repoId, message: message.slice(0, 120) }, "rate limit detected, switching account")

        const activeId = await getActiveId()
        const result = await autoSwitch(activeId)

        if (result.switched) {
          lastSwitchAt = Date.now()
          logger.info({ from: result.from, to: result.to, label: result.label }, "account switched successfully")
          notify("账号切换", `已切换到「${result.label}」并自动重试`)
          await repromptSession(client, sessionId)
        } else {
          logger.warn({ reason: result.reason, sessionId }, "account switch failed, session remains in retry")
          notify("账号切换失败", `所有账号不可用: ${result.reason}`)
        }
      }
    }
  } finally {
    polling = false
  }
}

export const sessionMonitor = {
  markAborted(sessionId: string): void {
    userAborted.add(sessionId)
    logger.info({ sessionId }, "session marked as user-aborted, monitor will skip retry")
  },

  register(repoId: string, client: OpenCodeClient): void {
    if (entries.some((e) => e.repoId === repoId)) return
    entries.push({ repoId, client })
    logger.info({ repoId }, "session monitor: registered")
  },

  unregister(repoId: string): void {
    const idx = entries.findIndex((e) => e.repoId === repoId)
    if (idx >= 0) entries.splice(idx, 1)
  },

  start(): void {
    if (timer) return
    timer = setInterval(() => {
      pollOnce().catch((err) => logger.error({ err }, "session monitor poll error"))
    }, POLL_INTERVAL_MS)
    logger.info("session monitor started")
  },

  stop(): void {
    if (timer) {
      clearInterval(timer)
      timer = undefined
    }
    entries.length = 0
    autoContinueCounts.clear()
    emptyRetryCounts.clear()
    idleResponseCounts.clear()
    lastUserMessageIds.clear()
    todoFingerprints.clear()
    userAborted.clear()
    logger.info("session monitor stopped")
  },
}
