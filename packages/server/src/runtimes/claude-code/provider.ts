// ---------------------------------------------------------------------------
// ClaudeCodeProvider — RuntimeProvider implementation for the Claude Code CLI.
//
// Unlike OpenCode (one long-running `opencode serve` HTTP process per repo),
// Claude Code is one `claude -p` subprocess PER SESSION, spawned lazily by
// StdioRuntimeClient on first prompt. The provider therefore keeps one client
// per repo and delegates all session-level lifecycle to it.
//
// Ownership:
//   * MCP config injection into .mcp.json (Claude's project-local MCP file)
//   * Health check via `claude --version` on PATH
//   * Bulk kill on shutdown
// ---------------------------------------------------------------------------

import type { RuntimeClient } from "../../core/runtime-client"
import type { RuntimeHealth, RuntimeProvider } from "../../core/runtime-provider"
import { logger } from "../../middleware/logger"

import { StdioRuntimeClient } from "./client"
import { claudeCodeCredentialWriter } from "./credential"
import { injectMcpConfig, removeMcpConfig } from "./mcp"

const RUNTIME_ID = "claude-code"

interface ManagedRepo {
  repoId: string
  localPath: string
  client: StdioRuntimeClient
}

export function createClaudeCodeProvider(serverPort: number): RuntimeProvider {
  const repos = new Map<string, ManagedRepo>()

  async function checkClaudeBinary(): Promise<{ ok: boolean; version?: string; error?: string }> {
    try {
      const proc = Bun.spawn(["claude", "--version"], {
        stdout: "pipe",
        stderr: "pipe",
      })
      const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ])
      if (code === 0) {
        return { ok: true, version: stdout.trim() || "unknown" }
      }
      return { ok: false, error: stderr.trim() || `exit ${code}` }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  return {
    id: RUNTIME_ID,
    credentialWriter: claudeCodeCredentialWriter,

    async initialize(repoId: string, localPath: string): Promise<void> {
      const existing = repos.get(repoId)
      if (existing) return

      injectMcpConfig(localPath, repoId, serverPort)
      const client = new StdioRuntimeClient(localPath)
      repos.set(repoId, { repoId, localPath, client })
      logger.info({ repoId, localPath }, "claude-code provider initialized for repo")
    },

    async teardown(repoId: string): Promise<void> {
      const entry = repos.get(repoId)
      if (!entry) return
      entry.client.killAll()
      removeMcpConfig(entry.localPath)
      repos.delete(repoId)
      logger.info({ repoId }, "claude-code provider torn down for repo")
    },

    isReady(repoId: string): boolean {
      return repos.has(repoId)
    },

    getClient(repoId: string): RuntimeClient | null {
      return repos.get(repoId)?.client ?? null
    },

    async healthCheck(repoId: string): Promise<RuntimeHealth> {
      const entry = repos.get(repoId)
      if (!entry) return { reachable: false }
      const check = await checkClaudeBinary()
      return {
        reachable: check.ok,
        details: {
          localPath: entry.localPath,
          ...(check.version ? { version: check.version } : {}),
          ...(check.error ? { error: check.error } : {}),
        },
      }
    },

    injectMcp(localPath: string, repoId: string, port: number): void {
      injectMcpConfig(localPath, repoId, port)
    },

    removeMcp(localPath: string): void {
      removeMcpConfig(localPath)
    },

    killAllSync(): void {
      for (const entry of repos.values()) {
        try {
          entry.client.killAll()
        } catch {
          // best-effort
        }
      }
      repos.clear()
    },
  }
}
