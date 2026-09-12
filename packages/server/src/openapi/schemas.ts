import { z } from "zod"

// ---------------------------------------------------------------------------
// Common / shared response schemas
// ---------------------------------------------------------------------------

export const ErrorResponse = z.object({
  error: z.string(),
  code: z.string().optional(),
}).meta({ id: "ErrorResponse" })

export const SuccessResponse = z.object({
  ok: z.literal(true),
}).meta({ id: "SuccessResponse" })

// ---------------------------------------------------------------------------
// Reusable primitives
// ---------------------------------------------------------------------------

const LabelSchema = z.object({
  id: z.number(),
  name: z.string(),
  color: z.string(),
})

const AssigneeSchema = z.object({
  login: z.string(),
  avatar_url: z.string(),
})

const DiffStatSchema = z.object({
  filename: z.string(),
  status: z.string(),
  additions: z.number(),
  deletions: z.number(),
})

const ModelRefSchema = z.object({
  providerID: z.string().optional(),
  modelID: z.string().optional(),
  variant: z.string().optional(),
})

// ---------------------------------------------------------------------------
// DB entity response schemas
// ---------------------------------------------------------------------------

export const Repo = z.object({
  id: z.string(),
  name: z.string(),
  gitUrl: z.string(),
  localPath: z.string(),
  runtimeType: z.string().nullable(),
  port: z.number().nullable(),
  status: z.string(),
  worktreeEnabled: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
  running: z.boolean().optional(),
  branch: z.string().nullable().optional(),
}).meta({ id: "Repo" })

export const Session = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  repoId: z.string().nullable(),
  workspaceId: z.string().nullable(),
  issueId: z.string().nullable(),
  customAgentId: z.string().nullable(),
  title: z.string(),
  agent: z.string().nullable(),
  model: ModelRefSchema.nullable(),
  directory: z.string().nullable(),
  cost: z.number(),
  tokensInput: z.number(),
  tokensOutput: z.number(),
  tokensReasoning: z.number(),
  tokensCacheRead: z.number(),
  tokensCacheWrite: z.number(),
  userId: z.string().nullable(),
  completedAt: z.number().nullable(),
  pinnedAt: z.number().nullable(),
  timeCreated: z.number(),
  timeUpdated: z.number(),
}).meta({ id: "Session" })

export const Issue = z.object({
  id: z.string(),
  repoId: z.string(),
  parentId: z.string().nullable(),
  number: z.number(),
  title: z.string(),
  body: z.string().nullable(),
  state: z.string(),
  labels: z.array(LabelSchema).nullable(),
  milestoneId: z.string().nullable(),
  htmlUrl: z.string().nullable(),
  authorLogin: z.string().nullable(),
  authorAvatar: z.string().nullable(),
  assignees: z.array(AssigneeSchema).nullable(),
  commentCount: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
}).meta({ id: "Issue" })

export const IssueComment = z.object({
  id: z.string(),
  issueId: z.string(),
  repoId: z.string(),
  authorLogin: z.string(),
  authorAvatar: z.string().nullable(),
  body: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
}).meta({ id: "IssueComment" })

export const Tag = z.object({
  id: z.string(),
  repoId: z.string(),
  name: z.string(),
  color: z.string(),
  description: z.string().nullable(),
  createdAt: z.number(),
}).meta({ id: "Tag" })

export const Milestone = z.object({
  id: z.string(),
  repoId: z.string(),
  number: z.number(),
  title: z.string(),
  description: z.string().nullable(),
  state: z.string(),
  dueOn: z.number().nullable(),
  openIssues: z.number(),
  closedIssues: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
}).meta({ id: "Milestone" })

export const PullRequest = z.object({
  id: z.string(),
  repoId: z.string(),
  number: z.number(),
  title: z.string(),
  body: z.string().nullable(),
  state: z.string(),
  headBranch: z.string(),
  baseBranch: z.string(),
  labels: z.array(LabelSchema).nullable(),
  htmlUrl: z.string().nullable(),
  authorLogin: z.string().nullable(),
  authorAvatar: z.string().nullable(),
  assignees: z.array(AssigneeSchema).nullable(),
  mergeable: z.string().nullable(),
  draft: z.number(),
  commentCount: z.number(),
  additions: z.number().nullable(),
  deletions: z.number().nullable(),
  changedFilesCount: z.number().nullable(),
  commitCount: z.number().nullable(),
  diffStats: z.array(DiffStatSchema).nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
  mergedAt: z.number().nullable(),
}).meta({ id: "PullRequest" })

