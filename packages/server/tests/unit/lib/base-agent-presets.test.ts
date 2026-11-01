import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  BaseAgentPresetNotFoundError,
  installBaseAgentPreset,
  listBaseAgentPresetInfos,
} from "../../../src/lib/base-agent-presets"

async function withConfigDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "fourth-spark-base-agent-presets-"))
  try {
    await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe("base agent presets", () => {
  test("lists the chat preset as not installed before install", async () => {
    await withConfigDir(async (dir) => {
      const presets = await listBaseAgentPresetInfos(dir)
      expect(presets.find((preset) => preset.id === "chat")).toMatchObject({
        id: "chat",
        label: "chat bot",
        agentName: "chat",
        installed: false,
      })
    })
  })

  test("installs the chat preset and reports it as installed", async () => {
    await withConfigDir(async (dir) => {
      const result = await installBaseAgentPreset("chat", dir)
      expect(result).toEqual({
        installed: true,
        alreadyExists: false,
        path: join(dir, "agents", "chat.md"),
      })

      const content = await readFile(join(dir, "agents", "chat.md"), "utf-8")
      expect(content).toContain("mode: primary")
      expect(content).toContain("You are a technical discussion partner")

      const presets = await listBaseAgentPresetInfos(dir)
      expect(presets.find((preset) => preset.id === "chat")?.installed).toBe(true)
    })
  })

  test("does not overwrite an existing agent file", async () => {
    await withConfigDir(async (dir) => {
      await mkdir(join(dir, "agents"), { recursive: true })
      await writeFile(join(dir, "agents", "chat.md"), "custom", "utf-8")

      const result = await installBaseAgentPreset("chat", dir)
      expect(result).toMatchObject({ installed: false, alreadyExists: true })
      expect(await readFile(join(dir, "agents", "chat.md"), "utf-8")).toBe("custom")
    })
  })

  test("recognizes a legacy agent dir file", async () => {
    await withConfigDir(async (dir) => {
      await mkdir(join(dir, "agent"), { recursive: true })
      await writeFile(join(dir, "agent", "chat.md"), "legacy", "utf-8")

      const presets = await listBaseAgentPresetInfos(dir)
      expect(presets.find((preset) => preset.id === "chat")?.installed).toBe(true)

      const result = await installBaseAgentPreset("chat", dir)
      expect(result).toMatchObject({
        installed: false,
        alreadyExists: true,
        path: join(dir, "agent", "chat.md"),
      })
      expect(await readFile(join(dir, "agent", "chat.md"), "utf-8")).toBe("legacy")
    })
  })

  test("rejects an unknown preset", async () => {
    await withConfigDir(async (dir) => {
      let error: unknown
      try {
        await installBaseAgentPreset("missing", dir)
      } catch (cause) {
        error = cause
      }
      expect(error).toBeInstanceOf(BaseAgentPresetNotFoundError)
    })
  })
})
