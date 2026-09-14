import { beforeEach, describe, expect, mock, test } from "bun:test"

// Mock api-client before importing the store
const mockListRepos = mock(() => Promise.resolve([]))
const mockCreateRepo = mock(() => Promise.resolve({ id: "new-1", name: "new-repo" }))
const mockDeleteRepo = mock(() => Promise.resolve())

mock.module("../../src/lib/api-client", () => ({
  listRepos: mockListRepos,
  createRepo: mockCreateRepo,
  deleteRepo: mockDeleteRepo,
}))

const { useRepoStore } = await import("../../src/stores/repo-store")

describe("repo-store", () => {
  beforeEach(() => {
    localStorage.clear()
    mockListRepos.mockReset()
    mockCreateRepo.mockReset()
    mockDeleteRepo.mockReset()
    mockListRepos.mockImplementation(() => Promise.resolve([]))
    mockCreateRepo.mockImplementation(() => Promise.resolve({ id: "new-1", name: "new-repo" }))
    mockDeleteRepo.mockImplementation(() => Promise.resolve())
    useRepoStore.setState({
      repos: [],
      activeRepoId: null,
      loading: false,
      loadError: null,
    })
  })

  test("initial state", () => {
    const state = useRepoStore.getState()
    expect(state.repos).toEqual([])
    expect(state.activeRepoId).toBeNull()
    expect(state.loading).toBe(false)
  })

  test("setActiveRepo persists to localStorage", () => {
    useRepoStore.getState().setActiveRepo("repo-1")
    expect(useRepoStore.getState().activeRepoId).toBe("repo-1")
    expect(localStorage.getItem("fs-active-repo")).toBe("repo-1")
  })

  test("setActiveRepo(null) removes from localStorage", () => {
    useRepoStore.getState().setActiveRepo("repo-1")
    useRepoStore.getState().setActiveRepo(null)
    expect(useRepoStore.getState().activeRepoId).toBeNull()
    expect(localStorage.getItem("fs-active-repo")).toBeNull()
  })

  test("loadRepos sets loading state", async () => {
    let resolveRepos: (v: any) => void
    mockListRepos.mockImplementation(
      () =>
        new Promise((r) => {
          resolveRepos = r
        }),
    )

    const promise = useRepoStore.getState().loadRepos()
    expect(useRepoStore.getState().loading).toBe(true)

    resolveRepos?.([])
    await promise
    expect(useRepoStore.getState().loading).toBe(false)
  })

  test("loadRepos stores fetched repos", async () => {
    const repos = [
      { id: "r1", name: "repo-1" },
      { id: "r2", name: "repo-2" },
    ]
    mockListRepos.mockImplementation(() => Promise.resolve(repos))

    await useRepoStore.getState().loadRepos()
    expect(useRepoStore.getState().repos).toEqual(repos)
  })

  test("loadRepos auto-selects first repo when no activeRepoId", async () => {
    const repos = [{ id: "r1", name: "repo-1" }]
    mockListRepos.mockImplementation(() => Promise.resolve(repos))

    await useRepoStore.getState().loadRepos()
    expect(useRepoStore.getState().activeRepoId).toBe("r1")
  })

  test("loadRepos clears invalid activeRepoId", async () => {
    useRepoStore.setState({ activeRepoId: "nonexistent" })
    const repos = [{ id: "r1", name: "repo-1" }]
    mockListRepos.mockImplementation(() => Promise.resolve(repos))

    await useRepoStore.getState().loadRepos()
    expect(useRepoStore.getState().activeRepoId).toBe("r1")
  })

  test("loadRepos preserves valid activeRepoId", async () => {
    useRepoStore.setState({ activeRepoId: "r2" })
    const repos = [
      { id: "r1", name: "repo-1" },
      { id: "r2", name: "repo-2" },
    ]
    mockListRepos.mockImplementation(() => Promise.resolve(repos))

    await useRepoStore.getState().loadRepos()
    expect(useRepoStore.getState().activeRepoId).toBe("r2")
  })

  test("loadRepos handles API error", async () => {
    mockListRepos.mockImplementation(() => Promise.reject(new Error("network error")))

    await useRepoStore.getState().loadRepos()
    expect(useRepoStore.getState().loading).toBe(false)
    expect(useRepoStore.getState().loadError).toBe("network error")
  })

  test("addRepo appends to repos and sets active", async () => {
    useRepoStore.setState({ repos: [{ id: "r1", name: "existing" } as any] })
    mockCreateRepo.mockImplementation(() => Promise.resolve({ id: "r2", name: "new-repo" }))

    const result = await useRepoStore.getState().addRepo("new-repo", "url", "/path")
    expect(result).toEqual({ id: "r2", name: "new-repo" })
    expect(useRepoStore.getState().repos).toHaveLength(2)
    expect(useRepoStore.getState().activeRepoId).toBe("r2")
  })

  test("addRepo returns null on error", async () => {
    mockCreateRepo.mockImplementation(() => Promise.reject(new Error("failed")))

    const result = await useRepoStore.getState().addRepo("repo", "url", "/path")
    expect(result).toBeNull()
    expect(useRepoStore.getState().loadError).toBe("failed")
  })

  test("removeRepo filters out the repo", async () => {
    useRepoStore.setState({
      repos: [{ id: "r1", name: "repo-1" } as any, { id: "r2", name: "repo-2" } as any],
      activeRepoId: "r1",
    })

    await useRepoStore.getState().removeRepo("r1")
    expect(useRepoStore.getState().repos).toHaveLength(1)
    expect(useRepoStore.getState().repos[0].id).toBe("r2")
    // Active switched to remaining repo
    expect(useRepoStore.getState().activeRepoId).toBe("r2")
  })

  test("updateRepoBranch updates matching repo", () => {
    useRepoStore.setState({
      repos: [{ id: "r1", name: "repo-1", branch: "main" } as any],
    })

    useRepoStore.getState().updateRepoBranch("r1", "feature/test")
    expect(useRepoStore.getState().repos[0].branch).toBe("feature/test")
  })
})