export const GitHost = z.object({
  id: z.string(),
  host: z.string(),
  platform: z.string(),
  name: z.string(),
  token: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
}).meta({ id: "GitHost" })

export const Setting = z.record(z.string(), z.string()).meta({ id: "Setting" })

export const Workspace = z.object({
  id: z.string(),
  repoId: z.string(),
  branch: z.string(),
  localPath: z.string(),
  baseBranch: z.string(),
  status: z.string(),
  port: z.number().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
}).meta({ id: "Workspace" })

const PromptFragmentRef = z.object({
  id: z.string(),
  name: z.string(),
  content: z.string(),
})

export const CustomAgent = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  baseAgent: z.string(),
  model: z.string().nullable(),
  variant: z.string().nullable(),
  systemPrompt: z.string(),
  systemPromptPosition: z.number(),
  isSystem: z.number(),
  memoryEnabled: z.number(),
  memoryModel: z.string().nullable(),
  repoId: z.string().nullable(),
  sortOrder: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
  fragments: z.array(PromptFragmentRef).optional(),
}).meta({ id: "CustomAgent" })

export const PromptFragment = z.object({
  id: z.string(),
  name: z.string(),
  content: z.string(),
  repoId: z.string().nullable(),
  sortOrder: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
}).meta({ id: "PromptFragment" })

const MemoryVersionSchema = z.object({
  content: z.string(),
  importance: z.number(),
  category: z.string(),
  action: z.enum(["create", "update", "merge", "decay", "reinforce", "manual"]),
  ts: z.number(),
  source: z.string().optional(),
})

export const AgentMemory = z.object({
  id: z.string(),
  customAgentId: z.string(),
  sessionId: z.string().nullable(),
  mergedFrom: z.array(z.string()).nullable(),
  content: z.string(),
  category: z.string(),
  importance: z.number(),
  supersededBy: z.string().nullable(),
  history: z.array(MemoryVersionSchema).nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
}).meta({ id: "AgentMemory" })

// ---------------------------------------------------------------------------
// Generic pagination envelope — kept as a builder to allow varying item type
// ---------------------------------------------------------------------------

export function paginated<T extends z.ZodType>(itemSchema: T) {
  return z.object({
    items: z.array(itemSchema),
    total: z.number(),
    limit: z.number(),
    offset: z.number(),
  })
}

export const PaginatedRepo = paginated(Repo).meta({ id: "PaginatedRepo" })
export const PaginatedSession = paginated(Session).meta({ id: "PaginatedSession" })
export const PaginatedIssue = paginated(Issue).meta({ id: "PaginatedIssue" })

// ---------------------------------------------------------------------------
// Response schemas — helper / operation-specific shapes
// ---------------------------------------------------------------------------

export const HealthResponse = z.object({
  status: z.string(),
  version: z.string(),
  latestVersion: z.string().nullable(),
}).meta({ id: "HealthResponse" })

export const RepoHealthResponse = z.object({
  status: z.string(),
  repoId: z.string().nullable(),
  opencode: z.object({
    url: z.string().optional(),
    reachable: z.boolean(),
  }).optional(),
  workspace: z.string().optional(),
}).meta({ id: "RepoHealthResponse" })

export const ResolveRepoResponse = z.object({
  name: z.string(),
  gitUrl: z.string(),
  localPath: z.string(),
}).meta({ id: "ResolveRepoResponse" })

export const CloneRepoResponse = z.object({
  localPath: z.string(),
  name: z.string(),
  gitUrl: z.string(),
}).meta({ id: "CloneRepoResponse" })

export const BranchesResponse = z.object({
  current: z.string().nullable(),
  local: z.array(z.string()),
  remote: z.array(z.string()),
}).meta({ id: "BranchesResponse" })

export const CheckoutResponse = z.object({
  branch: z.string().nullable(),
  warning: z.string().optional(),
}).meta({ id: "CheckoutResponse" })

export const PullResponse = z.object({
  output: z.string(),
  branch: z.string().nullable(),
  summary: z.string(),
  alreadyUpToDate: z.boolean(),
  autostashed: z.boolean(),
  filesChanged: z.number(),
}).meta({ id: "PullResponse" })

export const AgentsMdResponse = z.object({
  content: z.string(),
}).meta({ id: "AgentsMdResponse" })

export const SyncIssuesResponse = z.object({
  synced: z.number(),
  comments: z.number(),
  tags: z.number(),
  milestones: z.number(),
}).meta({ id: "SyncIssuesResponse" })

export const SyncPullsResponse = z.object({
  synced: z.number(),
  links: z.number(),
}).meta({ id: "SyncPullsResponse" })

