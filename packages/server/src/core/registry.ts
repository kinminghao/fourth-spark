import type {
  NotificationChannel,
  McpToolProvider,
  GitPlatformFactory,
  AccountPool,
  AgentRuntime,
} from "./types"
import { desktopNotificationChannel } from "../lib/notify"
import { apnsNotificationChannel } from "../lib/apns"

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
    notifications: [desktopNotificationChannel, apnsNotificationChannel],
    mcpTools: [],
    gitPlatforms: new Map(),
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
