#!/usr/bin/env node
"use strict"

const { execSync } = require("child_process")
const { createWriteStream, mkdirSync, chmodSync, existsSync, unlinkSync } = require("fs")
const { join } = require("path")

const REPO = "kinminghao/fourth-spark"

const PLATFORM_MAP = {
  "darwin-x64": "fourth-spark-darwin-x64",
  "darwin-arm64": "fourth-spark-darwin-arm64",
  "linux-x64": "fourth-spark-linux-x64",
  "linux-arm64": "fourth-spark-linux-arm64",
  "win32-x64": "fourth-spark-windows-x64",
}

async function main() {
  const key = `${process.platform}-${process.arch}`
  const asset = PLATFORM_MAP[key]
  if (!asset) {
    console.error(`fourth-spark: unsupported platform ${key}`)
    process.exit(1)
  }

  const version = require("./package.json").version
  const tag = `v${version}`
  const isWindows = process.platform === "win32"
  const ext = isWindows ? "zip" : "tar.gz"
  const url = `https://github.com/${REPO}/releases/download/${tag}/${asset}.${ext}`

  const binDir = join(__dirname, "bin")
  mkdirSync(binDir, { recursive: true })

  const binaryName = isWindows ? "fourth-spark.exe" : "fourth-spark"
  const binaryPath = join(binDir, binaryName)

  if (existsSync(binaryPath)) {
    console.log("fourth-spark: binary already exists, skipping download")
    return
  }

  console.log(`fourth-spark: downloading ${version} for ${key}...`)
  const tmpFile = join(binDir, `_download.${ext}`)

  await download(url, tmpFile)

  if (isWindows) {
    execSync(
      `powershell -Command "Expand-Archive -Path '${tmpFile}' -DestinationPath '${binDir}' -Force"`,
    )
  } else {
    execSync(`tar xzf "${tmpFile}" -C "${binDir}" fourth-spark`, { stdio: "pipe" })
    chmodSync(binaryPath, 0o755)
  }

  try { unlinkSync(tmpFile) } catch {}
  console.log(`fourth-spark: ${version} installed successfully`)
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const follow = (href) => {
      const mod = href.startsWith("https") ? require("https") : require("http")
      mod
        .get(href, { headers: { "User-Agent": "fourth-spark-npm" } }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            follow(res.headers.location)
            return
          }
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode} from ${href}`))
            return
          }
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

main().catch((err) => {
  console.error("fourth-spark: install failed —", err.message)
  process.exit(1)
})