const SessionTimeSchema = z.object({
  created: z.number().optional(),
  updated: z.number().optional(),
}).partial()

export const SessionStatusSchema = z.object({
  type: z.enum(["idle", "busy", "retry"]),
}).catchall(z.unknown()).meta({ id: "SessionStatus" })

export const SessionStatusMap = z.record(z.string(), SessionStatusSchema).meta({ id: "SessionStatusMap" })

export const TodoItem = z.object({
  content: z.string(),
  status: z.string(),
  priority: z.string(),
  position: z.number().optional(),
}).meta({ id: "TodoItem" })

export const SessionLinksResponse = z.object({
  issues: z.array(Issue),
  pullRequests: z.array(PullRequest),
}).meta({ id: "SessionLinksResponse" })

export const SessionAllLinksResponse = z.record(
  z.string(),
  z.object({
    issues: z.array(z.object({
      id: z.string(),
      number: z.number(),
      title: z.string(),
      state: z.string(),
    })),
    pullRequests: z.array(z.object({
      id: z.string(),
      number: z.number(),
      title: z.string(),
      state: z.string(),
      mergedAt: z.number().nullable(),
    })),
  }),
).meta({ id: "SessionAllLinksResponse" })

export const SessionSnapshotResponse = z.object({
  session: z.unknown(),
  todos: z.array(TodoItem),
  status: SessionStatusSchema,
  links: z.array(z.object({
    type: z.string(),
    targetId: z.string(),
  })),
}).meta({ id: "SessionSnapshotResponse" })

export const MessagesPageResponse = z.object({
  messages: z.array(z.unknown()),
  total: z.number(),
  hasMore: z.boolean(),
}).meta({ id: "MessagesPageResponse" })

export const SessionFilePreview = z.object({
  path: z.string(),
  ext: z.string(),
}).meta({ id: "SessionFilePreview" })

export const IssueCommentWireSchema = z.object({
  id: z.union([z.string(), z.number()]),
  body: z.string(),
  user: z.object({
    login: z.string(),
    avatar_url: z.string(),
  }),
  created_at: z.string(),
  updated_at: z.string(),
}).meta({ id: "IssueCommentWire" })

export const ModelInfo = z.object({
  id: z.string(),
  name: z.string(),
  providerID: z.string(),
  providerName: z.string(),
  configured: z.boolean(),
  cost: z.object({
    input: z.number().optional(),
    output: z.number().optional(),
  }).optional(),
  contextLimit: z.number().optional(),
  supportsImage: z.boolean(),
}).meta({ id: "ModelInfo" })

export const AgentInfo = z.object({
  name: z.string(),
  description: z.string().optional(),
}).catchall(z.unknown()).meta({ id: "AgentInfo" })

export const WorkspaceInfo = Workspace.extend({
  diskUsage: z.number().nullable().optional(),
  merged: z.boolean(),
  status: z.enum(["active", "idle", "merged", "stale"]),
  canDelete: z.boolean(),
}).meta({ id: "WorkspaceInfo" })

export const WorkspaceCleanupResponse = z.object({
  removed: z.array(z.string()),
  skipped: z.array(z.object({
    id: z.string(),
    reason: z.string(),
  })),
}).meta({ id: "WorkspaceCleanupResponse" })

export const BrowseResponse = z.object({
  path: z.string(),
  parent: z.string().nullable(),
  entries: z.array(z.object({
    name: z.string(),
    isGitRepo: z.boolean(),
  })),
}).meta({ id: "BrowseResponse" })

export const TranscribeStatusResponse = z.object({
  available: z.boolean(),
}).meta({ id: "TranscribeStatusResponse" })

export const TranscribeResponse = z.object({
  text: z.string(),
}).meta({ id: "TranscribeResponse" })

export const CloudStatusResponse = z.object({
  mode: z.enum(["local", "worker"]),
  masterUrl: z.string().optional(),
  workerId: z.string().optional(),
  connected: z.boolean().optional(),
  heldAccount: z.object({
    id: z.string(),
    label: z.string(),
  }).optional(),
  defaultWorkerId: z.string().optional(),
}).meta({ id: "CloudStatusResponse" })

export const CloudTestResponse = z.object({
  connected: z.boolean(),
}).meta({ id: "CloudTestResponse" })

const UsageAccount = z.object({
  id: z.string(),
  idPrefix: z.string(),
  label: z.string(),
}).catchall(z.unknown())

export const UsageResponse = z.object({
  accounts: z.array(UsageAccount).optional(),
}).catchall(z.unknown()).meta({ id: "UsageResponse" })

