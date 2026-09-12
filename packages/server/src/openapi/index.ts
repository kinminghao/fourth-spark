import { OpenAPIRegistry, OpenApiGeneratorV31 } from "@asteasolutions/zod-to-openapi"
import { z } from "zod"
import type { ZodType } from "zod"
import * as S from "./schemas"
import {
  CreateSessionBody,
  SessionPromptBody,
  SessionRevertBody,
  QuestionReplyBody,
  UpdateSessionBody,
  SessionLinkBody,
} from "../routes/sessions/schemas"
import {
  SyncIssuesBody,
  CreateIssueBody,
  AddChildBody,
  MergeCloseBody,
  UpdateIssueBody,
  PolishDraftBody,
  CreateCommentBody,
  PolishCreateBody,
} from "../routes/issues/helpers"
import {
  SyncPullsBody,
  LinkIssueBody,
} from "../routes/pulls/helpers"

// ---------------------------------------------------------------------------
// Registry — collect schemas + routes
// ---------------------------------------------------------------------------

const registry = new OpenAPIRegistry()

// Zod v4 schemas tagged with `.meta({ id })` are auto-discovered by the
// generator when passed alongside registry.definitions. We do NOT call
// `registry.register()` — that method internally calls `.openapi()` which
// requires `extendZodWithOpenApi()`, which the task forbids for Zod v4.
//
// The route-file bodies below arrive without an id. We attach one with
// `.meta({ id })` so they surface under `components.schemas`.
const routeBodySchemas: ReadonlyArray<[string, ZodType]> = [
  ["CreateSessionBody", CreateSessionBody],
  ["SessionPromptBody", SessionPromptBody],
  ["SessionRevertBody", SessionRevertBody],
  ["QuestionReplyBody", QuestionReplyBody],
  ["UpdateSessionBody", UpdateSessionBody],
  ["SessionLinkBody", SessionLinkBody],
  ["SyncIssuesBody", SyncIssuesBody],
  ["CreateIssueBody", CreateIssueBody],
  ["AddChildBody", AddChildBody],
  ["MergeCloseBody", MergeCloseBody],
  ["UpdateIssueBody", UpdateIssueBody],
  ["PolishDraftBody", PolishDraftBody],
  ["CreateCommentBody", CreateCommentBody],
  ["PolishCreateBody", PolishCreateBody],
  ["SyncPullsBody", SyncPullsBody],
  ["LinkIssueBody", LinkIssueBody],
]

const namedRouteBodies = new Map<string, ZodType>(
  routeBodySchemas.map(([id, s]) => [id, s.meta({ id })]),
)

const CreateSessionBodyR = namedRouteBodies.get("CreateSessionBody")!
const SessionPromptBodyR = namedRouteBodies.get("SessionPromptBody")!
const SessionRevertBodyR = namedRouteBodies.get("SessionRevertBody")!
const QuestionReplyBodyR = namedRouteBodies.get("QuestionReplyBody")!
const UpdateSessionBodyR = namedRouteBodies.get("UpdateSessionBody")!
const SessionLinkBodyR = namedRouteBodies.get("SessionLinkBody")!
const SyncIssuesBodyR = namedRouteBodies.get("SyncIssuesBody")!
const CreateIssueBodyR = namedRouteBodies.get("CreateIssueBody")!
const AddChildBodyR = namedRouteBodies.get("AddChildBody")!
const MergeCloseBodyR = namedRouteBodies.get("MergeCloseBody")!
const UpdateIssueBodyR = namedRouteBodies.get("UpdateIssueBody")!
const PolishDraftBodyR = namedRouteBodies.get("PolishDraftBody")!
const CreateCommentBodyR = namedRouteBodies.get("CreateCommentBody")!
const PolishCreateBodyR = namedRouteBodies.get("PolishCreateBody")!
const SyncPullsBodyR = namedRouteBodies.get("SyncPullsBody")!
const LinkIssueBodyR = namedRouteBodies.get("LinkIssueBody")!

const allNamedSchemas: ZodType[] = [
  S.ErrorResponse,
  S.SuccessResponse,
  S.Repo,
  S.Session,
  S.Issue,
  S.IssueComment,
  S.Tag,
  S.Milestone,
  S.PullRequest,
  S.GitHost,
  S.Setting,
  S.Workspace,
  S.CustomAgent,
  S.PromptFragment,
  S.AgentMemory,
  S.PaginatedRepo,
  S.PaginatedSession,
  S.PaginatedIssue,
  S.HealthResponse,
  S.RepoHealthResponse,
  S.ResolveRepoResponse,
  S.CloneRepoResponse,
  S.BranchesResponse,
  S.CheckoutResponse,
  S.PullResponse,
  S.AgentsMdResponse,
  S.SyncIssuesResponse,
  S.SyncPullsResponse,
  S.SessionStatusSchema,
  S.SessionStatusMap,
  S.TodoItem,
  S.SessionLinksResponse,
  S.SessionAllLinksResponse,
  S.SessionSnapshotResponse,
  S.MessagesPageResponse,
  S.SessionFilePreview,
  S.IssueCommentWireSchema,
  S.ModelInfo,
  S.AgentInfo,
  S.WorkspaceInfo,
  S.WorkspaceCleanupResponse,
  S.BrowseResponse,
  S.TranscribeStatusResponse,
  S.TranscribeResponse,
  S.CloudStatusResponse,
  S.CloudTestResponse,
  S.UsageResponse,
  S.AuthorizeResponse,
  S.ExchangeResponse,
  S.AnalyticsSummary,
  S.AnalyticsGroup,
  S.AnalyticsResponse,
  S.MemoryStatsResponse,
  S.AgentSessionSummary,
  S.ExtractMemoriesResult,
  S.ExportCustomAgentResponse,
  S.IssueDraftResponse,
  S.IssueCreateDraftResponse,
  S.PolishResponse,
  S.RuntimeUpdateResponse,
  S.WorktreeUpdateResponse,
  S.RepoStatusResponse,
  S.AddChildResponse,
  S.ResolveRepoBody,
  S.CloneRepoBody,
  S.CreateRepoBody,
  S.CheckoutBody,
  S.UpdateRuntimeBody,
  S.UpdateWorktreeBody,
  S.CreateTagBody,
  S.UpdateTagBody,
  S.UpdateSettingBody,
  S.CreateGitHostBody,
  S.UpdateGitHostBody,
  S.CreateCustomAgentBody,
  S.UpdateCustomAgentBody,
  S.ImportCustomAgentBody,
  S.CreateFragmentBody,
  S.UpdateFragmentBody,
  S.CreateMemoryBody,
  S.UpdateMemoryBody,
  S.ExtractMemoriesBody,
  S.UpdateGlobalAgentsMdBody,
  S.UpdateRepoAgentsMdBody,
  S.CloudTestBody,
  S.SwitchAccountBody,
  S.ExchangeBody,
  S.BrowseBody,
  S.SetIssueTagsBody,
  ...namedRouteBodies.values(),
]

