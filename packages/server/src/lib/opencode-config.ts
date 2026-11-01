import { homedir } from "node:os"
import { join } from "node:path"

export function globalOpencodeConfigDir(): string {
  return join(homedir(), ".config", "opencode")
}

export function globalAgentDirs(): string[] {
  const root = globalOpencodeConfigDir()
  return [join(root, "agents"), join(root, "agent")]
}
