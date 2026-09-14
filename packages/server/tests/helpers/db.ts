import { sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import * as schema from "../../src/db/schema"

const TEST_DATABASE_URL =
  process.env.DATABASE_URL ??
  process.env.TEST_DATABASE_URL ??
  "postgresql://fourth_spark:fourth_spark@localhost:5460/fourth_spark_test"

let testClient: ReturnType<typeof postgres> | null = null

export function getTestDb() {
  if (!testClient) {
    testClient = postgres(TEST_DATABASE_URL, {
      max: 5,
      idle_timeout: 10,
      connect_timeout: 5,
    })
  }
  return drizzle(testClient, { schema })
}

export async function closeTestDb() {
  if (testClient) {
    await testClient.end()
    testClient = null
  }
}

const TRUNCATE_ORDER = [
  schema.todos,
  schema.parts,
  schema.messages,
  schema.sessionLinks,
  schema.issueTags,
  schema.prIssueLinks,
  schema.issueComments,
  schema.customAgentFragments,
  schema.agentMemories,
  schema.workspaces,
  schema.sessions,
  schema.pullRequests,
  schema.issues,
  schema.milestones,
  schema.tags,
  schema.promptFragments,
  schema.customAgents,
  schema.gitHosts,
  schema.settings,
  schema.repos,
]

export async function truncateAll(db: ReturnType<typeof getTestDb>) {
  for (const table of TRUNCATE_ORDER) {
    await db.execute(sql`TRUNCATE TABLE ${table} CASCADE`)
  }
}
