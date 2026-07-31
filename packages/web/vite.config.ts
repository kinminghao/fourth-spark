import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { execSync } from "node:child_process"

const apiTarget = process.env.VITE_API_TARGET ?? "http://localhost:3000"

function resolveVersion(): string {
  if (process.env.APP_VERSION) return process.env.APP_VERSION
  try {
    return execSync("git rev-parse --short HEAD", { stdio: "pipe" }).toString().trim()
  } catch {
    return "dev"
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(resolveVersion()),
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
})
