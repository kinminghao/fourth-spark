import { openSync, fstatSync, ftruncateSync, writeSync, closeSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { MAX_LOG_BYTES } from "../cli/paths"

let fd: number | null = null
let currentSize = 0
let logPath: string | null = null

function ensureFd(): number {
  if (fd !== null) return fd
  if (!logPath) throw new Error("log-rotate: not initialized, call initRotatingLog first")
  mkdirSync(dirname(logPath), { recursive: true })
  fd = openSync(logPath, "a")
  currentSize = fstatSync(fd).size
  return fd
}

function rotate(): void {
  if (fd === null) return
  ftruncateSync(fd, 0)
  currentSize = 0
}

export function initRotatingLog(path: string): void {
  if (fd !== null) {
    closeSync(fd)
    fd = null
  }
  logPath = path
  ensureFd()
}

export function writeRotatingLog(data: string | Uint8Array): void {
  const f = ensureFd()
  const buf = typeof data === "string" ? Buffer.from(data) : data
  if (currentSize + buf.length > MAX_LOG_BYTES) {
    rotate()
  }
  writeSync(f, buf)
  currentSize += buf.length
}

export function getRotatingLogFd(): number {
  return ensureFd()
}

export function closeRotatingLog(): void {
  if (fd !== null) {
    closeSync(fd)
    fd = null
    currentSize = 0
  }
}
