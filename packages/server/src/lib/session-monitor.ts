import { autoSwitch, getActiveId, isUsageLimit, clearCooldown } from "./account-switcher"
import type { OpenCodeClient, SessionStatus } from "./opencode"
import { notify } from "./notify"
import { logger } from "../middleware/logger"
import { DEFAULT_VARIANT } from "./config"

const POLL_INTERVAL_MS = 3_000
const RECENT_SWITCH_GUARD_MS = 5_000
const REPROMPT_SETTLE_MS = 1_500
const MAX_AUTO_CONTINUES = 5
const MAX_EMPTY_RETRIES = 2
const DEDUP_COOLDOWN_MS = 30_000

type ManagedEntry = {
  repoId: string
  client: OpenCodeClient
}

const handled = new Map<string, number>()
const repromptInFlight = new Set<string>()
const autoContinueCounts = new Map<string, number>()
const emptyRetryCounts = new Map<string, number>()
const prevStatuses = new Map<string, string>()
let lastSwitchAt = 0
let timer: ReturnType<typeof setInterval> | undefined
const entries: ManagedEntry[] = []

const STATUS_LABELS: Record<string, string> = { idle: "完成", busy: "运行中", retry: "重试中" }

function emitTransition(sessionId: string, from: string, to: string): void {
  const fromLabel = STATUS_LABELS[from] ?? from
  const toLabel = STATUS_LABELS[to] ?? to
  const sid = sessionId.slice(-8)
  if (from === "idle" && to === "busy") {
    notify("Session 开始", `[${sid}] 开始运行`)
  } else if (to === "idle" && from !== "idle") {
    notify("Session 完成", `[${sid}] ${fromLabel} → ${toLabel}`)
  } else if (to === "retry") {
    notify("Session 重试", `[${sid}] ${fromLabel} → ${toLabel}`)
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
    logger.info({ sessionId, count, max: MAX_EMPTY_RETRIES }, "auto-retried empty response")
    notify("自动重试", `[${sid}] 检测到空响应，已自动重试 (${count}/${MAX_EMPTY_RETRIES})`)
  } catch (err) {
    logger.warn({ err, sessionId }, "empty-response retry failed")
  }
}

async function detectTruncation(client: OpenCodeClient, sessionId: string): Promise<boolean> {
  const count = autoContinueCounts.get(sessionId) ?? 0
  if (count >= MAX_AUTO_CONTINUES) {
    logger.info({ sessionId, count }, "auto-continue limit reached, skipping")
    return false
  }
  try {
    const todos = await client.getTodos(sessionId)
    return todos.some((t) => t.status === "in_progress" || t.status === "pending")
  } catch {
    return false
  }
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
    logger.info({ sessionId, count, max: MAX_AUTO_CONTINUES }, "auto-continued truncated session")
    notify("自动续发", `[${sid}] 检测到响应截断，已自动继续 (${count}/${MAX_AUTO_CONTINUES})`)
  } catch (err) {
    logger.warn({ err, sessionId }, "auto-continue prompt failed")
  }
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

    const last = await getLastUserPrompt(client, sessionId)
    if (!last) {
      logger.warn({ sessionId }, "no user prompt found for reprompt, sending continue")
      await client.prompt(sessionId, "continue")
      return
    }
    await client.prompt(sessionId, last.content, { agent: last.agent, model: last.model, variant: last.variant })
    logger.info({ sessionId }, "reprompted session after account switch")
  } catch (err) {
    logger.warn({ err, sessionId }, "reprompt failed")
  } finally {
    repromptInFlight.delete(sessionId)
  }
}

let pollCount = 0

async function pollOnce(): Promise<void> {
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

        autoContinueCounts.delete(sessionId)
        emptyRetryCounts.delete(sessionId)
      }
    }

    for (const [sessionId, status] of Object.entries(statuses)) {
      const prev = prevStatuses.get(sessionId)
      prevStatuses.set(sessionId, status.type)

      if (status.type === "idle") {
        clearCooldown(await getActiveId() ?? "")

        // Truncation auto-continue: if session was busy and is now idle with
        // incomplete todos, the model response was likely truncated by
        // max_output_tokens.  Send "continue" to let the agent resume.
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
        autoContinueCounts.delete(sessionId)
        emptyRetryCounts.delete(sessionId)
        continue
      }

      if (prev && prev !== status.type) emitTransition(sessionId, prev, status.type)

      if (status.type !== "retry") continue

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
}

export const sessionMonitor = {
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
    logger.info("session monitor stopped")
  },
}
