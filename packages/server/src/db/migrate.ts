import postgres from "postgres"
import { resolve, join, dirname } from "node:path"
import { existsSync, realpathSync, readFileSync } from "node:fs"

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://fourth_spark:fourth_spark@localhost:5432/fourth_spark"

interface JournalEntry {
  idx: number
  tag: string
}

/**
 * Make a single SQL statement idempotent so it won't fail if the target
 * object already exists (handles the push→migrate transition).
 */
function makeIdempotent(sql: string): string {
  let s = sql.trim()
  if (!s) return s

  // CREATE TABLE → CREATE TABLE IF NOT EXISTS
  s = s.replace(
    /^CREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS\b)/i,
    "CREATE TABLE IF NOT EXISTS ",
  )

  // ALTER TABLE ... ADD COLUMN → ADD COLUMN IF NOT EXISTS  (PG 9.6+)
  s = s.replace(
    /\bADD\s+COLUMN\s+(?!IF\s+NOT\s+EXISTS\b)/gi,
    "ADD COLUMN IF NOT EXISTS ",
  )

  // CREATE [UNIQUE] INDEX → CREATE ... INDEX IF NOT EXISTS  (PG 9.5+)
  s = s.replace(
    /^CREATE\s+(UNIQUE\s+)?INDEX\s+(?!IF\s+NOT\s+EXISTS\b|CONCURRENTLY\b)/i,
    (_, unique) => `CREATE ${unique ?? ""}INDEX IF NOT EXISTS `,
  )

  // ALTER TABLE ... ADD CONSTRAINT → wrap in DO block to swallow duplicate_object
  if (/^ALTER\s+TABLE\b.*\bADD\s+CONSTRAINT\b/i.test(s)) {
    const escaped = s.replace(/'/g, "''")
    s = `DO $$ BEGIN EXECUTE '${escaped}'; EXCEPTION WHEN duplicate_object THEN NULL; END $$`
  }

  return s
}

/**
 * Idempotent migration runner.
 *
 * Unlike drizzle's built-in `migrate()`, this runner makes every SQL
 * statement safe to re-execute.  This is critical when the database was
 * originally created with `drizzle-kit push` (no journal table) and we
 * later switch to file-based migrations — the standard migrator would
 * fail on "relation already exists".
 *
 * Returns true if any migrations were applied.
 */
export async function runMigrations(): Promise<boolean> {
  const binaryDir = (() => {
    try { return dirname(realpathSync(process.execPath)) }
    catch { return process.cwd() }
  })()

  const migrationsFolder = resolve(
    process.env.MIGRATIONS_DIR ?? join(binaryDir, "drizzle"),
  )
  const journalPath = join(migrationsFolder, "meta", "_journal.json")
  if (!existsSync(journalPath)) {
    console.warn(`[migrate] migration journal not found at ${journalPath} — skipping migrations`)
    return false
  }

  const journal: { entries: JournalEntry[] } = JSON.parse(
    readFileSync(journalPath, "utf-8"),
  )
  if (journal.entries.length === 0) return false

  const client = postgres(DATABASE_URL, { max: 1 })
  try {
    await client`
      CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `

    const applied = await client`SELECT hash FROM "__drizzle_migrations"`
    const appliedSet = new Set(applied.map((r) => r.hash as string))

    let count = 0
    for (const entry of journal.entries) {
      if (appliedSet.has(entry.tag)) continue

      const sqlPath = join(migrationsFolder, `${entry.tag}.sql`)
      if (!existsSync(sqlPath)) continue

      const sql = readFileSync(sqlPath, "utf-8")
      const statements = sql
        .split("--> statement-breakpoint")
        .map((s) => s.trim())
        .filter(Boolean)

      for (const stmt of statements) {
        await client.unsafe(makeIdempotent(stmt))
      }

      await client`
        INSERT INTO "__drizzle_migrations" (hash, created_at)
        VALUES (${entry.tag}, ${Date.now()})
      `
      count++
    }

    return count > 0
  } finally {
    await client.end()
  }
}
