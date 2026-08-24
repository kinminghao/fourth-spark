import { useMemo } from "react"
import type { Issue, Milestone, Tag } from "../lib/api-client"
import type { StateFilter, TypeFilter } from "../components/IssueFilters"

export type IssueType = "epic" | "task" | "stray"

export interface IssueFilterParams {
  issues: Issue[]
  tags: Tag[]
  milestones: Milestone[]
  tagFilterMode: Map<string, "include" | "exclude">
  stateFilter: StateFilter
  typeFilter: TypeFilter
  searchQuery: string
  selectedMilestoneId: string | null
  selectedAuthor: string | null
  selectedAssignee: string | null
}

export interface UserOption {
  login: string
  avatar: string | undefined
}

export function useIssueFilters({
  issues,
  tags,
  milestones,
  tagFilterMode,
  stateFilter,
  typeFilter,
  searchQuery,
  selectedMilestoneId,
  selectedAuthor,
  selectedAssignee,
}: IssueFilterParams) {
  const { childIssueIds, childrenMap } = useMemo(() => {
    const parentIds = new Set(issues.filter((i) => i.parentId).map((i) => i.parentId!))
    const children = new Map<string, Issue[]>()
    for (const i of issues) {
      if (i.parentId) {
        const siblings = children.get(i.parentId)
        if (siblings) siblings.push(i)
        else children.set(i.parentId, [i])
      }
    }
    return { childIssueIds: parentIds, childrenMap: children }
  }, [issues])

  const issueType = useMemo(() => {
    return (i: { parentId?: string; id: string }): IssueType => {
      if (i.parentId) return "task"
      if (childIssueIds.has(i.id)) return "epic"
      return "stray"
    }
  }, [childIssueIds])

  const milestoneMap = useMemo(
    () => new Map(milestones.map((m) => [m.id, m])),
    [milestones],
  )

  const { afterState, finalFiltered } = useMemo(() => {
    const afterSt = stateFilter === "all" ? issues : issues.filter((i) => i.state === stateFilter)
    const afterTy = typeFilter === "all" ? afterSt : afterSt.filter((i) => issueType(i) === typeFilter)
    const afterTg = tagFilterMode.size === 0
      ? afterTy
      : afterTy.filter((i) => {
          const issueTagNames = new Set((i.labels ?? []).map((l) => l.name))
          for (const [tagId, mode] of tagFilterMode) {
            const tagName = tags.find((t) => t.id === tagId)?.name
            if (!tagName) continue
            if (mode === "include" && !issueTagNames.has(tagName)) return false
            if (mode === "exclude" && issueTagNames.has(tagName)) return false
          }
          return true
        })
    const sq = searchQuery.trim().toLowerCase()
    const afterSearch = !sq
      ? afterTg
      : afterTg.filter((i) => `#${i.number} ${i.title}`.toLowerCase().includes(sq))
    const afterMs = selectedMilestoneId
      ? afterSearch.filter((i) => i.milestoneId === selectedMilestoneId)
      : afterSearch
    const afterAuth = !selectedAuthor
      ? afterMs
      : afterMs.filter((i) => i.authorLogin === selectedAuthor)
    const final = !selectedAssignee
      ? afterAuth
      : afterAuth.filter((i) => (i.assignees ?? []).some((a) => a.login === selectedAssignee))
    return { afterState: afterSt, finalFiltered: final }
  }, [issues, stateFilter, typeFilter, tagFilterMode, tags, searchQuery, selectedMilestoneId, selectedAuthor, selectedAssignee, issueType])

  const counts = useMemo(() => ({
    open: issues.filter((i) => i.state === "open").length,
    closed: issues.filter((i) => i.state === "closed").length,
    epic: afterState.filter((i) => issueType(i) === "epic").length,
    task: afterState.filter((i) => issueType(i) === "task").length,
    stray: afterState.filter((i) => issueType(i) === "stray").length,
    afterState: afterState.length,
  }), [issues, afterState, issueType])

  const uniqueAuthors = useMemo((): UserOption[] => {
    const m = new Map<string, UserOption>()
    for (const i of issues) {
      if (i.authorLogin && !m.has(i.authorLogin)) {
        m.set(i.authorLogin, { login: i.authorLogin, avatar: i.authorAvatar })
      }
    }
    return [...m.values()]
  }, [issues])

  const uniqueAssignees = useMemo((): UserOption[] => {
    const m = new Map<string, UserOption>()
    for (const i of issues) {
      for (const a of i.assignees ?? []) {
        if (!m.has(a.login)) m.set(a.login, { login: a.login, avatar: a.avatar_url })
      }
    }
    return [...m.values()]
  }, [issues])

  return {
    childrenMap,
    issueType,
    milestoneMap,
    afterState,
    finalFiltered,
    counts,
    uniqueAuthors,
    uniqueAssignees,
  } as const
}
