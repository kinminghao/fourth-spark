import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { listBaseAgents, scanLocalAgents, validateBaseAgent } from "../../../src/lib/base-agents"

async function withAgentDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "fourth-spark-base-agents-"))
  try {
    await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

async function writeAgent(dir: string, name: string, frontmatter: string): Promise<void> {
  await writeFile(join(dir, `${name}.md`), `---\n${frontmatter}\n---\n\nBody\n`, "utf-8")
}

describe("scanLocalAgents", () => {
  test("includes primary and mode-less agents, excludes subagents and disabled agents", async () => {
    await withAgentDir(async (dir) => {
      await writeAgent(dir, "chat", "description: Chat mode\nmode: primary")
      await writeAgent(dir, "helper", "mode: all")
      await writeAgent(dir, "worker", "mode: subagent")
      await writeAgent(dir, "off", "mode: primary\ndisable: true")

      const agents = await scanLocalAgents([dir])

      expect(agents.map((agent) => agent.name)).toEqual(["chat", "helper"])
      expect(agents.find((agent) => agent.name === "chat")?.description).toBe("Chat mode")
      expect(agents.every((agent) => agent.source === "local")).toBe(true)
    })
  })

  test("uses the frontmatter name when present", async () => {
    await withAgentDir(async (dir) => {
      await writeAgent(dir, "file-name", "name: display-name\nmode: primary")
      const agents = await scanLocalAgents([dir])
      expect(agents.map((agent) => agent.name)).toEqual(["display-name"])
    })
  })

  test("dedupes names across scan directories", async () => {
    await withAgentDir(async (dir) => {
      const other = await mkdtemp(join(tmpdir(), "fourth-spark-base-agents-other-"))
      try {
        await writeAgent(dir, "chat", "mode: primary")
        await writeAgent(other, "chat", "mode: primary")
        const agents = await scanLocalAgents([dir, other])
        expect(agents.filter((agent) => agent.name === "chat")).toHaveLength(1)
      } finally {
        await rm(other, { recursive: true, force: true })
      }
    })
  })

  test("ignores missing directories", async () => {
    expect(await scanLocalAgents([join(tmpdir(), "fourth-spark-missing-agents")])).toEqual([])
  })
})

describe("listBaseAgents", () => {
  test("keeps built-ins first and adds local agents", async () => {
    await withAgentDir(async (dir) => {
      await writeAgent(dir, "chat", "mode: primary")
      const agents = await listBaseAgents([dir])
      expect(agents[0].name).toBe("Sisyphus - ultraworker")
      expect(agents.some((agent) => agent.name === "chat")).toBe(true)
      expect(agents.filter((agent) => agent.name === "Sisyphus - ultraworker")).toHaveLength(1)
    })
  })
})

describe("validateBaseAgent", () => {
  test("accepts built-in and scanned agents", async () => {
    await withAgentDir(async (dir) => {
      await writeAgent(dir, "chat", "mode: primary")
      expect(await validateBaseAgent("Sisyphus - ultraworker", [dir])).toBeNull()
      expect(await validateBaseAgent("chat", [dir])).toBeNull()
    })
  })

  test("rejects unknown agents with the available names", async () => {
    await withAgentDir(async (dir) => {
      await writeAgent(dir, "chat", "mode: primary")
      const error = await validateBaseAgent("missing", [dir])
      expect(error).toContain("baseAgent must be one of:")
      expect(error).toContain("chat")
    })
  })
})
