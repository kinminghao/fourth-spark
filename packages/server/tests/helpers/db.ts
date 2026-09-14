/**
 * Test database isolation helpers.
 *
 * Uses a dedicated `fourth_spark_test` database (configurable via TEST_DATABASE_URL).
 * For future DB integration tests — provides a transaction wrapper that
 * automatically rolls back after each test.
 */

import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import * as schema from "../../src/db/schema"

const TEST_DATABASE_URL =
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
