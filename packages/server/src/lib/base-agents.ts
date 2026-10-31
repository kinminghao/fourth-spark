import { readdir, readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join, relative, sep } from "node:path"

export type BaseAgentOption = {
  name: string
  description?: string
  source: "builtin" | "local"
}

export const BUILTIN_BASE_AGENTS: ReadonlyArray<BaseAgentOption> = [
  { name: "Sisyphus - ultraworker", source: "builtin" },
  { name: "Prometheus - Plan Builder", source: "builtin" },
  { name: "Atlas - Plan Executor", source: "builtin" },
  { name: "Hephaestus - Deep Agent", source: "builtin" },
]

const LOCAL_AGENT_DIRS = [
  join(homedir(), ".config", "opencode", "agents"),
  join(homedir(), ".config", "opencode", "agent"),
]

function stripQuotes(value: string): string {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1)
  }
  return value
}

// Minimal frontmatter reader: the scanner only needs name, description, mode
// and disable. Avoids adding a YAML dependency for four scalar fields.
function parseFrontmatter(content: string): Record<string, string> {
  const match = content.replace(/^\uFEFF/, "").match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return {}

  const data: Record<string, string> = {}
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!field) continue
    const value = field[2].trim()
    if (!value || value === "|" || value === ">") continue
    data[field[1]] = stripQuotes(value)
  }
  return data
}

async function collectMarkdownFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])

  const files: string[] = []
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectMarkdownFiles(path)))
    } else if ((entry.isFile() || entry.isSymbolicLink()) && entry.name.endsWith(".md")) {
      files.push(path)
    }
  }
  return files
}

async function readLocalAgent(dir: string, file: string): Promise<BaseAgentOption | undefined> {
  let content: string
  try {
    content = await readFile(file, "utf-8")
  } catch {
    return undefined
  }

  const frontmatter = parseFrontmatter(content)
  if (frontmatter.mode === "subagent" || frontmatter.disable === "true") return undefined

  const fallbackName = relative(dir, file).replace(/\.md$/, "").split(sep).join("/")
  const name = frontmatter.name?.trim() || fallbackName
  if (!name) return undefined

  return {
    name,
    ...(frontmatter.description ? { description: frontmatter.description } : {}),
    source: "local",
  }
}

export async function scanLocalAgents(dirs: string[] = LOCAL_AGENT_DIRS): Promise<BaseAgentOption[]> {
  const seen = new Set<string>()
  const agents: BaseAgentOption[] = []

  for (const dir of dirs) {
    for (const file of await collectMarkdownFiles(dir)) {
      const agent = await readLocalAgent(dir, file)
      if (!agent || seen.has(agent.name)) continue
      seen.add(agent.name)
      agents.push(agent)
    }
  }

  return agents.sort((a, b) => a.name.localeCompare(b.name))
}

export async function listBaseAgents(dirs: string[] = LOCAL_AGENT_DIRS): Promise<BaseAgentOption[]> {
  const local = await scanLocalAgents(dirs)
  const seen = new Set(BUILTIN_BASE_AGENTS.map((agent) => agent.name))
  return [...BUILTIN_BASE_AGENTS, ...local.filter((agent) => !seen.has(agent.name))]
}

export async function validateBaseAgent(name: string, dirs?: string[]): Promise<string | null> {
  const agents = await listBaseAgents(dirs)
  if (agents.some((agent) => agent.name === name)) return null
  return `baseAgent must be one of: ${agents.map((agent) => agent.name).join(", ")}`
}
