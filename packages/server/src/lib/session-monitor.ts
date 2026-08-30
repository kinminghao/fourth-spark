import { isUsageLimit } from "./account-switcher"
import type { RuntimeClient } from "../core/runtime-client"
import type { SessionStatus, Message, Todo } from "../core/runtime-types"
import { isValidAgent } from "./agent-validator"
import { getRegistry } from "../core/registry"
import type { NotifyEvent } from "../core/types"
import { logger } from "../middleware/logger"
import { DEFAULT_VARIANT } from "./config"
import { MEMORY_EXTRACTOR_ID, MEMORY_EXTRACTOR_PROMPT } from "./system-agents"
import { buildExtractionPrompt, buildFullExtractionPrompt, parseExtractionResult, executeActions, getSessionCustomAgentId, listExtractableSessions } from "./memory-extractor"
import { runMemoryConsolidation } from "./memory-consolidation"
import { unlink, readFile } from "node:fs/promises"
import { join } from "node:path"
import { DATA_DIR } from "../cli/paths"
import { resolveAgent } from "./agent-validator"
import { db } from "../db/index"
import { sessions as sessionsTable, customAgents } from "../db/schema"
import { syncMessagesList } from "../db/sync"
import { eq } from "drizzle-orm"

function emitNotification(event: NotifyEvent): void {
  const { notifications } = getRegistry()
  for (const ch of notifications) {
    ch.send(event).catch((err) => logger.debug({ err, channel: ch.id }, "notification send failed"))
  }
}

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
  client: RuntimeClient
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

// ---------------------------------------------------------------------------
// Memory extraction state
// ---------------------------------------------------------------------------
const EXTRACTION_TIMEOUT_MS = 600_000
const PROMPT_OVERRIDE_DIR = join(DATA_DIR, "prompts")

async function resolvePrompt(filename: string, fallback: string): Promise<string> {
  try {
    const content = await readFile(join(PROMPT_OVERRIDE_DIR, filename), "utf-8")
    if (content.trim()) {
      logger.info({ filename }, "using prompt override from file")
      return content.trim()
    }
  } catch { /* file not found, use fallback */ }
  return fallback
}
const EXTRACTION_SCAN_INTERVAL_MS = 4 * 60 * 60 * 1_000
let extractionScanTimer: ReturnType<typeof setInterval> | undefined
const pendingExtractions = new Map<string, Array<{ sourceSessionId: string; customAgentId: string }>>()
const extractingRepos = new Set<string>()