export const AuthorizeResponse = z.object({
  pendingId: z.string(),
  url: z.string().optional(),
}).catchall(z.unknown()).meta({ id: "AuthorizeResponse" })

export const ExchangeResponse = z.object({
  ok: z.boolean(),
  reason: z.string().optional(),
}).catchall(z.unknown()).meta({ id: "ExchangeResponse" })

export const AnalyticsSummary = z.object({
  cost: z.number(),
  tokensInput: z.number(),
  tokensOutput: z.number(),
  tokensReasoning: z.number(),
  tokensCacheRead: z.number(),
  tokensCacheWrite: z.number(),
  sessionCount: z.number(),
}).meta({ id: "AnalyticsSummary" })

export const AnalyticsGroup = AnalyticsSummary.extend({
  key: z.string(),
  label: z.string(),
  repoId: z.string().optional(),
  date: z.string().optional(),
  agent: z.string().optional(),
  modelId: z.string().optional(),
  customAgentId: z.string().nullable().optional(),
  isSystem: z.boolean(),
}).meta({ id: "AnalyticsGroup" })

export const AnalyticsResponse = z.object({
  groups: z.array(AnalyticsGroup),
  total: AnalyticsSummary,
}).meta({ id: "AnalyticsResponse" })

export const MemoryStatsResponse = z.object({}).catchall(z.unknown()).meta({ id: "MemoryStatsResponse" })

export const AgentSessionSummary = z.object({
  id: z.string(),
  title: z.string(),
  agent: z.string().nullable(),
  cost: z.number(),
  tokensInput: z.number(),
  tokensOutput: z.number(),
  timeCreated: z.number(),
  timeUpdated: z.number(),
  completedAt: z.number().nullable(),
}).meta({ id: "AgentSessionSummary" })

export const ExtractMemoriesResult = z.object({
  results: z.array(z.object({
    sessionId: z.string(),
    status: z.string(),
    actions: z.number().optional(),
    error: z.string().optional(),
  })),
}).meta({ id: "ExtractMemoriesResult" })

export const ExportCustomAgentResponse = z.object({
  version: z.number(),
  type: z.literal("fourth-spark-custom-agent"),
  exportedAt: z.number(),
  agent: z.object({
    name: z.string(),
    baseAgent: z.string(),
    model: z.string().nullable(),
    variant: z.string().nullable(),
    systemPrompt: z.string(),
  }),
  fragments: z.array(z.object({
    name: z.string(),
    content: z.string(),
  })),
}).meta({ id: "ExportCustomAgentResponse" })

export const IssueDraftResponse = z.object({
  body: z.string(),
}).meta({ id: "IssueDraftResponse" })

export const IssueCreateDraftResponse = z.object({
  title: z.string(),
  body: z.string(),
}).meta({ id: "IssueCreateDraftResponse" })

export const PolishResponse = z.object({
  sessionId: z.string(),
  draftPath: z.string(),
  workspaceId: z.string().nullable(),
}).meta({ id: "PolishResponse" })

export const RuntimeUpdateResponse = z.object({
  runtimeType: z.string(),
}).meta({ id: "RuntimeUpdateResponse" })

export const WorktreeUpdateResponse = z.object({
  worktreeEnabled: z.boolean(),
}).meta({ id: "WorktreeUpdateResponse" })

export const RepoStatusResponse = z.object({
  status: z.string(),
}).meta({ id: "RepoStatusResponse" })

export const AddChildResponse = z.object({
  parentId: z.string(),
  childId: z.string(),
}).meta({ id: "AddChildResponse" })

// ---------------------------------------------------------------------------
// Request body schemas — re-defined here for schemas NOT exported from routes
// (only for routes whose bodies use inline `const` definitions, per task spec)
// ---------------------------------------------------------------------------

// repos.ts
export const ResolveRepoBody = z.object({
  localPath: z.string().min(1),
}).meta({ id: "ResolveRepoBody" })

export const CloneRepoBody = z.object({
  gitUrl: z.string().min(1),
  targetDir: z.string().optional(),
}).meta({ id: "CloneRepoBody" })

export const CreateRepoBody = z.object({
  name: z.string().min(1),
  gitUrl: z.string().min(1),
  localPath: z.string().min(1),
  runtimeType: z.string().optional(),
}).meta({ id: "CreateRepoBody" })

export const CheckoutBody = z.object({
  branch: z.string().min(1),
}).meta({ id: "CheckoutBody" })

export const UpdateRuntimeBody = z.object({
  runtimeType: z.string().min(1),
}).meta({ id: "UpdateRuntimeBody" })

export const UpdateWorktreeBody = z.object({
  enabled: z.boolean(),
}).meta({ id: "UpdateWorktreeBody" })

