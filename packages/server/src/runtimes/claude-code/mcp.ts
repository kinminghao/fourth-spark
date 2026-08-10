// ---------------------------------------------------------------------------
// Claude Code MCP config injection — writes our MCP server entry into the
// repo's .mcp.json (Claude Code reads this automatically at cwd) so the agent
// can call Git platform tools without further configuration.
// ---------------------------------------------------------------------------

import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { logger } from "../../middleware/logger"

const MCP_FILE = ".mcp.json"
const MCP_SERVER_KEY = "fourth-spark-git"

export function injectMcpConfig(localPath: string, repoId: string, serverPort: number): void {
  const filePath = join(localPath, MCP_FILE)
  let config: Record<string, unknown> = {}
  try {
    if (existsSync(filePath)) {
      config = JSON.parse(readFileSync(filePath, "utf-8")) as Record<string, unknown>
    }
  } catch {
    // corrupt or missing — start fresh
  }

  const mcpServers = (config.mcpServers ?? {}) as Record<string, unknown>
  mcpServers[MCP_SERVER_KEY] = {
    type: "http",
    url: `http://127.0.0.1:${serverPort}/api/repos/${repoId}/mcp`,
  }
  config.mcpServers = mcpServers
  writeFileSync(filePath, JSON.stringify(config, null, 2) + "\n")
  logger.info({ repoId, filePath }, "injected MCP config into .mcp.json for Claude Code")
}

export function removeMcpConfig(localPath: string): void {
  const filePath = join(localPath, MCP_FILE)
  try {
    if (!existsSync(filePath)) return
    const config = JSON.parse(readFileSync(filePath, "utf-8")) as Record<string, unknown>
    const mcpServers = config.mcpServers as Record<string, unknown> | undefined
    if (!mcpServers?.[MCP_SERVER_KEY]) return

    delete mcpServers[MCP_SERVER_KEY]
    if (Object.keys(mcpServers).length === 0) delete config.mcpServers

    // If config is effectively empty (only $schema or nothing), remove the file
    const meaningful = Object.keys(config).filter((k) => k !== "$schema")
    if (meaningful.length === 0) {
      unlinkSync(filePath)
    } else {
      writeFileSync(filePath, JSON.stringify(config, null, 2) + "\n")
    }
  } catch {
    // best-effort cleanup
  }
}
