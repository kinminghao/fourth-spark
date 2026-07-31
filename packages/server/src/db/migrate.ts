import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import postgres from "postgres"
import { resolve, join, dirname } from "node:path"
import { existsSync, realpathSync } from "node:fs"

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://fourth_spark:fourth_spark@localhost:5432/fourth_spark"

/**
 * Run pending SQL migrations from the drizzle folder.
 * Returns true if migrations were found and applied, false if the folder
 * doesn't exist (dev mode without a local drizzle/ copy).
 */
export async function runMigrations(): Promise<boolean> {
  const binaryDir = (() => {
    try { return dirname(realpathSync(process.execPath)) }
    catch { return process.cwd() }
  })()

  const migrationsFolder = resolve(
    process.env.MIGRATIONS_DIR ?? join(binaryDir, "drizzle"),
  )
  if (!existsSync(migrationsFolder)) {
    return false
  }

  const client = postgres(DATABASE_URL, { max: 1 })
  try {
    await migrate(drizzle(client), { migrationsFolder })
    return true
  } finally {
    await client.end()
  }
}