// tags.ts
export const CreateTagBody = z.object({
  name: z.string().min(1),
  color: z.string().optional(),
  description: z.string().optional(),
}).meta({ id: "CreateTagBody" })

export const UpdateTagBody = z.object({
  name: z.string().optional(),
  color: z.string().optional(),
  description: z.string().optional(),
}).meta({ id: "UpdateTagBody" })

// settings.ts
export const UpdateSettingBody = z.object({
  value: z.string(),
}).meta({ id: "UpdateSettingBody" })

// git-hosts.ts
export const CreateGitHostBody = z.object({
  host: z.string().min(1),
  platform: z.string().optional(),
  name: z.string().min(1),
  token: z.string().min(1),
}).meta({ id: "CreateGitHostBody" })

export const UpdateGitHostBody = z.object({
  host: z.string().optional(),
  platform: z.string().optional(),
  name: z.string().optional(),
  token: z.string().optional(),
}).meta({ id: "UpdateGitHostBody" })

// custom-agents.ts
export const CreateCustomAgentBody = z.object({
  name: z.string().min(1),
  baseAgent: z.string().min(1),
  model: z.string().optional(),
  variant: z.string().optional(),
  systemPrompt: z.string().optional(),
  systemPromptPosition: z.number().int().optional(),
  fragmentIds: z.array(z.string()).optional(),
}).meta({ id: "CreateCustomAgentBody" })

export const UpdateCustomAgentBody = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  baseAgent: z.string().optional(),
  model: z.string().nullable().optional(),
  variant: z.string().nullable().optional(),
  memoryModel: z.string().nullable().optional(),
  systemPrompt: z.string().optional(),
  systemPromptPosition: z.number().int().optional(),
  sortOrder: z.number().int().optional(),
  fragmentIds: z.array(z.string()).optional(),
}).meta({ id: "UpdateCustomAgentBody" })

export const ImportCustomAgentBody = z.object({
  version: z.number().optional(),
  type: z.literal("fourth-spark-custom-agent"),
  agent: z.object({
    name: z.string().min(1),
    baseAgent: z.string().min(1),
    model: z.string().nullable().optional(),
    variant: z.string().nullable().optional(),
    systemPrompt: z.string().optional(),
  }),
  fragments: z.array(z.object({
    name: z.string().optional(),
    content: z.string().optional(),
  })).optional(),
}).meta({ id: "ImportCustomAgentBody" })

// prompt-fragments.ts
export const CreateFragmentBody = z.object({
  name: z.string().min(1),
  content: z.string().optional(),
}).meta({ id: "CreateFragmentBody" })

export const UpdateFragmentBody = z.object({
  name: z.string().optional(),
  content: z.string().optional(),
  sortOrder: z.number().int().optional(),
}).meta({ id: "UpdateFragmentBody" })

// agent-memories.ts
export const CreateMemoryBody = z.object({
  content: z.string().min(1),
  category: z.string().optional(),
  importance: z.number().min(0).max(1).optional(),
}).meta({ id: "CreateMemoryBody" })

export const UpdateMemoryBody = z.object({
  content: z.string().optional(),
  category: z.string().optional(),
  importance: z.number().min(0).max(1).optional(),
}).meta({ id: "UpdateMemoryBody" })

export const ExtractMemoriesBody = z.object({
  sessionIds: z.array(z.string()).min(1),
}).meta({ id: "ExtractMemoriesBody" })

// agents-md.ts
export const UpdateGlobalAgentsMdBody = z.object({
  content: z.string(),
  runtimeType: z.string().optional(),
}).meta({ id: "UpdateGlobalAgentsMdBody" })

export const UpdateRepoAgentsMdBody = z.object({
  content: z.string(),
}).meta({ id: "UpdateRepoAgentsMdBody" })

// cloud.ts
export const CloudTestBody = z.object({
  url: z.string().min(1),
}).meta({ id: "CloudTestBody" })

// usage.ts
export const SwitchAccountBody = z.object({
  accountId: z.string().min(1),
}).meta({ id: "SwitchAccountBody" })

export const ExchangeBody = z.object({
  pendingId: z.string().min(1),
  code: z.string().min(1),
}).meta({ id: "ExchangeBody" })

// fs.ts
export const BrowseBody = z.object({
  path: z.string().optional(),
  showHidden: z.boolean().optional(),
}).meta({ id: "BrowseBody" })

// issues/tags.ts
export const SetIssueTagsBody = z.object({
  tagIds: z.array(z.string()),
}).meta({ id: "SetIssueTagsBody" })
