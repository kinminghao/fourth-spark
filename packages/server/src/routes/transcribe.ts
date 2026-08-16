import { Hono } from "hono"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { unlinkSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { transcribe, getSenseVoicePaths } from "../lib/sensevoice-manager"

export const transcribeRoute = new Hono()

transcribeRoute.get("/status", (c) => {
  const paths = getSenseVoicePaths()
  return c.json({ available: paths.available })
})

transcribeRoute.post("/", async (c) => {
  const paths = getSenseVoicePaths()
  if (!paths.available) {
    return c.json({ error: "SenseVoice models not downloaded" }, 503)
  }

  const body = await c.req.parseBody()
  const audio = body["audio"]
  if (!(audio instanceof File)) {
    return c.json({ error: "missing audio file" }, 400)
  }

  const tmpPath = join(tmpdir(), `fourth-spark-stt-${randomUUID()}.wav`)

  try {
    const buffer = await audio.arrayBuffer()
    await Bun.write(tmpPath, buffer)

    const text = await transcribe(tmpPath)
    return c.json({ text })
  } finally {
    try { unlinkSync(tmpPath) } catch {}
  }
})
