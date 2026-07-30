import { PushNotifications } from "@capacitor/push-notifications"
import { isNativePlatform } from "./config"
import { registerPushToken } from "./api-client"
import { useRepoStore } from "../stores/repo-store"

let registered = false

export async function initPushNotifications(navigate: (path: string) => void): Promise<void> {
  if (!isNativePlatform() || registered) return
  registered = true

  const perm = await PushNotifications.requestPermissions()
  if (perm.receive !== "granted") return

  PushNotifications.addListener("registration", async (token) => {
    try {
      await registerPushToken(token.value, "ios")
    } catch {
      // server unreachable — will retry on next app launch
    }
  })

  PushNotifications.addListener("registrationError", () => {
    // nothing actionable — push will be unavailable
  })

  PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
    const data = action.notification.data as Record<string, string> | undefined
    const sessionId = data?.sessionId
    if (sessionId) {
      const repoId = useRepoStore.getState().activeRepoId
      navigate(`/${repoId}/run?session=${sessionId}`)
    }
  })

  await PushNotifications.register()
}
