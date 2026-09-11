import type { Hono } from "hono"
import { eq } from "drizzle-orm"
import { resolve, relative, extname, isAbsolute } from "node:path"
import { lstatSync } from "node:fs"
import { workspaceManager } from "../../lib/workspace-manager"
import { db } from "../../db/index"
import { sessions as sessionsTable } from "../../db/schema"

// ---------------------------------------------------------------------------
// Session file preview — previewable extension allowlist
// ---------------------------------------------------------------------------

export const PREVIEWABLE_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg",
  ".html", ".htm",
  ".md", ".txt", ".log",
])

export const PREVIEW_MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
}

export const HTML_EXTS = new Set([".html", ".htm"])

export async function resolveSessionWorkspace(sessionId: string) {
  const [session] = await db.select({ workspaceId: sessionsTable.workspaceId }).from(sessionsTable).where(eq(sessionsTable.id, sessionId))
  if (!session?.workspaceId) return null
  return workspaceManager.get(session.workspaceId)
}

export function registerFileRoutes(app: Hono): void {
  app.get("/:id/files", async (c) => {
    const sessionId = c.req.param("id")
    const ws = await resolveSessionWorkspace(sessionId)
    if (!ws) return c.json({ error: "Session has no workspace" }, 404)

    const changedFiles = await workspaceManager.getChangedFiles(ws.id)
    const previewable = changedFiles
      .filter((f) => PREVIEWABLE_EXTENSIONS.has(extname(f).toLowerCase()))
      .map((f) => ({ path: f, ext: extname(f).toLowerCase() }))

    return c.json(previewable)
  })

  app.get("/:id/files/:path{.+}", async (c) => {
    const sessionId = c.req.param("id")
    const filePath = c.req.param("path")
    if (!filePath) return c.json({ error: "File path required" }, 400)

    const ws = await resolveSessionWorkspace(sessionId)
    if (!ws) return c.json({ error: "Session has no workspace" }, 404)

    const ext = extname(filePath).toLowerCase()
    if (!PREVIEWABLE_EXTENSIONS.has(ext)) {
      return c.json({ error: "File type not allowed for preview" }, 403)
    }

    const absolutePath = resolve(ws.localPath, filePath)
    const rel = relative(ws.localPath, absolutePath)
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
      return c.json({ error: "Path traversal not allowed" }, 403)
    }

    try {
      if (lstatSync(absolutePath).isSymbolicLink()) {
        return c.json({ error: "Symlinks not allowed" }, 403)
      }
    } catch {
      return c.json({ error: "File not found" }, 404)
    }

    const changedFiles = await workspaceManager.getChangedFiles(ws.id)
    if (!changedFiles.includes(rel)) {
      return c.json({ error: "File not in session changeset" }, 403)
    }

    const file = Bun.file(absolutePath)
    if (!await file.exists()) {
      return c.json({ error: "File not found" }, 404)
    }

    const contentType = PREVIEW_MIME_MAP[ext] || "application/octet-stream"
    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    }

    if (HTML_EXTS.has(ext)) {
      headers["Content-Security-Policy"] = "sandbox"
      headers["Content-Disposition"] = `inline; filename="${rel.split("/").pop()}"`
    }

    return new Response(file, { headers })
  })
}
