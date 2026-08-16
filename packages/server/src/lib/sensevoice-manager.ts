import { homedir, arch, platform } from "node:os"
import { join } from "node:path"
import { existsSync, mkdirSync, chmodSync, renameSync, unlinkSync, rmSync } from "node:fs"
import { logger } from "../middleware/logger"

const SENSEVOICE_VERSION = "runtime-llamacpp-v0.1.9"
const BINARY_NAME = "llama-funasr-sensevoice"
const MODELS_DIR = process.env.SENSEVOICE_DIR ?? join(homedir(), ".fourth-spark", "models", "sensevoice")

type PlatformKey = "linux-x64" | "linux-arm64" | "darwin-arm64"

const BINARY_URLS: Record<PlatformKey, string> = {
  "linux-x64": `https://github.com/QwenAudio/SenseVoice/releases/download/${SENSEVOICE_VERSION}/funasr-llamacpp-linux-x64.tar.gz`,
  "linux-arm64": `https://github.com/QwenAudio/SenseVoice/releases/download/${SENSEVOICE_VERSION}/funasr-llamacpp-linux-arm64.tar.gz`,
  "darwin-arm64": `https://github.com/QwenAudio/SenseVoice/releases/download/${SENSEVOICE_VERSION}/funasr-llamacpp-macos-arm64.tar.gz`,
}

const HF_BASE = process.env.HF_MIRROR ?? "https://huggingface.co"

const MODEL_FILES = [
  {
    name: "sensevoice-small-q8.gguf",
    url: `${HF_BASE}/FunAudioLLM/SenseVoiceSmall-GGUF/resolve/main/sensevoice-small-q8.gguf`,
  },
  {
    name: "fsmn-vad.gguf",
    url: `${HF_BASE}/FunAudioLLM/fsmn-vad-GGUF/resolve/main/fsmn-vad.gguf`,
  },
]

function getPlatformKey(): PlatformKey | null {
  const p = platform()
  const a = arch()
  if (p === "linux" && a === "x64") return "linux-x64"
  if (p === "linux" && a === "arm64") return "linux-arm64"
  if (p === "darwin" && a === "arm64") return "darwin-arm64"
  return null
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

async function downloadWithProgress(url: string, dest: string, label: string): Promise<void> {
  const res = await fetch(url, { redirect: "follow", headers: { "User-Agent": "fourth-spark" } })
  if (!res.ok) throw new Error(`HTTP ${res.status} downloading ${label}`)
  if (!res.body) throw new Error(`empty response body for ${label}`)

  const total = Number(res.headers.get("content-length") || 0)
  let received = 0
  let lastLogPercent = -10

  const file = Bun.file(dest).writer()
  for await (const chunk of res.body) {
    file.write(chunk)
    received += chunk.byteLength
    if (total > 0) {
      const percent = Math.floor((received / total) * 100)
      if (percent - lastLogPercent >= 10) {
        logger.info(
          { file: label, progress: `${percent}%`, received: formatBytes(received), total: formatBytes(total) },
          `downloading ${label}`,
        )
        lastLogPercent = percent
      }
    }
  }
  await file.end()
  logger.info({ file: label, size: formatBytes(received) }, `${label} download complete`)
}

async function downloadBinary(platformKey: PlatformKey): Promise<void> {
  const binaryPath = join(MODELS_DIR, BINARY_NAME)
  if (existsSync(binaryPath)) return

  const tarPath = join(MODELS_DIR, "_binary.tar.gz")
  const extractDir = join(MODELS_DIR, "_extract")

  await downloadWithProgress(BINARY_URLS[platformKey], tarPath, `sensevoice binary (${platformKey})`)

  mkdirSync(extractDir, { recursive: true })
  const tar = Bun.spawnSync(["tar", "xzf", tarPath, "-C", extractDir])
  if (tar.exitCode !== 0) throw new Error(`tar extraction failed: ${tar.stderr.toString()}`)

  const find = Bun.spawnSync(["find", extractDir, "-name", BINARY_NAME, "-type", "f"])
  const found = find.stdout.toString().trim().split("\n")[0]
  if (!found) throw new Error(`${BINARY_NAME} not found in archive`)

  renameSync(found, binaryPath)
  chmodSync(binaryPath, 0o755)

  rmSync(extractDir, { recursive: true, force: true })
  try { unlinkSync(tarPath) } catch {}
  logger.info("sensevoice binary extracted")
}

async function downloadModels(): Promise<void> {
  for (const model of MODEL_FILES) {
    const dest = join(MODELS_DIR, model.name)
    if (existsSync(dest)) {
      logger.info({ file: model.name }, "model already present, skipping")
      continue
    }
    await downloadWithProgress(model.url, dest, model.name)
  }
}

// ── Public API ───────────────────────────────────────────────────────────

export function getSenseVoicePaths() {
  const binary = join(MODELS_DIR, BINARY_NAME)
  const model = join(MODELS_DIR, "sensevoice-small-q8.gguf")
  const vad = join(MODELS_DIR, "fsmn-vad.gguf")
  return {
    binary,
    model,
    vad,
    available: existsSync(binary) && existsSync(model) && existsSync(vad),
  }
}

export async function ensureSenseVoice(): Promise<boolean> {
  const platformKey = getPlatformKey()
  if (!platformKey) {
    logger.warn({ platform: platform(), arch: arch() }, "SenseVoice: unsupported platform, skipping")
    return false
  }

  mkdirSync(MODELS_DIR, { recursive: true })

  if (getSenseVoicePaths().available) {
    logger.info("SenseVoice models already present")
    return true
  }

  logger.info("SenseVoice: downloading speech recognition models (~240 MB)...")

  await downloadBinary(platformKey)
  await downloadModels()

  const ready = getSenseVoicePaths().available
  if (ready) logger.info("SenseVoice ready")
  return ready
}

export async function transcribe(audioPath: string): Promise<string> {
  const paths = getSenseVoicePaths()
  if (!paths.available) throw new Error("SenseVoice models not downloaded")

  const proc = Bun.spawn([paths.binary, "-m", paths.model, "-a", audioPath, "--vad", paths.vad], {
    stdout: "pipe",
    stderr: "pipe",
  })

  const [text, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])

  if (exitCode !== 0) throw new Error(`SenseVoice exit ${exitCode}: ${stderr}`)
  return text.trim()
}
