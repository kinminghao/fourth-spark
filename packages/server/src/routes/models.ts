import { Hono } from "hono"
import { runtimeManager } from "../lib/process-manager"
import type { Provider, ProviderModel } from "../core/runtime-types"

export const modelRoutes = new Hono()

type ModelInfo = {
  id: string
  name: string
  providerID: string
  providerName: string
  configured: boolean
  cost?: { input?: number; output?: number }
  contextLimit?: number
  supportsImage: boolean
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
  const client = runtimeManager.requireClient(repoId)

  let providers: Provider[]
  let connectedIds: Set<string>
  try {
    const res = await client.getProviders()
    providers = res.all ?? []
    const raw = res.connected
    connectedIds = new Set(Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [])
  } catch {
    return c.json([])
  }

  const models: ModelInfo[] = []
  for (const provider of providers) {
    if (!provider.models) continue
    const providerModels: ProviderModel[] = Object.values(provider.models)
    for (const m of providerModels) {
      if (m.status && m.status !== "active") continue
      if (!isTextModel(m)) continue
      models.push({
        id: `${provider.id}/${m.id}`,
        name: m.name || m.id,
        providerID: provider.id,
        providerName: provider.name || provider.id,
        configured: connectedIds.has(provider.id),
        cost: m.cost,
        contextLimit: m.limit?.context,
        // runtimes without capability data (claude-code) default to allowed
        supportsImage: m.capabilities?.input?.image !== false,
      })
    }
  }

  return c.json(models)
})
