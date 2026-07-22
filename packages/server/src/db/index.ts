import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import * as schema from "./schema"

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://fourth_spark:fourth_spark@localhost:5432/fourth_spark"

const client = postgres(DATABASE_URL)
export const db = drizzle(client, { schema })
