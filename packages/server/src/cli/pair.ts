import { PORT } from "../lib/config"

export async function pairCommand(): Promise<void> {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/auth/pair/start`, {
      method: "POST",
      signal: AbortSignal.timeout(5000),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => "")
      console.error(`ERROR: Failed to open pairing window (${res.status}): ${body}`)
      process.exit(1)
    }

    const data = (await res.json()) as { expiresAt: number }
    const seconds = Math.ceil((data.expiresAt - Date.now()) / 1000)

    console.log(`Pairing window open for ${seconds} seconds.`)
    console.log("Open Fourth Spark on the new device to complete pairing.")
  } catch (err) {
    console.error("ERROR: Could not reach the server. Is it running?")
    console.error("  Run 'fourth-spark status' to check.")
    process.exit(1)
  }
}
