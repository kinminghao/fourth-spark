import { Hono } from "hono"
import { processManager } from "../lib/process-manager"
import type { Provider, ProviderModel } from "../lib/opencode"

export const modelRoutes = new Hono()

type ModelInfo = {
  id: string
  name: string
  providerID: string
  providerName: string
  cost?: { input?: number; output?: number }
  contextLimit?: number
}

function isTextModel(m: ProviderModel): boolean {
  // If capabilities are available, use them
  if (m.capabilities) {
    if (m.capabilities.output?.text === false) return false
  }
  // Filter out known non-text model patterns by name/id
  const id = (m.id || "").toLowerCase()
  const skip = ["whisper", "tts", "dall-e", "image", "embedding", "moderation"]
  return !skip.some((s) => id.includes(s))
}

modelRoutes.get("/", async (c) => {
  const repoId = c.req.param("repoId")
  const client = processManager.requireClient(repoId)

  let raw: Record<string, Provider>
  try {
    raw = await client.getProviders()
  } catch {
    return c.json([])
  }

  const providers: Provider[] = Object.entries(raw).map(([id, p]) => ({ ...p, id: p.id || id }))

  const models: ModelInfo[] = []
  for (const provider of providers) {
    if (!provider.models) continue
    const providerModels: ProviderModel[] = Array.isArray(provider.models)
      ? provider.models
      : Object.values(provider.models as Record<string, ProviderModel>)
    for (const m of providerModels) {
      if (m.status && m.status !== "active") continue
      if (!isTextModel(m)) continue
      models.push({
        id: `${provider.id}/${m.id}`,
        name: m.name || m.id,
        providerID: provider.id,
        providerName: provider.name || provider.id,
        cost: m.cost,
        contextLimit: m.limit?.context,
      })
    }
  }

  return c.json(models)
})
