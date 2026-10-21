import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { HttpRuntimeClient } from "../../../src/runtimes/opencode/client"

describe("HttpRuntimeClient.disposeInstance", () => {
  let server: ReturnType<typeof Bun.serve>
  let baseUrl: string
  const requests: { method: string; path: string; directory: string | null }[] = []

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        const url = new URL(req.url)
        requests.push({ method: req.method, path: url.pathname, directory: url.searchParams.get("directory") })
        return Response.json(true)
      },
    })
    baseUrl = `http://127.0.0.1:${server.port}`
  })

  afterAll(() => {
    server.stop(true)
  })

  test("posts /instance/dispose with the instance directory", async () => {
    const client = new HttpRuntimeClient(baseUrl, "/tmp/repo-worktree")

    await client.disposeInstance()

    expect(requests).toEqual([{ method: "POST", path: "/instance/dispose", directory: "/tmp/repo-worktree" }])
  })
})
