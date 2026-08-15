import { existsSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import { logger } from "../middleware/logger"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GIT_TIMEOUT_MS = 60_000
const RETRY_MAX_ATTEMPTS = 3
const RETRY_BACKOFF_BASE_MS = 2_000

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GitResult {
  ok: boolean
  stdout: string
  stderr: string
  timedOut?: boolean
}

export interface GitErrorInfo {
  code: string
  message: string
  retryable: boolean
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

const ERROR_PATTERNS: Array<{ patterns: RegExp; code: string; message: string; retryable: boolean }> = [
  {
    patterns: /could not resolve host|connection timed out|connection refused|unable to access|network is unreachable|ssl|tls handshake|gnutls|failed to connect/i,
    code: "NETWORK",
    message: "网络连接失败，正在重试...",
    retryable: true,
  },
  {
    patterns: /authentication failed|permission denied|invalid credentials|could not read.*credentials/i,
    code: "AUTH",
    message: "认证失败，请检查访问令牌或 SSH 密钥",
    retryable: false,
  },
  {
    patterns: /\b(403|401)\b.*(?:fatal|error)/i,
    code: "AUTH",
    message: "认证失败，请检查访问令牌或 SSH 密钥",
    retryable: false,
  },
  {
    patterns: /no space left|disk quota|cannot create.*no space/i,
    code: "DISK",
    message: "磁盘空间不足，请清理后重试",
    retryable: false,
  },
  {
    patterns: /index\.lock|unable to create.*lock|lock file/i,
    code: "LOCK",
    message: "Git 锁文件冲突，请稍后重试",
    retryable: true,
  },
  {
    patterns: /not possible to fast-forward|fatal: not possible|have diverged/i,
    code: "DIVERGED",
    message: "远端分支已分叉，无法快进合并，请手动处理",
    retryable: false,
  },
  {
    patterns: /local changes would be overwritten|please commit or stash/i,
    code: "LOCAL_CHANGES",
    message: "本地有未提交的修改，请先提交或暂存",
    retryable: false,
  },
  {
    patterns: /bad object|object file is empty|index file corrupt|loose object/i,
    code: "CORRUPT",
    message: "Git 仓库数据损坏，请手动检查或重新克隆",
    retryable: false,
  },
  {
    patterns: /repository.*not found|does not appear to be a git repository/i,
    code: "NOT_FOUND",
    message: "远端仓库不存在或无权访问",
    retryable: false,
  },
]

export function classifyGitError(stdout: string, stderr: string): GitErrorInfo {
  const combined = `${stdout}\n${stderr}`
  for (const { patterns, code, message, retryable } of ERROR_PATTERNS) {
    if (patterns.test(combined)) {
      return { code, message, retryable }
    }
  }
  const raw = stderr.trim() || stdout.trim() || "git 操作失败"
  return { code: "UNKNOWN", message: raw, retryable: false }
}

export function isRetryableGitError(stdout: string, stderr: string): boolean {
  return classifyGitError(stdout, stderr).retryable
}

// ---------------------------------------------------------------------------
// Core: runGit with timeout
// ---------------------------------------------------------------------------

export function runGit(args: string[], cwd: string, opts?: { timeout?: number }): GitResult {
  const timeout = opts?.timeout ?? GIT_TIMEOUT_MS
  try {
    const result = Bun.spawnSync(["git", ...args], { cwd, timeout })
    const stdout = result.stdout.toString().trim()
    const stderr = result.stderr.toString().trim()

    // Bun.spawnSync sets exitCode to null or non-zero when timed out
    if (result.exitCode === null) {
      return { ok: false, stdout, stderr: stderr || "操作超时", timedOut: true }
    }
    return { ok: result.exitCode === 0, stdout, stderr }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, stdout: "", stderr: msg }
  }
}

// ---------------------------------------------------------------------------
// runGit with exponential backoff retry (only for network errors)
// ---------------------------------------------------------------------------

export async function runGitWithRetry(
  args: string[],
  cwd: string,
  opts?: { timeout?: number; maxAttempts?: number },
): Promise<GitResult> {
  const maxAttempts = opts?.maxAttempts ?? RETRY_MAX_ATTEMPTS

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const result = runGit(args, cwd, opts)

    if (result.ok) return result

    const shouldRetry = result.timedOut || isRetryableGitError(result.stdout, result.stderr)
    if (!shouldRetry || attempt >= maxAttempts - 1) {
      return result
    }

    const delay = RETRY_BACKOFF_BASE_MS * 2 ** attempt
    logger.warn(
      { attempt: attempt + 1, maxAttempts, delay, stderr: result.stderr.slice(0, 200) },
      "git command failed with retryable error, retrying",
    )
    await new Promise<void>((r) => setTimeout(r, delay))
  }

  // Unreachable, but satisfies TypeScript
  return { ok: false, stdout: "", stderr: "exhausted all retry attempts" }
}

// ---------------------------------------------------------------------------
// Per-repo mutex — prevents concurrent git operations on the same repo
// ---------------------------------------------------------------------------

const repoLocks = new Map<string, Promise<void>>()

export async function withRepoLock<T>(repoPath: string, fn: () => T | Promise<T>): Promise<T> {
  // Wait for any existing operation on this repo to finish
  while (repoLocks.has(repoPath)) {
    await repoLocks.get(repoPath)
  }

  let resolve!: () => void
  const lockPromise = new Promise<void>((r) => { resolve = r })
  repoLocks.set(repoPath, lockPromise)

  try {
    return await fn()
  } finally {
    repoLocks.delete(repoPath)
    resolve()
  }
}

// ---------------------------------------------------------------------------
// Stale lock file cleanup
// ---------------------------------------------------------------------------

export function cleanupStaleLock(repoPath: string): void {
  // Handle worktrees: .git might be a file pointing to the main repo
  const dotGit = join(repoPath, ".git")
  let lockPath: string

  if (existsSync(dotGit)) {
    // For worktrees, .git is a file — but index.lock is still at the worktree root
    lockPath = join(repoPath, ".git", "index.lock")
    // If .git is a file (worktree), the lock is inside the worktree's gitdir
    try {
      const stat = Bun.spawnSync(["test", "-f", dotGit])
      if (stat.exitCode === 0) {
        // .git is a file (worktree) — lock could still be at standard location
        lockPath = join(repoPath, ".git", "index.lock")
      }
    } catch {
      // fallback
    }
  } else {
    return // not a git repo
  }

  if (!existsSync(lockPath)) return

  // Check if any git process is actively running in this directory
  const pgrepResult = Bun.spawnSync(["pgrep", "-f", `git.*${repoPath}`], { timeout: 5_000 })
  if (pgrepResult.exitCode === 0 && pgrepResult.stdout.toString().trim()) {
    logger.info({ repoPath }, "git lock file exists but git process is running, skipping cleanup")
    return
  }

  try {
    unlinkSync(lockPath)
    logger.info({ repoPath, lockPath }, "cleaned up stale git lock file")
  } catch (err) {
    logger.warn({ err, repoPath, lockPath }, "failed to clean up git lock file")
  }
}

// ---------------------------------------------------------------------------
// Prune stale remote refs
// ---------------------------------------------------------------------------

export function pruneRemoteRefs(cwd: string): void {
  const result = runGit(["remote", "prune", "origin"], cwd, { timeout: 15_000 })
  if (!result.ok) {
    logger.warn({ stderr: result.stderr.slice(0, 200), cwd }, "git remote prune origin failed")
  }
}
