import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import * as schema from "./schema"

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://fourth_spark:fourth_spark@localhost:5432/fourth_spark"

const client = postgres(DATABASE_URL, {
  max: 10,
  idle_timeout: 20,       // Close idle connections after 20s
  max_lifetime: 60 * 30,  // Recycle connections every 30 min — survives PG restarts
  connect_timeout: 10,    // Fail fast on unreachable DB
})
export const db = drizzle(client, { schema })
