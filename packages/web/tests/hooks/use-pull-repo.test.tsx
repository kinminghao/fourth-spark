import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { act, type ReactElement } from "react"
import { createRoot, type Root } from "react-dom/client"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

class MockApiError extends Error {}

const mockPullRepo = mock(() => Promise.resolve({}))
const mockListRepos = mock(() => Promise.resolve([]))

mock.module("../../src/lib/api-client", () => ({
  ApiError: MockApiError,
  pullRepo: mockPullRepo,
  listRepos: mockListRepos,
  createRepo: mock(() => Promise.resolve(null)),
  deleteRepo: mock(() => Promise.resolve()),
}))

const { usePullRepo } = await import("../../src/hooks/use-pull-repo")
const { useRepoStore } = await import("../../src/stores/repo-store")
const { useToastStore } = await import("../../src/stores/toast-store")

function PullButton({ repoId }: { repoId: string }) {
  const { pull, pullingId } = usePullRepo()
  return (
    <button type="button" onClick={() => void pull(repoId)} disabled={pullingId === repoId}>
      {pullingId === repoId ? "拉取中" : "拉取"}
    </button>
  )
}

type Mounted = { container: HTMLDivElement; root: Root }

const mounted: Mounted[] = []

function render(ui: ReactElement): HTMLDivElement {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(ui)
  })
  mounted.push({ container, root })
  return container
}

async function click(button: HTMLButtonElement) {
  await act(async () => {
    button.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

beforeEach(() => {
  mockPullRepo.mockReset()
  mockListRepos.mockReset()
  mockListRepos.mockImplementation(() => Promise.resolve([]))
  useRepoStore.setState({ repos: [], activeRepoId: null, loading: false, loadError: null })
  useToastStore.setState({ toasts: [] })
})

afterEach(() => {
  for (const { container, root } of mounted.splice(0)) {
    act(() => {
      root.unmount()
    })
    container.remove()
  }
})

describe("usePullRepo", () => {
  test("pulls, reloads repos and shows an up-to-date toast", async () => {
    mockPullRepo.mockImplementation(() =>
      Promise.resolve({ summary: "已是最新", alreadyUpToDate: true, branch: "main" }),
    )

    const container = render(<PullButton repoId="repo-1" />)
    await click(container.querySelector("button") as HTMLButtonElement)

    expect(mockPullRepo).toHaveBeenCalledWith("repo-1")
    expect(mockListRepos).toHaveBeenCalled()
    expect(useToastStore.getState().toasts[0]).toMatchObject({ message: "已是最新", variant: "info" })
    expect(container.querySelector("button")?.disabled).toBe(false)
  })

  test("shows the API error message when the pull fails", async () => {
    mockPullRepo.mockImplementation(() =>
      Promise.reject(new MockApiError(JSON.stringify({ error: "拉取冲突，请手动解决" }))),
    )

    const container = render(<PullButton repoId="repo-2" />)
    await click(container.querySelector("button") as HTMLButtonElement)

    expect(useToastStore.getState().toasts[0]).toMatchObject({
      message: "拉取冲突，请手动解决",
      variant: "error",
    })
  })

  test("disables the button while pulling", async () => {
    let resolvePull: (value: unknown) => void = () => {}
    mockPullRepo.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePull = resolve
        }),
    )

    const container = render(<PullButton repoId="repo-3" />)
    const button = container.querySelector("button") as HTMLButtonElement

    await act(async () => {
      button.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(button.disabled).toBe(true)
    expect(button.textContent).toBe("拉取中")

    await act(async () => {
      resolvePull({ summary: "拉取完成", alreadyUpToDate: false, branch: "main" })
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(button.disabled).toBe(false)
    expect(button.textContent).toBe("拉取")
  })
})