// ---------------------------------------------------------------------------
// Path/query param helpers
// ---------------------------------------------------------------------------

const RepoIdParam = z.object({ repoId: z.string() })
const IdParam = z.object({ id: z.string() })
const RepoIdWithIdParam = z.object({ repoId: z.string(), id: z.string() })
const RepoIdWithNumberParam = z.object({ repoId: z.string(), number: z.string() })
const RepoIdWithNumberPrParam = z.object({
  repoId: z.string(),
  number: z.string(),
  prNumber: z.string(),
})
const RepoIdWithNumberIssueParam = z.object({
  repoId: z.string(),
  number: z.string(),
  issueNumber: z.string(),
})
const AgentIdParam = z.object({ agentId: z.string() })
const AgentIdMemParam = z.object({ agentId: z.string(), memId: z.string() })
const KeyParam = z.object({ key: z.string() })
const UuidRepoParam = z.object({ repoId: z.string(), uuid: z.string() })
const SessionFileParam = z.object({
  repoId: z.string(),
  id: z.string(),
  path: z.string(),
})

// ---------------------------------------------------------------------------
// Response helpers — keep route registrations concise
// ---------------------------------------------------------------------------

function jsonResp(schema: ZodType, description: string) {
  return {
    description,
    content: { "application/json": { schema } },
  }
}

function jsonBody(schema: ZodType, description?: string) {
  return {
    description,
    content: { "application/json": { schema } },
    required: true,
  }
}

const errorResp = (description: string) => jsonResp(S.ErrorResponse, description)
const okResp = (description = "Success") => jsonResp(S.SuccessResponse, description)

const commonErrors = {
  400: errorResp("Bad request"),
  404: errorResp("Not found"),
  500: errorResp("Server error"),
}

