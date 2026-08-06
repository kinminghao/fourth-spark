import { spawn } from "node:child_process"
import { logger } from "../middleware/logger"
import type { NotificationChannel, NotifyEvent } from "../core/types"

const APP_TITLE = "Fourth Spark"

function osascriptNotify(title: string, message: string): void {
  const escaped = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
  const script = `display notification "${escaped(message)}" with title "${escaped(title)}"`
  const child = spawn("osascript", ["-e", script], { stdio: "ignore", detached: true })
  child.unref()
  child.on("error", (err) => logger.debug({ err }, "osascript notify failed"))
}

export function notify(subtitle: string, message: string): void {
  if (process.platform !== "darwin") return
  osascriptNotify(`${APP_TITLE} · ${subtitle}`, message)
}

export const desktopNotificationChannel: NotificationChannel = {
  id: "desktop",
  async send(event: NotifyEvent): Promise<void> {
    if (process.platform !== "darwin") return
    osascriptNotify(`${APP_TITLE} · ${event.title}`, event.body)
  },
}
