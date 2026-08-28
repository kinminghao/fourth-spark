import { networkInterfaces, homedir } from "node:os"
import { join } from "node:path"
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } from "node:fs"
import { logger } from "../middleware/logger"

const TLS_DIR = join(homedir(), ".fourth-spark", "tls")
const CERT_PATH = process.env.TLS_CERT ?? join(TLS_DIR, "cert.pem")
const KEY_PATH = process.env.TLS_KEY ?? join(TLS_DIR, "key.pem")
const IPS_CACHE_PATH = join(TLS_DIR, "ips.txt")

// ── Local IP detection ───────────────────────────────────────────────────

export function getLocalIPs(): Set<string> {
  const ips = new Set<string>()
  for (const iface of Object.values(networkInterfaces())) {
    if (!iface) continue
    for (const addr of iface) {
      if (!addr.internal && addr.family === "IPv4") ips.add(addr.address)
    }
  }
  return ips
}

export function isLocalClient(clientAddr: string | undefined, localIPs: Set<string>): boolean {
  if (!clientAddr) return false
  if (clientAddr === "127.0.0.1" || clientAddr === "::1") return true
  const mapped = clientAddr.replace(/^::ffff:/, "")
  return mapped === "127.0.0.1" || localIPs.has(mapped)
}

// ── TLS certificate management ───────────────────────────────────────────

export function getTlsPaths() {
  return {
    cert: CERT_PATH,
    key: KEY_PATH,
    available: existsSync(CERT_PATH) && existsSync(KEY_PATH),
  }
}

export async function ensureTlsCert(localIPs: Set<string>): Promise<boolean> {
  if (process.env.TLS_CERT && process.env.TLS_KEY) {
    if (existsSync(process.env.TLS_CERT) && existsSync(process.env.TLS_KEY)) {
      logger.info("using custom TLS certificate")
      return true
    }
    logger.warn("TLS_CERT/TLS_KEY specified but files not found, skipping HTTPS")
    return false
  }

  mkdirSync(TLS_DIR, { recursive: true })

  const currentIPList = [...localIPs].sort().join(",")

  if (existsSync(CERT_PATH) && existsSync(KEY_PATH) && existsSync(IPS_CACHE_PATH)) {
    const savedIPs = readFileSync(IPS_CACHE_PATH, "utf-8").trim()
    if (savedIPs === currentIPList) {
      logger.info("TLS certificate already present")
      return true
    }
    logger.info("local IPs changed, regenerating TLS certificate")
  }

  const sans = [
    "DNS:localhost",
    "IP:127.0.0.1",
    ...[...localIPs].map((ip) => `IP:${ip}`),
  ]

  const opensslConfig = `[req]
distinguished_name = req_dn
x509_extensions = v3_ext
prompt = no

[req_dn]
CN = fourth-spark

[v3_ext]
subjectAltName = ${sans.join(",")}
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
`

  const configPath = join(TLS_DIR, "_openssl.cnf")
  writeFileSync(configPath, opensslConfig)

  try {
    const result = Bun.spawnSync([
      "openssl", "req", "-x509",
      "-newkey", "rsa:2048",
      "-keyout", KEY_PATH,
      "-out", CERT_PATH,
      "-days", "3650",
      "-nodes",
      "-config", configPath,
    ], { stderr: "pipe" })

    if (result.exitCode !== 0) {
      logger.warn({ stderr: result.stderr.toString().slice(0, 200) },
        "openssl not available or failed — HTTPS disabled. Install openssl to enable LAN HTTPS.")
      return false
    }

    writeFileSync(IPS_CACHE_PATH, currentIPList)
    logger.info({ ips: [...localIPs], sans }, "TLS certificate generated (self-signed, 10 year)")
    return true
  } finally {
    try { unlinkSync(configPath) } catch {}
  }
}
