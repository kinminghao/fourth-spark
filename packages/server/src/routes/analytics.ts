import { Hono } from "hono"
import { sql, and, gte, lt, eq, sum, count } from "drizzle-orm"
import { db } from "../db/index"
import { sessions, repos } from "../db/schema"

export const analyticsRoutes = new Hono()

interface AnalyticsSummary {
  cost: number
  tokensInput: number
  tokensOutput: number
  tokensReasoning: number
  tokensCacheRead: number
  tokensCacheWrite: number
  sessionCount: number
}

interface AnalyticsGroup extends AnalyticsSummary {
  key: string
  label: string
  repoId?: string
  date?: string
  agent?: string
  modelId?: string
  customAgentId?: string | null
  isSystem: boolean
}

interface AnalyticsResponse {
  groups: AnalyticsGroup[]
  total: AnalyticsSummary
}

const zeroes: AnalyticsSummary = {
  cost: 0, tokensInput: 0, tokensOutput: 0, tokensReasoning: 0,
  tokensCacheRead: 0, tokensCacheWrite: 0, sessionCount: 0,
}

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function addSummary(a: AnalyticsSummary, b: AnalyticsSummary): AnalyticsSummary {
  return {
    cost: a.cost + b.cost,
    tokensInput: a.tokensInput + b.tokensInput,
    tokensOutput: a.tokensOutput + b.tokensOutput,
    tokensReasoning: a.tokensReasoning + b.tokensReasoning,
    tokensCacheRead: a.tokensCacheRead + b.tokensCacheRead,
    tokensCacheWrite: a.tokensCacheWrite + b.tokensCacheWrite,
    sessionCount: a.sessionCount + b.sessionCount,
  }
}

// GET /api/analytics/summary?from=&to=&repoId=&groupBy=repo|day|agent
analyticsRoutes.get("/summary", async (c) => {
  const fromStr = c.req.query("from")
  const toStr = c.req.query("to")
  const repoId = c.req.query("repoId")
  const groupBy = c.req.query("groupBy") as "repo" | "day" | "agent" | undefined

  if (!fromStr || !toStr) {
    return c.json({ error: "from and to query params are required (ms timestamps)" }, 400)
  }
  const from = Number(fromStr)
  const to = Number(toStr)
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return c.json({ error: "from and to must be valid numbers" }, 400)
  }
  if (!groupBy || !["repo", "day", "agent"].includes(groupBy)) {
    return c.json({ error: "groupBy must be one of: repo, day, agent" }, 400)
  }

  const conditions = [
    gte(sessions.timeCreated, from),
    lt(sessions.timeCreated, to),
  ]
  if (repoId) {
    conditions.push(eq(sessions.repoId, repoId))
  }
  const where = and(...conditions)

  const isSystemExpr = sql<boolean>`(${sessions.title} LIKE '[internal]%')`

  let groups: AnalyticsGroup[]

  if (groupBy === "repo") {
    const rows = await db
      .select({
        repoId: sessions.repoId,
        repoName: repos.name,
        isSystem: isSystemExpr,
        cost: sum(sessions.cost),
        tokensInput: sum(sessions.tokensInput),
        tokensOutput: sum(sessions.tokensOutput),
        tokensReasoning: sum(sessions.tokensReasoning),
        tokensCacheRead: sum(sessions.tokensCacheRead),
        tokensCacheWrite: sum(sessions.tokensCacheWrite),
        sessionCount: count(),
      })
      .from(sessions)
      .leftJoin(repos, eq(sessions.repoId, repos.id))
      .where(where)
      .groupBy(sessions.repoId, repos.name, isSystemExpr)

    groups = rows.map((r) => ({
      key: `${r.repoId ?? "unknown"}-${r.isSystem ? "system" : "user"}`,
      label: r.repoName ?? r.repoId ?? "Unknown",
      repoId: r.repoId ?? undefined,
      isSystem: !!r.isSystem,
      cost: num(r.cost),
      tokensInput: num(r.tokensInput),
      tokensOutput: num(r.tokensOutput),
      tokensReasoning: num(r.tokensReasoning),
      tokensCacheRead: num(r.tokensCacheRead),
      tokensCacheWrite: num(r.tokensCacheWrite),
      sessionCount: num(r.sessionCount),
    }))
  } else if (groupBy === "day") {
    const dayExpr = sql<string>`to_char(to_timestamp(${sessions.timeCreated} / 1000.0), 'YYYY-MM-DD')`
    const rows = await db
      .select({
        date: dayExpr,
        isSystem: isSystemExpr,
        cost: sum(sessions.cost),
        tokensInput: sum(sessions.tokensInput),
        tokensOutput: sum(sessions.tokensOutput),
        tokensReasoning: sum(sessions.tokensReasoning),
        tokensCacheRead: sum(sessions.tokensCacheRead),
        tokensCacheWrite: sum(sessions.tokensCacheWrite),
        sessionCount: count(),
      })
      .from(sessions)
      .where(where)
      .groupBy(dayExpr, isSystemExpr)
      .orderBy(dayExpr)

    groups = rows.map((r) => ({
      key: `${r.date}-${r.isSystem ? "system" : "user"}`,
      label: r.date ?? "",
      date: r.date ?? undefined,
      isSystem: !!r.isSystem,
      cost: num(r.cost),
      tokensInput: num(r.tokensInput),
      tokensOutput: num(r.tokensOutput),
      tokensReasoning: num(r.tokensReasoning),
      tokensCacheRead: num(r.tokensCacheRead),
      tokensCacheWrite: num(r.tokensCacheWrite),
      sessionCount: num(r.sessionCount),
    }))
  } else {
    // groupBy === "agent"
    const modelIdExpr = sql<string>`(${sessions.model}->>'modelID')`
    const rows = await db
      .select({
        agent: sessions.agent,
        modelId: modelIdExpr,
        customAgentId: sessions.customAgentId,
        isSystem: isSystemExpr,
        cost: sum(sessions.cost),
        tokensInput: sum(sessions.tokensInput),
        tokensOutput: sum(sessions.tokensOutput),
        tokensReasoning: sum(sessions.tokensReasoning),
        tokensCacheRead: sum(sessions.tokensCacheRead),
        tokensCacheWrite: sum(sessions.tokensCacheWrite),
        sessionCount: count(),
      })
      .from(sessions)
      .where(where)
      .groupBy(sessions.agent, modelIdExpr, sessions.customAgentId, isSystemExpr)

    groups = rows.map((r) => ({
      key: `${r.agent ?? "unknown"}-${r.modelId ?? "unknown"}-${r.isSystem ? "system" : "user"}`,
      label: r.agent ?? r.modelId ?? "Unknown",
      agent: r.agent ?? undefined,
      modelId: r.modelId ?? undefined,
      customAgentId: r.customAgentId,
      isSystem: !!r.isSystem,
      cost: num(r.cost),
      tokensInput: num(r.tokensInput),
      tokensOutput: num(r.tokensOutput),
      tokensReasoning: num(r.tokensReasoning),
      tokensCacheRead: num(r.tokensCacheRead),
      tokensCacheWrite: num(r.tokensCacheWrite),
      sessionCount: num(r.sessionCount),
    }))
  }

  const total = groups.reduce<AnalyticsSummary>((acc, g) => addSummary(acc, g), { ...zeroes })

  const response: AnalyticsResponse = { groups, total }
  return c.json(response)
})
