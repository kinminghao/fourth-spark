import { appendFile, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { DATA_DIR } from "../cli/paths"
import { logger } from "../middleware/logger"

export const MEMORY_LOG_ROOT = join(DATA_DIR, "memory-logs")

async function writeAgentLog(agentId: string, prefix: string, entry: Record<string, unknown>): Promise<void> {
  try {
    const dir = join(MEMORY_LOG_ROOT, agentId)
    await mkdir(dir, { recursive: true })
    const filename = `${prefix}-${new Date().toISOString().slice(0, 10)}.jsonl`
    const line = `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`
    await appendFile(join(dir, filename), line)
  } catch (err) {
    logger.warn({ err, agentId, prefix }, "failed to write memory log")
  }
}

export function writeMemoryLog(agentId: string, entry: Record<string, unknown>): Promise<void> {
  return writeAgentLog(agentId, "consolidation", entry)
}

export function writeExtractionLog(agentId: string, entry: Record<string, unknown>): Promise<void> {
  return writeAgentLog(agentId, "extraction", entry)
}

export async function writeScanLog(entry: Record<string, unknown>): Promise<void> {
  try {
    await mkdir(MEMORY_LOG_ROOT, { recursive: true })
    const filename = `extraction-scan-${new Date().toISOString().slice(0, 10)}.jsonl`
    const line = `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`
    await appendFile(join(MEMORY_LOG_ROOT, filename), line)
  } catch (err) {
    logger.warn({ err }, "failed to write memory extraction scan log")
  }
}
