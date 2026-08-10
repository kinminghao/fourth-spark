// ---------------------------------------------------------------------------
// OpenCode MCP config injection — writes our MCP server entry into the repo's
// opencode.json so the agent can call Git platform tools automatically.
// Extracted from lib/process-manager.ts.
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import { logger } from "../../middleware/logger"

const MCP_SERVER_KEY = "fourth-spark-git"

export function injectMcpConfig(localPath: string, repoId: string, serverPort: number): void {
  const configPath = join(localPath, "opencode.json")
  let config: Record<string, unknown> = {}
  try {
    if (existsSync(configPath)) {
      config = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>
    }
  } catch {
    // corrupt or missing — start fresh
  }

  const mcp = (config.mcp ?? {}) as Record<string, unknown>
  mcp[MCP_SERVER_KEY] = {
    type: "remote",
    url: `http://127.0.0.1:${serverPort}/api/repos/${repoId}/mcp`,
  }
  config.mcp = mcp
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n")
  logger.info({ repoId, configPath }, "injected MCP config into opencode.json")
}

export function removeMcpConfig(localPath: string): void {
  const configPath = join(localPath, "opencode.json")
  try {
    if (!existsSync(configPath)) return
    const config = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>
    const mcp = config.mcp as Record<string, unknown> | undefined
    if (!mcp?.[MCP_SERVER_KEY]) return

    delete mcp[MCP_SERVER_KEY]
    if (Object.keys(mcp).length === 0) delete config.mcp

    // If config is effectively empty (only $schema or nothing), remove the file
    const meaningful = Object.keys(config).filter((k) => k !== "$schema")
    if (meaningful.length === 0) {
      unlinkSync(configPath)
    } else {
      writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n")
    }
  } catch {
    // best-effort cleanup
  }
}
