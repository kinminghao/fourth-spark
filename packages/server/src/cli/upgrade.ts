import { execSync } from "node:child_process"
import { existsSync, renameSync, unlinkSync, chmodSync, realpathSync } from "node:fs"
import { dirname, join } from "node:path"
import { APP_VERSION } from "../lib/config"

const REPO = "kinminghao/fourth-spark"

const PLATFORM_MAP: Record<string, string> = {
  "darwin-x64": "fourth-spark-darwin-x64",
  "darwin-arm64": "fourth-spark-darwin-arm64",
  "linux-x64": "fourth-spark-linux-x64",
  "linux-arm64": "fourth-spark-linux-arm64",
  "win32-x64": "fourth-spark-windows-x64",
}

interface GithubRelease {
  tag_name: string
  assets: { name: string; browser_download_url: string }[]
}

type InstallMethod = "npm" | "manual"

export async function upgradeCommand(args: string[]): Promise<void> {
  const force = args.includes("--force")
  const canary = args.includes("--canary")

  console.log(`current version: ${APP_VERSION}`)
  if (canary) console.log(`channel:         canary`)
  console.log("")

  const latest = canary ? await fetchLatestPreRelease() : await fetchLatestRelease()
  if (!latest) {
    console.error(canary
      ? "No canary release found. Check your network connection."
      : "Failed to check for updates. Check your network connection.")
    process.exit(1)
  }

  const latestVersion = latest.tag_name.replace(/^v/, "")
  console.log(`latest ${canary ? "canary" : "version"}:  ${latestVersion}`)
  console.log("")

  if (!force && !isNewer(latestVersion, APP_VERSION)) {
    console.log("Already up to date.")
    return
  }

  const method = detectInstallMethod()

  if (method === "npm") {
    console.log("Installed via npm. Run:")
    console.log("")
    console.log("  npm update -g fourth-spark")
    console.log("")
    if (!force) return
  }

  const key = `${process.platform}-${process.arch}`
  const assetPrefix = PLATFORM_MAP[key]
  if (!assetPrefix) {
    console.error(`Unsupported platform: ${key}`)
    process.exit(1)
  }

  const isWindows = process.platform === "win32"
  const ext = isWindows ? "zip" : "tar.gz"
  const assetName = `${assetPrefix}.${ext}`
  const asset = latest.assets.find((a) => a.name === assetName)
  if (!asset) {
    console.error(`Release ${latest.tag_name} has no asset for ${key}`)
    process.exit(1)
  }

  const binaryPath = realpathSync(process.execPath)
  const binaryDir = dirname(binaryPath)
  const tmpFile = join(binaryDir, `_upgrade.${ext}`)
  const backupPath = `${binaryPath}.bak`

  console.log(`Downloading ${latest.tag_name} for ${key}...`)
  await downloadFile(asset.browser_download_url, tmpFile)

  console.log("Replacing binary...")
  try {
    if (existsSync(backupPath)) unlinkSync(backupPath)
    renameSync(binaryPath, backupPath)

    if (isWindows) {
      execSync(`powershell -Command "Expand-Archive -Path '${tmpFile}' -DestinationPath '${binaryDir}' -Force"`)
    } else {
      execSync(`tar xzf "${tmpFile}" -C "${binaryDir}"`, { stdio: "pipe" })
      chmodSync(binaryPath, 0o755)
    }

    unlinkSync(backupPath)
  } catch (err) {
    console.error("Upgrade failed, rolling back...")
    if (existsSync(backupPath)) {
      try { renameSync(backupPath, binaryPath) } catch {}
    }
    throw err
  } finally {
    try { unlinkSync(tmpFile) } catch {}
  }

  console.log("Running database migrations...")
  try {
    const { runMigrations } = await import("../db/migrate")
    const ran = await runMigrations()
    if (ran) console.log("  Migrations applied")
    else console.log("  No pending migrations")
  } catch (err) {
    console.log("  Migration skipped (database may not be running)")
  }

  console.log("")
  console.log(`Upgraded to ${latestVersion}. Restart the server to apply.`)
}

async function fetchLatestRelease(): Promise<GithubRelease | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { "User-Agent": "fourth-spark-upgrade" },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return null
    return (await res.json()) as GithubRelease
  } catch {
    return null
  }
}

async function fetchLatestPreRelease(): Promise<GithubRelease | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=20`, {
      headers: { "User-Agent": "fourth-spark-upgrade" },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return null
    const releases = (await res.json()) as (GithubRelease & { prerelease: boolean })[]
    return releases.find((r) => r.prerelease) ?? null
  } catch {
    return null
  }
}

function isNewer(latest: string, current: string): boolean {
  if (current === "dev" || !current.includes(".")) return true
  const [aMaj = 0, aMin = 0, aPat = 0] = latest.split(".").map(Number)
  const [bMaj = 0, bMin = 0, bPat = 0] = current.split(".").map(Number)
  if (aMaj !== bMaj) return aMaj > bMaj
  if (aMin !== bMin) return aMin > bMin
  return aPat > bPat
}

function detectInstallMethod(): InstallMethod {
  try {
    const real = realpathSync(process.execPath)
    if (real.includes("node_modules")) return "npm"
  } catch {}
  return "manual"
}

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const follow = (href: string) => {
      const mod = href.startsWith("https") ? require("https") : require("http")
      mod
        .get(href, { headers: { "User-Agent": "fourth-spark-upgrade" } }, (res: any) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            follow(res.headers.location)
            return
          }
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}`))
            return
          }
          const { createWriteStream } = require("fs")
          const file = createWriteStream(dest)
          res.pipe(file)
          file.on("finish", () => { file.close(); resolve() })
          file.on("error", reject)
        })
        .on("error", reject)
    }
    follow(url)
  })
}

export async function checkForUpdates(): Promise<void> {
  try {
    const latest = await fetchLatestRelease()
    if (!latest) return
    const latestVersion = latest.tag_name.replace(/^v/, "")
    if (isNewer(latestVersion, APP_VERSION)) {
      console.log(`\x1b[33m→ New version available: ${latestVersion} (current: ${APP_VERSION}). Run 'fourth-spark upgrade' to update.\x1b[0m`)
    }
  } catch {}
}
