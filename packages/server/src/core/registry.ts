import { giteaPlatformFactory, githubPlatformFactory, gitlabPlatformFactory } from "../lib/git-provider"
import { localAccountPool } from "../lib/local-account-pool"
import { gitToolProvider } from "../mcp/git-tools"
import { openCodeCredentialWriter } from "../runtimes/opencode/credential"
import type { RuntimeProvider } from "./runtime-provider"
import type { CredentialWriter } from "./runtime-types"
import type { AccountPool, AgentRuntime, GitPlatformFactory, McpToolProvider } from "./types"

export interface PluginRegistry {
  runtime?: AgentRuntime
  accountPool?: AccountPool
  mcpTools: McpToolProvider[]
  gitPlatforms: Map<string, GitPlatformFactory>
  providers: Map<string, RuntimeProvider>
  credentialWriter: CredentialWriter
}

let instance: PluginRegistry | undefined

export function createDefaultRegistry(): PluginRegistry {
  return {
    accountPool: localAccountPool,
    mcpTools: [gitToolProvider],
    gitPlatforms: new Map([
      ["github", githubPlatformFactory],
      ["gitea", giteaPlatformFactory],
      ["gitlab", gitlabPlatformFactory],
    ]),
    providers: new Map(),
    credentialWriter: openCodeCredentialWriter,
  }
}

export function initRegistry(overrides?: Partial<PluginRegistry>): PluginRegistry {
  const base = createDefaultRegistry()
  instance = overrides ? { ...base, ...overrides } : base
  return instance
}

export function getRegistry(): PluginRegistry {
  if (!instance) throw new Error("Registry not initialized")
  return instance
}
