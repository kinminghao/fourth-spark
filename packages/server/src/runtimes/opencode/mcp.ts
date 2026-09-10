// ---------------------------------------------------------------------------
// OpenCode MCP config injection — writes our MCP server entry into the repo's
// opencode.json so the agent can call Git platform tools automatically.
// Extracted from lib/process-manager.ts.
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import { logger } from "../../middleware/logger"

const MCP_SERVER_KEY = "fourth-spark-git"

export function injectMcpConfig(localPath: string, repoId: string, serverPort: number, sessionId?: string): void {
  const configPath = join(localPath, "opencode.json")
  let config: Record<string, unknown> = {}
  try {
    if (existsSync(configPath)) {
      config = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>
    }
  } catch {
    // corrupt or missing — start fresh
  }

  const mcpPath = sessionId
    ? `/api/repos/${repoId}/mcp/s/${sessionId}`
    : `/api/repos/${repoId}/mcp`

  const mcp = (config.mcp ?? {}) as Record<string, unknown>
  mcp[MCP_SERVER_KEY] = {
    type: "remote",
    url: `http://127.0.0.1:${serverPort}${mcpPath}`,
  }
  config.mcp = mcp
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n")
  logger.info({ repoId, sessionId, configPath }, "injected MCP config into opencode.json")
}

/**
 * Write the top-level `"model"` field into opencode.json so that OpenCode uses
 * it as the default for ALL sessions — including subtasks spawned internally by
 * the `task` tool.  Without this, only the first prompt carries the per-prompt
 * model override while child sessions fall back to the provider default.
 *
 * Passing `undefined` removes the field (reverts to provider default).
 */
export function injectModelConfig(localPath: string, model: string | undefined): void {
  const configPath = join(localPath, "opencode.json")
  let config: Record<string, unknown> = {}
  try {
    if (existsSync(configPath)) {
      config = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>
    }
  } catch {
    // corrupt or missing — start fresh
  }

  if (model) {
    config.model = model
  } else {
    delete config.model
  }
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n")
  logger.info({ localPath, model: model ?? "(removed)" }, "injected model config into opencode.json")
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
