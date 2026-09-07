import { Hono } from "hono"
import { resolve, dirname, basename } from "node:path"
import { readdirSync, lstatSync, existsSync } from "node:fs"
import { homedir } from "node:os"

export const fsRoutes = new Hono()

/** Directories that are always hidden from browsing, regardless of showHidden. */
const SENSITIVE_DIRS = new Set([
  ".ssh",
  ".gnupg",
  ".gpg",
  ".aws",
  ".azure",
  ".kube",
  ".docker",
  ".password-store",
  ".credentials",
  ".secrets",
  ".env",
])

/** Directories filtered by default (noise), shown only when showHidden is true. */
const NOISE_DIRS = new Set([
  "node_modules",
  ".Trash",
  ".Trashes",
  "$RECYCLE.BIN",
])

function isHidden(name: string): boolean {
  return name.startsWith(".")
}

function isSensitive(name: string): boolean {
  return SENSITIVE_DIRS.has(name)
}

function isNoise(name: string): boolean {
  return NOISE_DIRS.has(name)
}

// POST /api/fs/browse
fsRoutes.post("/browse", async (c) => {
  const body = await c.req.json<{ path?: string; showHidden?: boolean }>().catch(() => null)

  const showHidden = body?.showHidden ?? false
  const rawPath = body?.path?.trim() || homedir()

  // Reject paths containing traversal sequences before resolution
  if (rawPath.includes("..")) {
    return c.json({ error: "路径不允许包含 '..'", status: 400 }, 400)
  }

  const resolved = resolve(rawPath)

  if (!existsSync(resolved)) {
    return c.json({ error: "路径不存在", status: 400 }, 400)
  }

  const stat = lstatSync(resolved)
  if (stat.isSymbolicLink()) {
    return c.json({ error: "不允许通过符号链接访问", status: 403 }, 403)
  }
  if (!stat.isDirectory()) {
    return c.json({ error: "路径不是目录", status: 400 }, 400)
  }

  let dirEntries: string[]
  try {
    dirEntries = readdirSync(resolved)
  } catch {
    return c.json({ error: "无法读取目录", status: 403 }, 403)
  }

  const entries: Array<{ name: string; isGitRepo: boolean }> = []

  for (const name of dirEntries) {
    // Always skip sensitive directories
    if (isSensitive(name)) continue

    // Skip hidden unless toggled on
    if (!showHidden && isHidden(name)) continue

    // Skip noise directories unless showHidden
    if (!showHidden && isNoise(name)) continue

    const fullPath = resolve(resolved, name)

    try {
      const entryStat = lstatSync(fullPath)

      // Only show directories, skip files
      if (!entryStat.isDirectory()) continue

      // Skip symlinks
      if (entryStat.isSymbolicLink()) continue

      const isGitRepo = existsSync(resolve(fullPath, ".git"))
      entries.push({ name, isGitRepo })
    } catch {
      // Permission denied or other fs error — skip silently
      continue
    }
  }

  // Sort: git repos first, then alphabetical
  entries.sort((a, b) => {
    if (a.isGitRepo !== b.isGitRepo) return a.isGitRepo ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  const parent = resolved === "/" ? null : dirname(resolved)

  return c.json({
    path: resolved,
    parent,
    entries,
  })
})