function emitTransition(sessionId: string, from: string, to: string): void {
  const notifyKey = `notify:${sessionId}`
  const lastNotify = handled.get(notifyKey)
  if (lastNotify && Date.now() - lastNotify < NOTIFY_COOLDOWN_MS) return
  handled.set(notifyKey, Date.now())

  const fromLabel = STATUS_LABELS[from] ?? from
  const toLabel = STATUS_LABELS[to] ?? to
  const sid = sessionId.slice(-8)
  if (from === "idle" && to === "busy") {
    emitNotification({
      type: "session_start",
      title: "Session 开始",
      body: `[${sid}] 开始运行`,
      sessionId,
    })
  } else if (to === "idle" && from !== "idle") {
    emitNotification({
      type: "session_complete",
      title: "Session 完成",
      body: `[${sid}] ${fromLabel} → ${toLabel}`,
      sessionId,
    })
  } else if (to === "retry") {
    emitNotification({
      type: "session_error",
      title: "Session 重试",
      body: `[${sid}] ${fromLabel} → ${toLabel}`,
      sessionId,
    })
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
  client: RuntimeClient,
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
        const rawAgent = assistantAfter?.info?.agent
        const agent = await isValidAgent(client, rawAgent) ? rawAgent : undefined
        return {
          content: text,
          agent,
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

async function detectEmptyResponse(client: RuntimeClient, sessionId: string): Promise<boolean> {
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

async function autoRetryEmptyResponse(client: RuntimeClient, sessionId: string): Promise<void> {
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

/** Returns true if auto-retry was triggered (caller should `continue`). */
async function handleEmptyResponse(client: RuntimeClient, sessionId: string): Promise<boolean> {
  const isEmpty = await detectEmptyResponse(client, sessionId)
  if (!isEmpty) return false

  const retryCount = emptyRetryCounts.get(sessionId) ?? 0
  if (retryCount < MAX_EMPTY_RETRIES) {
    await autoRetryEmptyResponse(client, sessionId)
    return true
  }

  // Retries exhausted — attempt account switch (empty responses are often
  // caused by rate-limit throttling that doesn't produce a clean error).
  const pool = getRegistry().accountPool
  if (pool && Date.now() - lastSwitchAt >= RECENT_SWITCH_GUARD_MS) {
    const activeId = await pool.getActiveId()
    await pool.reportLimit({ accountId: activeId ?? "", message: "empty response after retries (suspected rate limit)" })
    const result = await pool.acquire({ reason: "ratelimit", currentAccountId: activeId ?? "" })
    if (result.ok) {
      lastSwitchAt = Date.now()
      emptyRetryCounts.delete(sessionId)
      logger.info({ from: activeId, to: result.accountId, sessionId }, "account switched after empty-response retries exhausted")
      emitNotification({
        type: "account_switched",
        title: "账号切换",
        body: "空响应重试耗尽，已切换账号并重试",
        sessionId,
      })
      await repromptSession(client, sessionId)
      return true
    }
    logger.warn({ reason: result.reason, sessionId }, "account switch failed after empty-response retries")
  }

  const sid = sessionId.slice(-8)
  logger.warn({ sessionId, retryCount }, "empty-response retry limit exhausted, notifying user")
  emitNotification({
    type: "session_error",
    title: "空响应",
    body: `[${sid}] Agent 返回空响应，已达重试上限`,
    sessionId,
  })
  return false
}

async function hasIncompleteTodos(client: RuntimeClient, sessionId: string): Promise<boolean> {
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

async function detectTruncation(client: RuntimeClient, sessionId: string): Promise<boolean> {
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

async function autoContinueSession(client: RuntimeClient, sessionId: string): Promise<void> {
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

function collectAssistantParts(messages: Message[]): NonNullable<Message["parts"]> {
  const lastUserIdx = messages.findLastIndex((m) => m.role === "user")
  if (lastUserIdx < 0) return []
  const parts: NonNullable<Message["parts"]> = []
  for (let i = lastUserIdx + 1; i < messages.length; i++) {
    if (messages[i].role === "assistant") {
      for (const p of messages[i].parts ?? []) parts.push(p)
    }
  }
  return parts
}

function hasSubstantialProgress(messages: Message[]): boolean {
  const parts = collectAssistantParts(messages)
  if (parts.length === 0) return false
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

async function repromptSession(client: RuntimeClient, sessionId: string): Promise<void> {
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

async function triggerMemoryExtraction(repoId: string, client: RuntimeClient, sourceSessionId: string): Promise<void> {
  const customAgentId = await getSessionCustomAgentId(sourceSessionId)
  if (!customAgentId) return

  if (extractingRepos.has(repoId)) {
    const queue = pendingExtractions.get(repoId) ?? []
    queue.push({ sourceSessionId, customAgentId })
    pendingExtractions.set(repoId, queue)
    logger.info({ repoId, sourceSessionId, queueSize: queue.length }, "memory extraction queued")
    return
  }

  extractingRepos.add(repoId)
  await startExtraction(repoId, client, sourceSessionId, customAgentId)
}

async function startExtraction(repoId: string, client: RuntimeClient, sourceSessionId: string, customAgentId: string): Promise<void> {
  let extractionSessionId: string | undefined
  const outputPath = `/tmp/memory-extract-${crypto.randomUUID()}.json`
  try {
    try {
      const msgs = await client.getMessages(sourceSessionId)
      syncMessagesList(sourceSessionId, msgs)
    } catch { /* best-effort sync */ }

    const prompt = await buildExtractionPrompt(sourceSessionId, customAgentId)
    if (!prompt) {
      processNextExtraction(repoId)
      return
    }

    await Bun.write(outputPath, "[]")

    const agent = await resolveAgent(client, "Sisyphus - ultraworker")
    const session = await client.createSession({ agent, title: `[internal] memory extraction` })
    extractionSessionId = session.id

    await db.insert(sessionsTable).values({
      id: session.id,
      title: `[internal] memory extraction`,
      customAgentId: MEMORY_EXTRACTOR_ID,
      agent: agent ?? null,
      timeCreated: Date.now(),
      timeUpdated: Date.now(),
    }).onConflictDoUpdate({
      target: sessionsTable.id,
      set: { customAgentId: MEMORY_EXTRACTOR_ID, timeUpdated: Date.now() },
    })

    const [agentConfig] = await db.select({ memoryModel: customAgents.memoryModel })
      .from(customAgents)
      .where(eq(customAgents.id, customAgentId))
    const memoryModel = agentConfig?.memoryModel ?? null

    const extractorPrompt = await resolvePrompt("memory-extractor.md", MEMORY_EXTRACTOR_PROMPT)
    const fullPrompt = buildFullExtractionPrompt(extractorPrompt, outputPath, prompt)
    await client.prompt(session.id, fullPrompt, { agent, variant: DEFAULT_VARIANT, model: memoryModel ?? undefined })
    logger.info({ sessionId: session.id, sourceSessionId, outputPath }, "memory extraction started, waiting for result")

    const startedAt = Date.now()
    while (Date.now() - startedAt < EXTRACTION_TIMEOUT_MS) {
      await new Promise(r => setTimeout(r, 2_000))
      try {
        const statuses = await client.getSessionStatus()
        const s = statuses[session.id]
        if (s && (s.type === "busy" || s.type === "retry")) continue
      } catch { continue }
      break
    }

    const file = Bun.file(outputPath)
    const resultText = (await file.exists()) ? (await file.text()).trim() : ""
    logger.info({ sessionId: session.id, sourceSessionId, resultLen: resultText.length }, "memory extraction file read")

    if (resultText && resultText !== "[]") {
      const actions = parseExtractionResult(resultText)
      if (actions.length > 0) {
        await executeActions(customAgentId, sourceSessionId, actions)
        logger.info({ sessionId: session.id, actionCount: actions.length, sourceSessionId }, "memory extraction completed")
      }
    }
  } catch (err) {
    logger.warn({ err, sourceSessionId }, "memory extraction failed")
  } finally {
    const debugKeep = process.env.MEMORY_DEBUG === "true"
    if (extractionSessionId && !debugKeep) client.deleteSession(extractionSessionId).catch(() => {})
    if (!debugKeep) { try { await unlink(outputPath) } catch {} }
    processNextExtraction(repoId)
  }
}

function processNextExtraction(repoId: string): void {
  const queue = pendingExtractions.get(repoId)
  if (!queue || queue.length === 0) {
    extractingRepos.delete(repoId)
    return
  }
  const next = queue.shift()!
  if (queue.length === 0) pendingExtractions.delete(repoId)

  const repoEntry = entries.find(e => e.repoId === repoId)
  if (repoEntry) {
    startExtraction(repoId, repoEntry.client, next.sourceSessionId, next.customAgentId).catch(err => {
      logger.warn({ err, sourceSessionId: next.sourceSessionId }, "failed to start queued extraction")
      processNextExtraction(repoId)
    })
  } else {
    extractingRepos.delete(repoId)
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
          {
            const pool = getRegistry().accountPool
            if (pool?.release) {
              const id = await pool.getActiveId()
              if (id) await pool.release(id)
            }
          }

          if (prev === "busy" || prev === "retry") {
            if (prev === "busy") {
              const shouldContinue = await detectTruncation(client, sessionId)
              if (shouldContinue) {
                await autoContinueSession(client, sessionId)
                continue
              }
            }

            if (await handleEmptyResponse(client, sessionId)) {
              continue
            }
          }
        }
      }

      for (const [sessionId, status] of Object.entries(statuses)) {
        const prev = prevStatuses.get(sessionId)
        prevStatuses.set(sessionId, status.type)

        if (status.type === "idle") {
          {
            const pool = getRegistry().accountPool
            if (pool?.release) {
              const id = await pool.getActiveId()
              if (id) await pool.release(id)
            }
          }

          if (prev === "busy" || prev === "retry") {
            if (prev === "busy") {
              const shouldContinue = await detectTruncation(client, sessionId)
              if (shouldContinue) {
                await autoContinueSession(client, sessionId)
                continue
              }
            }

            if (await handleEmptyResponse(client, sessionId)) {
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

        const pool = getRegistry().accountPool
        if (!pool) {
          logger.warn({ sessionId }, "no account pool configured, cannot switch")
          continue
        }
        const activeId = await pool.getActiveId()
        await pool.reportLimit({ accountId: activeId ?? "", message })
        const result = await pool.acquire({ reason: "ratelimit", currentAccountId: activeId ?? "" })
        if (result.ok) {
          lastSwitchAt = Date.now()
          logger.info({ from: activeId, to: result.accountId, sessionId }, "account switched successfully")
          emitNotification({
            type: "account_switched",
            title: "账号切换",
            body: "已切换到新账号并自动重试",
            sessionId,
          })
          await repromptSession(client, sessionId)
        } else {
          logger.warn({ reason: result.reason, sessionId }, "account switch failed, session remains in retry")
          emitNotification({
            type: "account_switch_failed",
            title: "账号切换失败",
            body: `所有账号不可用: ${result.reason}`,
            sessionId,
          })
        }
      }
    }
  } finally {
    polling = false
  }
}

async function runExtractionScan(): Promise<void> {
  const sessions = await listExtractableSessions()
  if (sessions.length === 0) return
  logger.info({ count: sessions.length }, "memory extraction scan: found sessions needing extraction")

  for (const { id: sessionId } of sessions) {
    for (const { repoId, client } of entries) {
      try {
        await client.getSession(sessionId)
        triggerMemoryExtraction(repoId, client, sessionId).catch(err =>
          logger.warn({ err, sessionId }, "scheduled memory extraction failed"))
        break
      } catch { continue }
    }
  }
}

export const sessionMonitor = {
  markAborted(sessionId: string): void {
    userAborted.add(sessionId)
    logger.info({ sessionId }, "session marked as user-aborted, monitor will skip retry")
  },

  extractMemory(sourceSessionId: string): void {
    const tryAll = async () => {
      for (const { repoId, client } of entries) {
        try {
          await client.getSession(sourceSessionId)
          await triggerMemoryExtraction(repoId, client, sourceSessionId)
          return
        } catch { continue }
      }
      logger.warn({ sourceSessionId }, "no running process found for session")
    }
    tryAll().catch(err => logger.warn({ err, sourceSessionId }, "manual memory extraction failed"))
  },

  register(repoId: string, client: RuntimeClient): void {
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

    if (!extractionScanTimer) {
      const runExtractionAndConsolidation = async () => {
        await runExtractionScan()
        await runMemoryConsolidation(entries)
      }
      extractionScanTimer = setInterval(() => {
        runExtractionAndConsolidation().catch((err) => logger.error({ err }, "memory extraction/consolidation scan error"))
      }, EXTRACTION_SCAN_INTERVAL_MS)
      setTimeout(() => {
        runExtractionAndConsolidation().catch((err) => logger.error({ err }, "initial memory extraction/consolidation scan error"))
      }, 60_000)
    }

    logger.info("session monitor started")
  },

  stop(): void {
    if (timer) {
      clearInterval(timer)
      timer = undefined
    }
    if (extractionScanTimer) {
      clearInterval(extractionScanTimer)
      extractionScanTimer = undefined
    }
    entries.length = 0
    autoContinueCounts.clear()
    emptyRetryCounts.clear()
    idleResponseCounts.clear()
    lastUserMessageIds.clear()
    todoFingerprints.clear()
    userAborted.clear()
    pendingExtractions.clear()
    extractingRepos.clear()
    logger.info("session monitor stopped")
  },
}
