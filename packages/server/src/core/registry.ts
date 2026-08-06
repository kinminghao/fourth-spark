import type {
  NotificationChannel,
  McpToolProvider,
  GitPlatformFactory,
  AccountPool,
  AgentRuntime,
} from "./types"
import { desktopNotificationChannel } from "../lib/notify"
import { apnsNotificationChannel } from "../lib/apns"
import { gitToolProvider } from "../mcp/git-tools"
import {
  githubPlatformFactory,
  giteaPlatformFactory,
  gitlabPlatformFactory,
} from "../lib/git-provider"
import { localAccountPool } from "../lib/local-account-pool"

export interface PluginRegistry {
  runtime?: AgentRuntime
  accountPool?: AccountPool
  notifications: NotificationChannel[]
  mcpTools: McpToolProvider[]
  gitPlatforms: Map<string, GitPlatformFactory>
}

let instance: PluginRegistry | undefined

export function createDefaultRegistry(): PluginRegistry {
  return {
    accountPool: localAccountPool,
    notifications: [desktopNotificationChannel, apnsNotificationChannel],
    mcpTools: [gitToolProvider],
    gitPlatforms: new Map([
      ["github", githubPlatformFactory],
      ["gitea", giteaPlatformFactory],
      ["gitlab", gitlabPlatformFactory],
    ]),
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
