/*
 * Lightweight notification emitter — decouples data stores from toast-store.
 *
 * Data stores call `notify()` / `removeNotification()` instead of importing
 * useToastStore directly.  At app startup the real toast handlers are wired in
 * via `setNotificationHandler()`.
 *
 * In tests, either leave the defaults (no-op) or supply a spy.
 */

export type NotificationVariant = "info" | "success" | "warning" | "error"

export interface NotificationOpts {
  id?: string
  persistent?: boolean
}

type AddHandler = (
  message: string,
  variant: NotificationVariant,
  sessionId?: string,
  opts?: NotificationOpts,
) => void

type RemoveHandler = (id: string) => void

let _add: AddHandler = () => {}
let _remove: RemoveHandler = () => {}

/** Wire the real toast implementation (call once at app startup). */
export function setNotificationHandler(add: AddHandler, remove: RemoveHandler): void {
  _add = add
  _remove = remove
}

/** Fire a toast notification without importing toast-store. */
export function notify(
  message: string,
  variant: NotificationVariant = "info",
  sessionId?: string,
  opts?: NotificationOpts,
): void {
  _add(message, variant, sessionId, opts)
}

/** Remove a persistent toast by id. */
export function removeNotification(id: string): void {
  _remove(id)
}