const sseResp = {
  200: {
    description: "Server-Sent Events stream",
    content: { "text/event-stream": { schema: z.string() } },
  },
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

registry.registerPath({
  method: "get",
  path: "/api/health",
  tags: ["Health"],
  summary: "Server health + version info",
  responses: { 200: jsonResp(S.HealthResponse, "Health status") },
})

registry.registerPath({
  method: "get",
  path: "/api/repos/{repoId}/health",
  tags: ["Health"],
  summary: "Per-repo runtime health",
  request: { params: RepoIdParam },
  responses: { 200: jsonResp(S.RepoHealthResponse, "Repo runtime health") },
})

// ---------------------------------------------------------------------------
// Repos
// ---------------------------------------------------------------------------

registry.registerPath({
  method: "post",
  path: "/api/repos/resolve",
  tags: ["Repos"],
  summary: "Resolve name/remote from local path",
  request: { body: jsonBody(S.ResolveRepoBody) },
  responses: {
    200: jsonResp(S.ResolveRepoResponse, "Resolved repo info"),
    400: errorResp("Invalid path"),
  },
})

registry.registerPath({
  method: "post",
  path: "/api/repos/clone",
  tags: ["Repos"],
  summary: "Clone a remote git repo",
  request: { body: jsonBody(S.CloneRepoBody) },
  responses: {
    200: jsonResp(S.CloneRepoResponse, "Clone succeeded"),
    400: errorResp("Bad request"),
    409: errorResp("Target directory exists"),
    500: errorResp("Clone failed"),
  },
})

registry.registerPath({
  method: "post",
  path: "/api/repos",
  tags: ["Repos"],
  summary: "Register a new repo",
  request: { body: jsonBody(S.CreateRepoBody) },
  responses: {
    201: jsonResp(S.Repo, "Repo created"),
    400: errorResp("Invalid path"),
    409: errorResp("Path already registered"),
  },
})

registry.registerPath({
  method: "get",
  path: "/api/repos",
  tags: ["Repos"],
  summary: "List all repos",
  responses: {
    200: jsonResp(z.array(S.Repo), "List of repos"),
  },
})

registry.registerPath({
  method: "get",
  path: "/api/repos/{id}",
  tags: ["Repos"],
  summary: "Get a single repo",
  request: { params: IdParam },
  responses: {
    200: jsonResp(S.Repo, "Repo"),
    404: errorResp("Repo not found"),
  },
})

registry.registerPath({
  method: "delete",
  path: "/api/repos/{id}",
  tags: ["Repos"],
  summary: "Delete a repo (stops runtime, removes DB record)",
  request: { params: IdParam },
  responses: { 200: okResp("Deleted") },
})

registry.registerPath({
  method: "post",
  path: "/api/repos/{id}/start",
  tags: ["Repos"],
  summary: "Start a stopped repo runtime",
  request: { params: IdParam },
  responses: {
    200: jsonResp(S.RepoStatusResponse, "Started"),
    404: errorResp("Repo not found"),
    500: errorResp("Start failed"),
  },
})

registry.registerPath({
  method: "post",
  path: "/api/repos/{id}/stop",
  tags: ["Repos"],
  summary: "Stop a running repo runtime",
  request: { params: IdParam },
  responses: { 200: jsonResp(S.RepoStatusResponse, "Stopped") },
})

registry.registerPath({
  method: "get",
  path: "/api/repos/{id}/branches",
  tags: ["Repos"],
  summary: "List local and remote branches",
  request: { params: IdParam },
  responses: {
    200: jsonResp(S.BranchesResponse, "Branches"),
    404: errorResp("Repo not found"),
  },
})

registry.registerPath({
  method: "post",
  path: "/api/repos/{id}/checkout",
  tags: ["Repos"],
  summary: "Switch branch",
  request: { params: IdParam, body: jsonBody(S.CheckoutBody) },
  responses: {
    200: jsonResp(S.CheckoutResponse, "Checked out"),
    400: errorResp("Invalid branch or checkout failed"),
    404: errorResp("Repo not found"),
  },
})

registry.registerPath({
  method: "post",
  path: "/api/repos/{id}/pull",
  tags: ["Repos"],
  summary: "Pull latest from remote",
  request: { params: IdParam },
  responses: {
    200: jsonResp(S.PullResponse, "Pull result"),
    404: errorResp("Repo not found"),
    500: errorResp("Pull failed"),
  },
})

registry.registerPath({
  method: "patch",
  path: "/api/repos/{id}/runtime",
  tags: ["Repos"],
  summary: "Update runtime type",
  request: { params: IdParam, body: jsonBody(S.UpdateRuntimeBody) },
  responses: {
    200: jsonResp(S.RuntimeUpdateResponse, "Runtime updated"),
    404: errorResp("Repo not found"),
  },
})

registry.registerPath({
  method: "patch",
  path: "/api/repos/{id}/worktree",
  tags: ["Repos"],
  summary: "Toggle worktree mode",
  request: { params: IdParam, body: jsonBody(S.UpdateWorktreeBody) },
  responses: { 200: jsonResp(S.WorktreeUpdateResponse, "Worktree updated") },
})

registry.registerPath({
  method: "get",
  path: "/api/repos/{id}/agents-md",
  tags: ["Repos"],
  summary: "Read repo-scoped AGENTS.md",
  request: { params: IdParam },
  responses: {
    200: jsonResp(S.AgentsMdResponse, "AGENTS.md content"),
    404: errorResp("Repo not found"),
  },
})

registry.registerPath({
  method: "put",
  path: "/api/repos/{id}/agents-md",
  tags: ["Repos"],
  summary: "Update repo-scoped AGENTS.md",
  request: { params: IdParam, body: jsonBody(S.UpdateRepoAgentsMdBody) },
  responses: {
    200: okResp("Saved"),
    404: errorResp("Repo not found"),
  },
})

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

const SessionListQuery = z.object({
  limit: z.string().optional(),
  offset: z.string().optional(),
})

const MessagesQuery = z.object({
  limit: z.string().optional(),
  before: z.string().optional(),
})

registry.registerPath({
  method: "post",
  path: "/api/repos/{repoId}/sessions",
  tags: ["Sessions"],
  summary: "Create a session and dispatch the first prompt",
  request: { params: RepoIdParam, body: jsonBody(CreateSessionBodyR) },
  responses: {
    201: jsonResp(z.unknown(), "Session created"),
    400: errorResp("Invalid request"),
    404: errorResp("Repo not found"),
  },
})

registry.registerPath({
  method: "get",
  path: "/api/repos/{repoId}/sessions",
  tags: ["Sessions"],
  summary: "List sessions (merged live + DB, paginated)",
  request: { params: RepoIdParam, query: SessionListQuery },
  responses: { 200: jsonResp(S.PaginatedSession, "Paginated sessions") },
})

registry.registerPath({
  method: "get",
  path: "/api/repos/{repoId}/sessions/all-links",
  tags: ["Sessions"],
  summary: "Bulk fetch links for all sessions",
  request: { params: RepoIdParam },
  responses: { 200: jsonResp(S.SessionAllLinksResponse, "Links per session") },
})

registry.registerPath({
  method: "get",
  path: "/api/repos/{repoId}/sessions/snapshot/{id}",
  tags: ["Sessions"],
  summary: "Aggregated snapshot: session + todos + status + links",
  request: { params: RepoIdWithIdParam },
  responses: { 200: jsonResp(S.SessionSnapshotResponse, "Snapshot") },
})

registry.registerPath({
  method: "get",
  path: "/api/repos/{repoId}/sessions/status",
  tags: ["Sessions"],
  summary: "Bulk session status map",
  request: { params: RepoIdParam },
  responses: { 200: jsonResp(S.SessionStatusMap, "Status by sessionId") },
})

registry.registerPath({
  method: "get",
  path: "/api/repos/{repoId}/sessions/{id}",
  tags: ["Sessions"],
  summary: "Get a single session",
  request: { params: RepoIdWithIdParam },
  responses: {
    200: jsonResp(z.unknown(), "Session"),
    404: errorResp("Session not found"),
  },
})

registry.registerPath({
  method: "get",
  path: "/api/repos/{repoId}/sessions/{id}/todos",
  tags: ["Sessions"],
  summary: "List session todos",
  request: { params: RepoIdWithIdParam },
  responses: { 200: jsonResp(z.array(S.TodoItem), "Todos") },
})

registry.registerPath({
  method: "patch",
  path: "/api/repos/{repoId}/sessions/{id}",
  tags: ["Sessions"],
  summary: "Update session metadata (title, issueId, completedAt, pinnedAt)",
  request: { params: RepoIdWithIdParam, body: jsonBody(UpdateSessionBodyR) },
  responses: { 200: okResp("Updated") },
})

registry.registerPath({
  method: "get",
  path: "/api/repos/{repoId}/sessions/{id}/links",
  tags: ["Sessions"],
  summary: "Get session links",
  request: { params: RepoIdWithIdParam },
  responses: { 200: jsonResp(S.SessionLinksResponse, "Linked issues + PRs") },
})

registry.registerPath({
  method: "post",
  path: "/api/repos/{repoId}/sessions/{id}/links",
  tags: ["Sessions"],
  summary: "Create a link (issue or pr)",
  request: { params: RepoIdWithIdParam, body: jsonBody(SessionLinkBodyR) },
  responses: { 201: okResp("Linked") },
})

registry.registerPath({
  method: "delete",
  path: "/api/repos/{repoId}/sessions/{id}/links",
  tags: ["Sessions"],
  summary: "Remove a link (issue or pr)",
  request: { params: RepoIdWithIdParam, body: jsonBody(SessionLinkBodyR) },
  responses: { 200: okResp("Unlinked") },
})

registry.registerPath({
  method: "get",
  path: "/api/repos/{repoId}/sessions/{id}/status",
  tags: ["Sessions"],
  summary: "Get single session status",
  request: { params: RepoIdWithIdParam },
  responses: { 200: jsonResp(S.SessionStatusSchema, "Status") },
})

registry.registerPath({
  method: "post",
  path: "/api/repos/{repoId}/sessions/{id}/prompt",
  tags: ["Sessions"],
  summary: "Send a prompt to an existing session",
  request: { params: RepoIdWithIdParam, body: jsonBody(SessionPromptBodyR) },
  responses: {
    200: okResp("Prompt accepted"),
    400: errorResp("Invalid payload"),
  },
})

registry.registerPath({
  method: "post",
  path: "/api/repos/{repoId}/sessions/{id}/revert",
  tags: ["Sessions"],
  summary: "Revert to a previous message/part",
  request: { params: RepoIdWithIdParam, body: jsonBody(SessionRevertBodyR) },
  responses: { 200: jsonResp(z.unknown(), "Reverted session") },
})

registry.registerPath({
  method: "post",
  path: "/api/repos/{repoId}/sessions/{id}/abort",
  tags: ["Sessions"],
  summary: "Abort in-flight generation",
  request: { params: RepoIdWithIdParam },
  responses: { 200: okResp("Aborted") },
})

registry.registerPath({
  method: "post",
  path: "/api/repos/{repoId}/sessions/{id}/questions/reply",
  tags: ["Sessions"],
  summary: "Reply to a pending permission question",
  request: { params: RepoIdWithIdParam, body: jsonBody(QuestionReplyBodyR) },
  responses: {
    200: okResp("Replied"),
    404: errorResp("No pending question"),
  },
})

registry.registerPath({
  method: "post",
  path: "/api/repos/{repoId}/sessions/{id}/questions/reject",
  tags: ["Sessions"],
  summary: "Reject a pending permission question",
  request: { params: RepoIdWithIdParam },
  responses: {
    200: okResp("Rejected"),
    404: errorResp("No pending question"),
  },
})

registry.registerPath({
  method: "get",
  path: "/api/repos/{repoId}/sessions/{id}/messages",
  tags: ["Sessions"],
  summary: "List messages for a session",
  request: { params: RepoIdWithIdParam, query: MessagesQuery },
  responses: {
    200: jsonResp(
      z.union([z.array(z.unknown()), S.MessagesPageResponse]),
      "All messages OR paginated page",
    ),
  },
})

registry.registerPath({
  method: "get",
  path: "/api/repos/{repoId}/sessions/{id}/files",
  tags: ["Sessions"],
  summary: "List previewable files in the session workspace",
  request: { params: RepoIdWithIdParam },
  responses: {
    200: jsonResp(z.array(S.SessionFilePreview), "Previewable files"),
    404: errorResp("Session has no workspace"),
  },
})

registry.registerPath({
  method: "get",
  path: "/api/repos/{repoId}/sessions/{id}/files/{path}",
  tags: ["Sessions"],
  summary: "Read a previewable file from the session workspace",
  request: { params: SessionFileParam },
  responses: {
    200: {
      description: "File contents (image, HTML, markdown, or text)",
      content: {
        "application/octet-stream": { schema: z.string() },
      },
    },
    403: errorResp("Not previewable / not in changeset / symlink"),
    404: errorResp("Not found"),
  },
})

// ---------------------------------------------------------------------------
// Session events (SSE)
// ---------------------------------------------------------------------------

registry.registerPath({
  method: "get",
  path: "/api/repos/{repoId}/sessions/{id}/events",
  tags: ["Events"],
  summary: "Server-Sent Events stream for a session",
  request: { params: RepoIdWithIdParam },
  responses: sseResp,
})

registry.registerPath({
  method: "get",
  path: "/api/repos/{repoId}/events",
  tags: ["Events"],
  summary: "Global SSE stream for all sessions in a repo",
  request: { params: RepoIdParam },
  responses: sseResp,
})

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------

const IssueListQuery = z.object({
  state: z.string().optional(),
  tags: z.string().optional(),
  milestone: z.string().optional(),
  limit: z.string().optional(),
  offset: z.string().optional(),
})

registry.registerPath({
  method: "get",
  path: "/api/repos/{repoId}/issues",
  tags: ["Issues"],
  summary: "List issues (paginated, filter by state/tags/milestone)",
  request: { params: RepoIdParam, query: IssueListQuery },
  responses: { 200: jsonResp(S.PaginatedIssue, "Paginated issues") },
})

registry.registerPath({
  method: "post",
  path: "/api/repos/{repoId}/issues/sync",
  tags: ["Issues"],
  summary: "Sync issues + comments + milestones from git host",
  request: { params: RepoIdParam, body: jsonBody(SyncIssuesBodyR) },
  responses: {
    200: jsonResp(S.SyncIssuesResponse, "Sync counts"),
    400: errorResp("Bad request"),
    404: errorResp("Repo not found"),
    502: errorResp("Git host error"),
  },
})

registry.registerPath({
  method: "post",
  path: "/api/repos/{repoId}/issues",
  tags: ["Issues"],
  summary: "Create an issue on the git host",
  request: { params: RepoIdParam, body: jsonBody(CreateIssueBodyR) },
  responses: {
    201: jsonResp(S.Issue, "Created issue"),
    400: errorResp("Bad request"),
  },
})

registry.registerPath({
  method: "get",
  path: "/api/repos/{repoId}/issues/attachments/{uuid}",
  tags: ["Issues"],
  summary: "Proxy an attachment through the git host",
  request: { params: UuidRepoParam },
  responses: {
    200: {
      description: "Attachment bytes",
      content: { "application/octet-stream": { schema: z.string() } },
    },
    400: errorResp("Bad request"),
    404: errorResp("Not found"),
  },
})

registry.registerPath({
  method: "get",
  path: "/api/repos/{repoId}/issues/{number}/pulls",
  tags: ["Issues"],
  summary: "List PRs referencing an issue",
  request: { params: RepoIdWithNumberParam },
  responses: { 200: jsonResp(z.array(z.unknown()), "PRs from git host") },
})

registry.registerPath({
  method: "post",
  path: "/api/repos/{repoId}/issues/{number}/pulls/{prNumber}/merge",
  tags: ["Issues"],
  summary: "Merge a PR (optionally close the issue)",
  request: {
    params: RepoIdWithNumberPrParam,
    body: jsonBody(MergeCloseBodyR),
  },
  responses: {
    200: okResp("Merged"),
    400: errorResp("Bad request"),
    409: errorResp("Merge conflict"),
    500: errorResp("Merge failed"),
  },
})

registry.registerPath({
  method: "patch",
  path: "/api/repos/{repoId}/issues/{number}",
  tags: ["Issues"],
  summary: "Update an issue on the git host",
  request: { params: RepoIdWithNumberParam, body: jsonBody(UpdateIssueBodyR) },
  responses: {
    200: jsonResp(S.Issue, "Updated"),
    400: errorResp("Bad request"),
  },
})

registry.registerPath({
  method: "post",
  path: "/api/repos/{repoId}/issues/{number}/children",
  tags: ["Issues"],
  summary: "Link a child issue as sub-task of parent",
  request: { params: RepoIdWithNumberParam, body: jsonBody(AddChildBodyR) },
  responses: {
    200: jsonResp(S.AddChildResponse, "Linked"),
    404: errorResp("Not found"),
  },
})

registry.registerPath({
  method: "get",
  path: "/api/repos/{repoId}/issues/{number}/comments",
  tags: ["Issues"],
  summary: "List issue comments",
  request: { params: RepoIdWithNumberParam },
  responses: { 200: jsonResp(z.array(S.IssueCommentWireSchema), "Comments") },
})

registry.registerPath({
  method: "post",
  path: "/api/repos/{repoId}/issues/{number}/comments",
  tags: ["Issues"],
  summary: "Create a comment on an issue",
  request: {
    params: RepoIdWithNumberParam,
    body: jsonBody(CreateCommentBodyR),
  },
  responses: {
    201: jsonResp(S.IssueCommentWireSchema, "Created comment"),
    400: errorResp("Bad request"),
  },
})

registry.registerPath({
  method: "post",
  path: "/api/repos/{repoId}/issues/{number}/polish",
  tags: ["Issues"],
  summary: "Start a polish session for a comment draft",
  request: { params: RepoIdWithNumberParam, body: jsonBody(PolishDraftBodyR) },
  responses: {
    201: jsonResp(S.PolishResponse, "Polish session started"),
    400: errorResp("Bad request"),
    404: errorResp("Repo not found"),
    500: errorResp("Polish agent unavailable"),
  },
})

registry.registerPath({
  method: "get",
  path: "/api/repos/{repoId}/issues/{number}/draft",
  tags: ["Issues"],
  summary: "Read the polished comment draft",
  request: { params: RepoIdWithNumberParam },
  responses: {
    200: jsonResp(S.IssueDraftResponse, "Draft body"),
    404: errorResp("Draft not found"),
  },
})

registry.registerPath({
  method: "post",
  path: "/api/repos/{repoId}/issues/polish-create",
  tags: ["Issues"],
  summary: "Start a polish session for a new-issue draft",
  request: { params: RepoIdParam, body: jsonBody(PolishCreateBodyR) },
  responses: {
    201: jsonResp(S.PolishResponse, "Polish session started"),
    400: errorResp("Bad request"),
    404: errorResp("Repo not found"),
    500: errorResp("Polish agent unavailable"),
  },
})

registry.registerPath({
  method: "get",
  path: "/api/repos/{repoId}/issues/draft-create",
  tags: ["Issues"],
  summary: "Read the polished new-issue draft",
  request: { params: RepoIdParam },
  responses: {
    200: jsonResp(S.IssueCreateDraftResponse, "Title + body"),
    404: errorResp("Draft not found"),
  },
})

registry.registerPath({
  method: "delete",
  path: "/api/repos/{repoId}/issues/draft-create",
  tags: ["Issues"],
  summary: "Discard the new-issue draft",
  request: { params: RepoIdParam },
  responses: { 200: okResp("Deleted") },
})

registry.registerPath({
  method: "put",
  path: "/api/repos/{repoId}/issues/{number}/tags",
  tags: ["Issues"],
  summary: "Replace tags for an issue",
  request: {
    params: RepoIdWithNumberParam,
    body: jsonBody(S.SetIssueTagsBody),
  },
  responses: {
    200: jsonResp(z.array(S.Tag), "Current tags"),
    404: errorResp("Issue not found"),
  },
})

registry.registerPath({
  method: "get",
  path: "/api/repos/{repoId}/issues/{number}/tags",
  tags: ["Issues"],
  summary: "Get tags for an issue",
  request: { params: RepoIdWithNumberParam },
  responses: { 200: jsonResp(z.array(S.Tag), "Tags") },
})

// ---------------------------------------------------------------------------
// Pull Requests
// ---------------------------------------------------------------------------

const PullListQuery = z.object({ state: z.string().optional() })

registry.registerPath({
  method: "get",
  path: "/api/repos/{repoId}/pulls",
  tags: ["Pull Requests"],
  summary: "List pull requests from DB",
  request: { params: RepoIdParam, query: PullListQuery },
  responses: { 200: jsonResp(z.array(S.PullRequest), "Pull requests") },
})

registry.registerPath({
  method: "post",
  path: "/api/repos/{repoId}/pulls/sync",
  tags: ["Pull Requests"],
  summary: "Sync PRs from git host",
  request: { params: RepoIdParam, body: jsonBody(SyncPullsBodyR) },
  responses: {
    200: jsonResp(S.SyncPullsResponse, "Sync counts"),
    400: errorResp("Bad request"),
    404: errorResp("Repo not found"),
    502: errorResp("Git host error"),
  },
})

registry.registerPath({
  method: "get",
  path: "/api/repos/{repoId}/pulls/{number}",
  tags: ["Pull Requests"],
  summary: "Get a single PR (with diff stats)",
  request: { params: RepoIdWithNumberParam },
  responses: {
    200: jsonResp(S.PullRequest, "Pull request"),
    400: errorResp("Bad request"),
  },
})

registry.registerPath({
  method: "post",
  path: "/api/repos/{repoId}/pulls/{number}/merge",
  tags: ["Pull Requests"],
  summary: "Merge a PR",
  request: { params: RepoIdWithNumberParam },
  responses: {
    200: okResp("Merged"),
    400: errorResp("Bad request"),
    409: errorResp("Merge conflict"),
    500: errorResp("Merge failed"),
  },
})

registry.registerPath({
  method: "get",
  path: "/api/repos/{repoId}/pulls/{number}/files",
  tags: ["Pull Requests"],
  summary: "List PR changed files",
  request: { params: RepoIdWithNumberParam },
  responses: { 200: jsonResp(z.array(z.unknown()), "Files with diff stats") },
})

registry.registerPath({
  method: "get",
  path: "/api/repos/{repoId}/pulls/{number}/commits",
  tags: ["Pull Requests"],
  summary: "List PR commits",
  request: { params: RepoIdWithNumberParam },
  responses: { 200: jsonResp(z.array(z.unknown()), "Commits") },
})

registry.registerPath({
  method: "get",
  path: "/api/repos/{repoId}/pulls/{number}/comments",
  tags: ["Pull Requests"],
  summary: "List PR comments",
  request: { params: RepoIdWithNumberParam },
  responses: { 200: jsonResp(z.array(z.unknown()), "Comments") },
})

registry.registerPath({
  method: "get",
  path: "/api/repos/{repoId}/pulls/{number}/issues",
  tags: ["Pull Requests"],
  summary: "Issues linked to a PR",
  request: { params: RepoIdWithNumberParam },
  responses: { 200: jsonResp(z.array(S.Issue), "Linked issues") },
})

registry.registerPath({
  method: "post",
  path: "/api/repos/{repoId}/pulls/{number}/issues",
  tags: ["Pull Requests"],
  summary: "Link an issue to a PR",
  request: { params: RepoIdWithNumberParam, body: jsonBody(LinkIssueBodyR) },
  responses: {
    200: okResp("Linked"),
    404: errorResp("PR or issue not found"),
  },
})

registry.registerPath({
  method: "delete",
  path: "/api/repos/{repoId}/pulls/{number}/issues/{issueNumber}",
  tags: ["Pull Requests"],
  summary: "Unlink an issue from a PR",
  request: { params: RepoIdWithNumberIssueParam },
  responses: { 200: okResp("Unlinked") },
})

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

registry.registerPath({
  method: "get",
  path: "/api/repos/{repoId}/tags",
  tags: ["Tags"],
  summary: "List tags for a repo",
  request: { params: RepoIdParam },
  responses: { 200: jsonResp(z.array(S.Tag), "Tags") },
})

registry.registerPath({
  method: "post",
  path: "/api/repos/{repoId}/tags",
  tags: ["Tags"],
  summary: "Create a tag",
  request: { params: RepoIdParam, body: jsonBody(S.CreateTagBody) },
  responses: { 201: jsonResp(S.Tag, "Created") },
})

registry.registerPath({
  method: "patch",
  path: "/api/repos/{repoId}/tags/{id}",
  tags: ["Tags"],
  summary: "Update a tag",
  request: { params: RepoIdWithIdParam, body: jsonBody(S.UpdateTagBody) },
  responses: {
    200: jsonResp(S.Tag, "Updated"),
    400: errorResp("Nothing to update"),
    404: errorResp("Tag not found"),
  },
})

registry.registerPath({
  method: "delete",
  path: "/api/repos/{repoId}/tags/{id}",
  tags: ["Tags"],
  summary: "Delete a tag",
  request: { params: RepoIdWithIdParam },
  responses: {
    200: okResp("Deleted"),
    404: errorResp("Tag not found"),
  },
})

// ---------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------

registry.registerPath({
  method: "get",
  path: "/api/repos/{repoId}/milestones",
  tags: ["Milestones"],
  summary: "List milestones",
  request: {
    params: RepoIdParam,
    query: z.object({ state: z.string().optional() }),
  },
  responses: { 200: jsonResp(z.array(S.Milestone), "Milestones") },
})

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

registry.registerPath({
  method: "get",
  path: "/api/repos/{repoId}/models",
  tags: ["Models"],
  summary: "List models available to the workspace",
  request: { params: RepoIdParam },
  responses: { 200: jsonResp(z.array(S.ModelInfo), "Models") },
})

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

registry.registerPath({
  method: "get",
  path: "/api/repos/{repoId}/agents",
  tags: ["Agents"],
  summary: "List agents available in the workspace",
  request: { params: RepoIdParam },
  responses: { 200: jsonResp(z.array(S.AgentInfo), "Agents") },
})

// ---------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------

registry.registerPath({
  method: "get",
  path: "/api/repos/{repoId}/workspaces",
  tags: ["Workspaces"],
  summary: "List workspaces for a repo",
  request: { params: RepoIdParam },
  responses: { 200: jsonResp(z.array(S.WorkspaceInfo), "Workspaces") },
})

registry.registerPath({
  method: "delete",
  path: "/api/repos/{repoId}/workspaces/{id}",
  tags: ["Workspaces"],
  summary: "Delete a workspace",
  request: { params: RepoIdWithIdParam },
  responses: {
    200: okResp("Deleted"),
    409: errorResp("Has busy sessions"),
    500: errorResp("Remove failed"),
  },
})

registry.registerPath({
  method: "post",
  path: "/api/repos/{repoId}/workspaces/cleanup",
  tags: ["Workspaces"],
  summary: "Bulk cleanup merged / stale workspaces",
  request: { params: RepoIdParam },
  responses: { 200: jsonResp(S.WorkspaceCleanupResponse, "Cleanup result") },
})

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

registry.registerPath({
  method: "get",
  path: "/api/settings",
  tags: ["Settings"],
  summary: "Get all settings",
  responses: { 200: jsonResp(S.Setting, "Settings map") },
})

registry.registerPath({
  method: "put",
  path: "/api/settings/{key}",
  tags: ["Settings"],
  summary: "Upsert a setting value",
  request: { params: KeyParam, body: jsonBody(S.UpdateSettingBody) },
  responses: { 200: okResp("Saved") },
})

registry.registerPath({
  method: "delete",
  path: "/api/settings/{key}",
  tags: ["Settings"],
  summary: "Delete a setting",
  request: { params: KeyParam },
  responses: { 200: okResp("Deleted") },
})

// ---------------------------------------------------------------------------
// Git Hosts
// ---------------------------------------------------------------------------

registry.registerPath({
  method: "get",
  path: "/api/git-hosts",
  tags: ["Git Hosts"],
  summary: "List configured git hosts (tokens masked)",
  responses: { 200: jsonResp(z.array(S.GitHost), "Git hosts") },
})

registry.registerPath({
  method: "post",
  path: "/api/git-hosts",
  tags: ["Git Hosts"],
  summary: "Create a git host",
  request: { body: jsonBody(S.CreateGitHostBody) },
  responses: { 201: jsonResp(S.GitHost, "Created (token masked)") },
})

registry.registerPath({
  method: "put",
  path: "/api/git-hosts/{id}",
  tags: ["Git Hosts"],
  summary: "Update a git host",
  request: { params: IdParam, body: jsonBody(S.UpdateGitHostBody) },
  responses: {
    200: jsonResp(S.GitHost, "Updated (token masked)"),
    404: errorResp("Not found"),
  },
})

registry.registerPath({
  method: "delete",
  path: "/api/git-hosts/{id}",
  tags: ["Git Hosts"],
  summary: "Delete a git host",
  request: { params: IdParam },
  responses: { 200: okResp("Deleted") },
})

// ---------------------------------------------------------------------------
// Custom Agents
// ---------------------------------------------------------------------------

registry.registerPath({
  method: "get",
  path: "/api/custom-agents",
  tags: ["Custom Agents"],
  summary: "List global custom agents",
  responses: { 200: jsonResp(z.array(S.CustomAgent), "Custom agents") },
})

registry.registerPath({
  method: "post",
  path: "/api/custom-agents",
  tags: ["Custom Agents"],
  summary: "Create a global custom agent",
  request: { body: jsonBody(S.CreateCustomAgentBody) },
  responses: {
    201: jsonResp(S.CustomAgent, "Created"),
    400: errorResp("Bad request"),
  },
})

registry.registerPath({
  method: "put",
  path: "/api/custom-agents/{id}",
  tags: ["Custom Agents"],
  summary: "Update a custom agent",
  request: { params: IdParam, body: jsonBody(S.UpdateCustomAgentBody) },
  responses: {
    200: jsonResp(S.CustomAgent, "Updated"),
    400: errorResp("Bad request"),
    404: errorResp("Not found"),
  },
})

registry.registerPath({
  method: "delete",
  path: "/api/custom-agents/{id}",
  tags: ["Custom Agents"],
  summary: "Delete a custom agent",
  request: { params: IdParam },
  responses: {
    200: okResp("Deleted"),
    403: errorResp("System agent, cannot delete"),
  },
})

registry.registerPath({
  method: "get",
  path: "/api/custom-agents/{id}/export",
  tags: ["Custom Agents"],
  summary: "Export a custom agent (with fragments)",
  request: { params: IdParam },
  responses: {
    200: jsonResp(S.ExportCustomAgentResponse, "Export payload"),
    404: errorResp("Not found"),
  },
})

registry.registerPath({
  method: "post",
  path: "/api/custom-agents/import",
  tags: ["Custom Agents"],
  summary: "Import a custom agent from export payload",
  request: { body: jsonBody(S.ImportCustomAgentBody) },
  responses: {
    201: jsonResp(S.CustomAgent, "Imported"),
    400: errorResp("Bad request"),
  },
})

registry.registerPath({
  method: "get",
  path: "/api/repos/{repoId}/custom-agents",
  tags: ["Custom Agents"],
  summary: "List custom agents for a repo (global + repo-scoped)",
  request: { params: RepoIdParam },
  responses: { 200: jsonResp(z.array(S.CustomAgent), "Custom agents") },
})

registry.registerPath({
  method: "post",
  path: "/api/repos/{repoId}/custom-agents",
  tags: ["Custom Agents"],
  summary: "Create a repo-scoped custom agent",
  request: {
    params: RepoIdParam,
    body: jsonBody(S.CreateCustomAgentBody),
  },
  responses: {
    201: jsonResp(S.CustomAgent, "Created"),
    400: errorResp("Bad request"),
  },
})

// ---------------------------------------------------------------------------
// Prompt Fragments
// ---------------------------------------------------------------------------

registry.registerPath({
  method: "get",
  path: "/api/prompt-fragments",
  tags: ["Prompt Fragments"],
  summary: "List global prompt fragments",
  responses: { 200: jsonResp(z.array(S.PromptFragment), "Fragments") },
})

registry.registerPath({
  method: "post",
  path: "/api/prompt-fragments",
  tags: ["Prompt Fragments"],
  summary: "Create a global prompt fragment",
  request: { body: jsonBody(S.CreateFragmentBody) },
  responses: { 201: jsonResp(S.PromptFragment, "Created") },
})

registry.registerPath({
  method: "put",
  path: "/api/prompt-fragments/{id}",
  tags: ["Prompt Fragments"],
  summary: "Update a prompt fragment",
  request: { params: IdParam, body: jsonBody(S.UpdateFragmentBody) },
  responses: {
    200: jsonResp(S.PromptFragment, "Updated"),
    404: errorResp("Not found"),
  },
})

registry.registerPath({
  method: "delete",
  path: "/api/prompt-fragments/{id}",
  tags: ["Prompt Fragments"],
  summary: "Delete a prompt fragment",
  request: { params: IdParam },
  responses: { 200: okResp("Deleted") },
})

registry.registerPath({
  method: "get",
  path: "/api/repos/{repoId}/prompt-fragments",
  tags: ["Prompt Fragments"],
  summary: "List prompt fragments for a repo (global + repo-scoped)",
  request: { params: RepoIdParam },
  responses: { 200: jsonResp(z.array(S.PromptFragment), "Fragments") },
})

// ---------------------------------------------------------------------------
// Agent Memories
// ---------------------------------------------------------------------------

const AgentMemoryQuery = z.object({
  category: z.string().optional(),
  includeSuperseded: z.string().optional(),
})

registry.registerPath({
  method: "get",
  path: "/api/custom-agents/{agentId}/memories",
  tags: ["Agent Memories"],
  summary: "List memories for a custom agent",
  request: { params: AgentIdParam, query: AgentMemoryQuery },
  responses: {
    200: jsonResp(z.array(S.AgentMemory), "Memories"),
    ...commonErrors,
  },
})

registry.registerPath({
  method: "get",
  path: "/api/custom-agents/{agentId}/memories/stats",
  tags: ["Agent Memories"],
  summary: "Get consolidation stats for an agent",
  request: { params: AgentIdParam },
  responses: {
    200: jsonResp(S.MemoryStatsResponse, "Stats"),
    ...commonErrors,
  },
})

registry.registerPath({
  method: "post",
  path: "/api/custom-agents/{agentId}/memories/consolidate",
  tags: ["Agent Memories"],
  summary: "Trigger a manual consolidation",
  request: { params: AgentIdParam },
  responses: {
    200: jsonResp(z.object({ status: z.string() }), "Started"),
    409: errorResp("Consolidation already running"),
    503: errorResp("No runtime clients available"),
    ...commonErrors,
  },
})

registry.registerPath({
  method: "post",
  path: "/api/custom-agents/{agentId}/memories",
  tags: ["Agent Memories"],
  summary: "Create a memory manually",
  request: { params: AgentIdParam, body: jsonBody(S.CreateMemoryBody) },
  responses: {
    201: jsonResp(S.AgentMemory, "Created"),
    ...commonErrors,
  },
})

registry.registerPath({
  method: "put",
  path: "/api/custom-agents/{agentId}/memories/{memId}",
  tags: ["Agent Memories"],
  summary: "Update a memory",
  request: { params: AgentIdMemParam, body: jsonBody(S.UpdateMemoryBody) },
  responses: {
    200: jsonResp(S.AgentMemory, "Updated"),
    ...commonErrors,
  },
})

registry.registerPath({
  method: "delete",
  path: "/api/custom-agents/{agentId}/memories/{memId}",
  tags: ["Agent Memories"],
  summary: "Soft-delete a memory",
  request: { params: AgentIdMemParam },
  responses: {
    200: okResp("Deleted"),
    ...commonErrors,
  },
})

registry.registerPath({
  method: "post",
  path: "/api/custom-agents/{agentId}/memories/extract",
  tags: ["Agent Memories"],
  summary: "Extract memories from given sessions",
  request: { params: AgentIdParam, body: jsonBody(S.ExtractMemoriesBody) },
  responses: {
    200: jsonResp(S.ExtractMemoriesResult, "Extraction results"),
    ...commonErrors,
  },
})

registry.registerPath({
  method: "get",
  path: "/api/custom-agents/{agentId}/sessions",
  tags: ["Agent Memories"],
  summary: "List sessions for a custom agent (memory context)",
  request: { params: AgentIdParam },
  responses: { 200: jsonResp(z.array(S.AgentSessionSummary), "Sessions") },
})

// ---------------------------------------------------------------------------
// Agents MD (global)
// ---------------------------------------------------------------------------

registry.registerPath({
  method: "get",
  path: "/api/agents-md",
  tags: ["Agents MD"],
  summary: "Read global AGENTS.md",
  request: {
    query: z.object({ runtimeType: z.string().optional() }),
  },
  responses: { 200: jsonResp(S.AgentsMdResponse, "AGENTS.md content") },
})

registry.registerPath({
  method: "put",
  path: "/api/agents-md",
  tags: ["Agents MD"],
  summary: "Update global AGENTS.md",
  request: { body: jsonBody(S.UpdateGlobalAgentsMdBody) },
  responses: { 200: okResp("Saved") },
})

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

registry.registerPath({
  method: "get",
  path: "/api/usage",
  tags: ["Usage"],
  summary: "Fetch usage data (Claude Code accounts)",
  responses: { 200: jsonResp(S.UsageResponse, "Usage") },
})

registry.registerPath({
  method: "post",
  path: "/api/usage/switch",
  tags: ["Usage"],
  summary: "Switch active Claude account (or lease from cloud master)",
  request: { body: jsonBody(S.SwitchAccountBody) },
  responses: {
    200: jsonResp(S.UsageResponse, "Switched"),
    400: errorResp("Bad request"),
    500: errorResp("Worker config unavailable"),
    502: errorResp("Master returned stale lease"),
  },
})

registry.registerPath({
  method: "post",
  path: "/api/usage/authorize",
  tags: ["Usage"],
  summary: "Begin OAuth PKCE authorization",
  responses: {
    200: jsonResp(S.AuthorizeResponse, "Authorization payload"),
    400: errorResp("Not available in worker mode"),
  },
})

registry.registerPath({
  method: "post",
  path: "/api/usage/exchange",
  tags: ["Usage"],
  summary: "Exchange OAuth code for tokens",
  request: { body: jsonBody(S.ExchangeBody) },
  responses: {
    200: jsonResp(S.ExchangeResponse, "Exchanged"),
    400: errorResp("Exchange failed"),
    429: errorResp("Throttled"),
  },
})

registry.registerPath({
  method: "delete",
  path: "/api/usage/accounts/{id}",
  tags: ["Usage"],
  summary: "Remove a stored Claude account",
  request: { params: IdParam },
  responses: {
    200: jsonResp(S.ExchangeResponse, "Removed"),
    400: errorResp("Not available in worker mode"),
  },
})

// ---------------------------------------------------------------------------
// Cloud
// ---------------------------------------------------------------------------

registry.registerPath({
  method: "get",
  path: "/api/cloud/status",
  tags: ["Cloud"],
  summary: "Cloud (worker) mode status",
  responses: { 200: jsonResp(S.CloudStatusResponse, "Status") },
})

registry.registerPath({
  method: "post",
  path: "/api/cloud/reload",
  tags: ["Cloud"],
  summary: "Reload cloud pool config",
  responses: { 200: jsonResp(S.CloudStatusResponse, "Reloaded status") },
})

registry.registerPath({
  method: "post",
  path: "/api/cloud/test",
  tags: ["Cloud"],
  summary: "Test master URL connectivity",
  request: { body: jsonBody(S.CloudTestBody) },
  responses: { 200: jsonResp(S.CloudTestResponse, "Test result") },
})

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

const AnalyticsQuery = z.object({
  from: z.string(),
  to: z.string(),
  repoId: z.string().optional(),
  groupBy: z.enum(["repo", "day", "agent"]),
  limit: z.string().optional(),
  offset: z.string().optional(),
})

registry.registerPath({
  method: "get",
  path: "/api/analytics/summary",
  tags: ["Analytics"],
  summary: "Aggregate cost/token analytics",
  request: { query: AnalyticsQuery },
  responses: {
    200: jsonResp(S.AnalyticsResponse, "Grouped summary"),
    400: errorResp("Bad request"),
  },
})

// ---------------------------------------------------------------------------
// File System
// ---------------------------------------------------------------------------

registry.registerPath({
  method: "post",
  path: "/api/fs/browse",
  tags: ["File System"],
  summary: "Browse a directory (filtered, non-symlinked)",
  request: { body: jsonBody(S.BrowseBody) },
  responses: {
    200: jsonResp(S.BrowseResponse, "Entries"),
    400: errorResp("Invalid path"),
    403: errorResp("Access denied"),
  },
})

// ---------------------------------------------------------------------------
// Transcribe
// ---------------------------------------------------------------------------

registry.registerPath({
  method: "get",
  path: "/api/transcribe/status",
  tags: ["Transcribe"],
  summary: "Check SenseVoice availability",
  responses: { 200: jsonResp(S.TranscribeStatusResponse, "Status") },
})

registry.registerPath({
  method: "post",
  path: "/api/transcribe",
  tags: ["Transcribe"],
  summary: "Transcribe an uploaded audio file",
  request: {
    body: {
      description: "Multipart form containing an 'audio' file field",
      required: true,
      content: {
        "multipart/form-data": {
          schema: z.object({
            audio: z.string(),
          }),
        },
      },
    },
  },
  responses: {
    200: jsonResp(S.TranscribeResponse, "Transcription text"),
    400: errorResp("Missing audio"),
    413: errorResp("File too large"),
    503: errorResp("SenseVoice unavailable"),
  },
})

// ---------------------------------------------------------------------------
// MCP — special handler, documented only
// ---------------------------------------------------------------------------

for (const method of ["get", "post", "put", "delete", "patch"] as const) {
  registry.registerPath({
    method,
    path: "/api/repos/{repoId}/mcp",
    tags: ["MCP"],
    summary: `MCP JSON-RPC endpoint (${method.toUpperCase()})`,
    request: { params: RepoIdParam },
    responses: {
      200: {
        description: "MCP JSON-RPC response",
        content: { "application/json": { schema: z.unknown() } },
      },
    },
  })
}

// ---------------------------------------------------------------------------
// Public generator
// ---------------------------------------------------------------------------

export function generateOpenApiSpec() {
  const generator = new OpenApiGeneratorV31([...allNamedSchemas, ...registry.definitions])
  return generator.generateDocument({
    openapi: "3.1.0",
    info: {
      title: "Fourth Spark API",
      version: "1.0.0",
      description:
        "AI coding agent management platform — manage repos, sessions, issues, and more",
    },
    tags: [
      { name: "Health", description: "Server and repo health checks" },
      { name: "Repos", description: "Repository CRUD, git operations (branches, checkout, pull)" },
      { name: "Sessions", description: "Agent coding sessions — create, prompt, abort, messages, todos, links" },
      { name: "Issues", description: "Issue tracking — CRUD, sync from git platform, comments, polish, tags" },
      { name: "Pull Requests", description: "PR tracking — CRUD, sync, merge, files, commits, linked issues" },
      { name: "Tags", description: "Per-repo label/tag management" },
      { name: "Milestones", description: "Per-repo milestone listing" },
      { name: "Models", description: "Available LLM models for a repo runtime" },
      { name: "Agents", description: "Available agents in a repo runtime" },
      { name: "Workspaces", description: "Git worktree-based workspaces for sessions" },
      { name: "Events", description: "Server-Sent Events (SSE) streams for real-time updates" },
      { name: "Settings", description: "Global key-value settings" },
      { name: "Git Hosts", description: "Git platform credentials (GitHub, Gitea, GitLab)" },
      { name: "Custom Agents", description: "User-defined agent configurations with system prompts and fragments" },
      { name: "Prompt Fragments", description: "Reusable prompt snippets for custom agents" },
      { name: "Agent Memories", description: "Agent memory CRUD, extraction, and consolidation" },
      { name: "Agents MD", description: "Global and per-repo instruction files (AGENTS.md / CLAUDE.md)" },
      { name: "Usage", description: "Claude account usage, switching, and OAuth onboarding" },
      { name: "Cloud", description: "Cloud/worker mode status and configuration" },
      { name: "Analytics", description: "Cost and token usage analytics with groupBy dimensions" },
      { name: "File System", description: "Local filesystem directory browsing" },
      { name: "Transcribe", description: "Speech-to-text via SenseVoice" },
      { name: "MCP", description: "Model Context Protocol handler (git tools)" },
    ],
  })
}
