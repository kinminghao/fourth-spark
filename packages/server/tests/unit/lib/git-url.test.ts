import { describe, expect, test } from "bun:test"
import { normalizeGitUrl, parseGitUrl } from "../../../src/lib/git-url"

describe("parseGitUrl", () => {
  test("SSH format", () => {
    const result = parseGitUrl("git@github.com:owner/repo.git")
    expect(result).toEqual({ host: "github.com", owner: "owner", repo: "repo" })
  })

  test("SSH format without .git suffix", () => {
    const result = parseGitUrl("git@github.com:owner/repo")
    expect(result).toEqual({ host: "github.com", owner: "owner", repo: "repo" })
  })

  test("HTTPS format", () => {
    const result = parseGitUrl("https://github.com/owner/repo.git")
    expect(result).toEqual({ host: "github.com", owner: "owner", repo: "repo" })
  })

  test("HTTPS format without .git suffix", () => {
    const result = parseGitUrl("https://github.com/owner/repo")
    expect(result).toEqual({ host: "github.com", owner: "owner", repo: "repo" })
  })

  test("HTTPS with trailing slash", () => {
    const result = parseGitUrl("https://github.com/owner/repo/")
    expect(result).toEqual({ host: "github.com", owner: "owner", repo: "repo" })
  })

  test("HTTP format", () => {
    const result = parseGitUrl("http://github.com/owner/repo.git")
    expect(result).toEqual({ host: "github.com", owner: "owner", repo: "repo" })
  })

  test("HTTPS with port", () => {
    const result = parseGitUrl("https://git.example.com:8443/org/project.git")
    expect(result).toEqual({ host: "git.example.com", owner: "org", repo: "project" })
  })

  test("SSH protocol format", () => {
    const result = parseGitUrl("ssh://git@git.example.com/org/project.git")
    expect(result).toEqual({ host: "git.example.com", owner: "org", repo: "project" })
  })

  test("SSH protocol with port", () => {
    const result = parseGitUrl("ssh://git@git.example.com:22/org/project.git")
    expect(result).toEqual({ host: "git.example.com", owner: "org", repo: "project" })
  })

  test("self-hosted Gitea SSH", () => {
    const result = parseGitUrl("git@git.btsai.work:CloudSystem/backend.git")
    expect(result).toEqual({ host: "git.btsai.work", owner: "CloudSystem", repo: "backend" })
  })

  test("self-hosted Gitea HTTPS", () => {
    const result = parseGitUrl("https://git.btsai.work/CloudSystem/backend.git")
    expect(result).toEqual({ host: "git.btsai.work", owner: "CloudSystem", repo: "backend" })
  })

  test("returns null for invalid URL", () => {
    expect(parseGitUrl("not-a-url")).toBeNull()
  })

  test("returns null for empty string", () => {
    expect(parseGitUrl("")).toBeNull()
  })

  test("returns null for URL with only host", () => {
    expect(parseGitUrl("https://github.com")).toBeNull()
  })

  test("handles dots and hyphens in owner/repo", () => {
    const result = parseGitUrl("https://github.com/my-org/my.repo.git")
    expect(result).toEqual({ host: "github.com", owner: "my-org", repo: "my.repo" })
  })
})

describe("normalizeGitUrl", () => {
  test("SSH → HTTPS", () => {
    expect(normalizeGitUrl("git@github.com:owner/repo.git")).toBe("https://github.com/owner/repo.git")
  })

  test("SSH protocol → HTTPS", () => {
    expect(normalizeGitUrl("ssh://git@github.com/owner/repo.git")).toBe("https://github.com/owner/repo.git")
  })

  test("HTTPS passthrough (already normalized)", () => {
    expect(normalizeGitUrl("https://github.com/owner/repo.git")).toBe("https://github.com/owner/repo.git")
  })

  test("adds .git suffix when missing", () => {
    expect(normalizeGitUrl("https://github.com/owner/repo")).toBe("https://github.com/owner/repo.git")
  })

  test("returns original for unparseable URL", () => {
    expect(normalizeGitUrl("not-a-url")).toBe("not-a-url")
  })
})
