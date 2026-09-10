import { z } from "zod"
import type { Context } from "hono"

/**
 * Parse and validate a JSON request body against a Zod schema.
 * Returns a tuple: [data, null] on success, [null, Response] on validation failure.
 *
 * Usage:
 *   const [body, err] = await parseBody(c, MySchema)
 *   if (err) return err
 *   // body is fully typed and validated
 */
export async function parseBody<T extends z.ZodType>(
  c: Context,
  schema: T,
): Promise<[z.infer<T>, null] | [null, Response]> {
  const raw = await c.req.json().catch(() => null)
  if (raw === null) {
    return [null, c.json({ error: "Invalid or missing JSON body" }, 400)]
  }
  const result = schema.safeParse(raw)
  if (!result.success) {
    const msg = result.error.issues
      .map((i) => {
        const path = i.path.length > 0 ? `${i.path.join(".")}: ` : ""
        return `${path}${i.message}`
      })
      .join("; ")
    return [null, c.json({ error: msg || "Validation failed" }, 400)]
  }
  return [result.data, null]
}

/**
 * Parse a JSON request body that may be absent (e.g. sync endpoints with optional filters).
 * Falls back to an empty object `{}` when body is missing or unparseable.
 * Returns a tuple like parseBody.
 */
export async function parseOptionalBody<T extends z.ZodType>(
  c: Context,
  schema: T,
): Promise<[z.infer<T>, null] | [null, Response]> {
  const raw = await c.req.json().catch(() => ({}))
  const result = schema.safeParse(raw)
  if (!result.success) {
    const msg = result.error.issues
      .map((i) => {
        const path = i.path.length > 0 ? `${i.path.join(".")}: ` : ""
        return `${path}${i.message}`
      })
      .join("; ")
    return [null, c.json({ error: msg || "Validation failed" }, 400)]
  }
  return [result.data, null]
}
