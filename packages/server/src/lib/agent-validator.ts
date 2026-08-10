import type { RuntimeClient } from "../core/runtime-client"

const cache = new Map<string, { names: Set<string>; expiresAt: number }>()
const CACHE_TTL_MS = 60_000

export async function isValidAgent(client: RuntimeClient, name: string | undefined): Promise<boolean> {
  if (!name) return false
  const key = client.directory
  const cached = cache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.names.has(name)
  try {
    const agents = await client.listAgents()
    const names = new Set(agents.flatMap((a) => [a.id, a.name].filter(Boolean)))
    cache.set(key, { names, expiresAt: Date.now() + CACHE_TTL_MS })
    return names.has(name)
  } catch {
    return true // on fetch failure, pass through to avoid silent drops
  }
}

export async function resolveAgent(client: RuntimeClient, name: string | undefined): Promise<string | undefined> {
  if (!name) return undefined
  return await isValidAgent(client, name) ? name : undefined
}
