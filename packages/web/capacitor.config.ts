import type { CapacitorConfig } from "@capacitor/cli"

const config: CapacitorConfig = {
  appId: "com.fourthspark.app",
  appName: "Fourth Spark",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
}

export default config
