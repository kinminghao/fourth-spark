# Fourth Spark: OpenCode V1 API Migration Guide

> **⚠️ ARCHIVED — 2026-07-22**
>
> 本文档的前提已被证伪。经实际验证：
>
> 1. **V1 Workspace API (`/v1/workspaces/*`) 在当前 OpenCode v1.18.0 中不存在。** 该 API 仅出现在 charmbracelet/crush（opencode 的继任项目）开发分支源码中，从未正式发布。
> 2. **OpenCode 内置 Web UI (port 8000) 和 legacy API (`/session/*`) 走的是同一套代码路径。** 之前观察到的产出质量差异实际原因是 `variant: "max"` 参数缺失和 `WORKSPACE_DIR` 配置错误，已在 commit `e97befc` 中修复。
> 3. 本文档中的端点映射、请求体格式等信息来源于 crush 未发布源码，**不适用于当前版本**。
>
> **保留本文档仅供参考**：当 crush/opencode 正式发布 V1 API 后，可作为迁移的起点重新评估。在此之前，继续使用 legacy API 即可。

---

## Background (原始内容，前提已失效)

Fourth Spark currently uses the **legacy OpenCode API** (`/session/*`, `/event`, `/agent`), which maps to an older code path in the OpenCode server. ~~The built-in Web UI (port 8000) uses the **V1 Workspace API** (`/v1/workspaces/*`), which goes through the full workspace pipeline — including agent initialization, skill loading, LSP/MCP context, and permission management.~~

~~This difference explains why the same agent + model produces noticeably less detailed output when called via Fourth Spark compared to the built-in Web UI: the legacy path likely skips parts of the workspace-level context injection that the V1 path performs.~~

**实际原因**: 产出质量差异是 `variant` / `WORKSPACE_DIR` 参数问题，与 API 版本无关。已修复。

~~**Goal**: Migrate Fourth Spark's server proxy from the legacy API to the V1 Workspace API.~~

---

## Architecture Change

```
Before (legacy):
  React → Hono → /session/{id}/prompt_async  → OpenCode (partial context)
                  /event                       → OpenCode (global SSE)

After (v1):
  React → Hono → /v1/workspaces/{wid}/agent   → OpenCode (full workspace context)
                  /v1/workspaces/{wid}/events   → OpenCode (workspace-scoped SSE)
```

The proxy layer (Hono middleware, CORS, error handling) stays the same. Only the upstream OpenCode endpoint paths and request/response shapes change.

---

## Endpoint Mapping: Legacy → V1

### Workspace Lifecycle (NEW — no legacy equivalent)

| V1 Endpoint | Method | Purpose |
|---|---|---|
| `/v1/workspaces` | `POST` | Create workspace (required before any session/agent ops) |
| `/v1/workspaces` | `GET` | List workspaces |
| `/v1/workspaces/{id}` | `GET` | Get workspace details |
| `/v1/workspaces/{id}` | `DELETE` | Delete workspace (requires `?client_id=UUID`) |

**Request body** (`POST /v1/workspaces`):
```jsonc
{
  "path": "/absolute/path/to/project",   // WORKSPACE_DIR
  "client_id": "uuid-v4",                // unique per Fourth Spark instance
  "yolo": false,                         // skip permission prompts
  "debug": false
}
```

**Response** (`Workspace`):
```jsonc
{
  "id": "workspace-id",
  "path": "/absolute/path/to/project",
  "version": "1.18.0",
  "skills": [{ "id": "...", "name": "...", "description": "..." }]
  // ...
}
```

### Agent Initialization (NEW — no legacy equivalent)

| V1 Endpoint | Method | Purpose |
|---|---|---|
| `/v1/workspaces/{id}/agent/init` | `POST` | Initialize agent (loads skills, context files, LSP) |
| `/v1/workspaces/{id}/agent` | `GET` | Get agent info (is_busy, is_ready, model) |

**Request body** (`POST .../agent/init`):
```jsonc
{
  "interactive": true   // optional, defaults to false
}
```

**Response** (`GET .../agent`):
```jsonc
{
  "is_busy": false,
  "is_ready": true,
  "model": { "id": "claude-opus-4-6", "name": "Claude Opus 4" },
  "model_cfg": { /* selected model config */ }
}
```

### Session Management

| Legacy | V1 | Method | Notes |
|---|---|---|---|
| `POST /session` | `POST /v1/workspaces/{wid}/sessions` | `POST` | Body: `{ "title": "..." }` |
| `GET /session?directory=...` | `GET /v1/workspaces/{wid}/sessions` | `GET` | No `directory` param needed |
| `GET /session/{id}` | `GET /v1/workspaces/{wid}/sessions/{sid}` | `GET` | |
| `DELETE /session/{id}` | `DELETE /v1/workspaces/{wid}/sessions/{sid}` | `DELETE` | |
| — | `PUT /v1/workspaces/{wid}/sessions/{sid}` | `PUT` | Update session (e.g. title) |

**V1 Session shape** (response):
```jsonc
{
  "id": "session-id",
  "parent_session_id": "",
  "title": "...",
  "message_count": 12,
  "prompt_tokens": 5000,
  "completion_tokens": 3000,
  "cost": 0.15,
  "todos": [
    { "content": "task description", "status": "completed", "active_form": "" }
  ],
  "created_at": 1721600000,       // unix timestamp (seconds)
  "updated_at": 1721600100,
  "is_busy": false,               // computed on read
  "attached_clients": 1           // how many clients viewing this session
}
```

### Sending Messages (CRITICAL CHANGE)

| Legacy | V1 |
|---|---|
| `POST /session/{id}/prompt_async` | `POST /v1/workspaces/{wid}/agent` |
| Body: `{ parts: [{ type: "text", text: "..." }], agent: "..." }` | Body: `{ session_id, prompt, attachments? }` |
| Returns: `204 No Content` | Returns: `202 Accepted` |

**V1 Request body** (`AgentMessage`):
```jsonc
{
  "session_id": "session-id",          // required
  "run_id": "uuid-v4",                 // optional, echoed in RunComplete SSE event
  "prompt": "user message text",       // plain string, not parts array
  "attachments": [                     // optional
    {
      "file_path": "/path/to/file",
      "file_name": "file.txt",
      "mime_type": "text/plain",
      "content": "base64-encoded-bytes"
    }
  ]
}
```

Key differences:
- **`prompt` is a plain string**, not a `parts` array — the V1 API wraps it internally
- **`session_id` is in the body**, not the URL path
- **`run_id`** enables correlating the request with its `RunComplete` SSE event (important for concurrent sessions)
- **No `agent` field** — the agent is configured at workspace level, not per-message

### Canceling Generation

| Legacy | V1 |
|---|---|
| `POST /session/{id}/abort` | `POST /v1/workspaces/{wid}/agent/sessions/{sid}/cancel` |

### Getting Messages

| Legacy | V1 |
|---|---|
| `GET /session/{id}/message` | `GET /v1/workspaces/{wid}/sessions/{sid}/messages` |

**V1 Message shape**:
```jsonc
{
  "id": "msg-id",
  "role": "assistant",                  // "user" | "assistant" | "system" | "tool"
  "session_id": "session-id",
  "model": "claude-opus-4-6",
  "provider": "anthropic",
  "created_at": 1721600000,
  "updated_at": 1721600005,
  "parts": [
    { "type": "reasoning", "data": { "thinking": "...", "started_at": 0, "finished_at": 0 } },
    { "type": "text", "data": { "text": "response content" } },
    { "type": "tool_call", "data": { "id": "tc-1", "name": "view", "input": "{...}", "finished": true } },
    { "type": "tool_result", "data": { "tool_call_id": "tc-1", "name": "view", "content": "...", "is_error": false } },
    { "type": "finish", "data": { "reason": "end_turn", "time": 1721600005 } }
  ]
}
```

Parts are wrapped as `{ "type": "<type>", "data": { ... } }` — different from the legacy flat format.

### Todos

| Legacy | V1 |
|---|---|
| `GET /session/{id}/todo` | Included in `Session` object as `todos` field |
| Separate endpoint | No separate endpoint needed |

### Session Status / Busy

| Legacy | V1 |
|---|---|
| `GET /session/status` → `{ "session-id": { "type": "idle" } }` | `GET /v1/workspaces/{wid}/agent/sessions/{sid}` → `{ "is_busy": true }` |
| Also: per-session in `Session.is_busy` | Also: `GET /v1/workspaces/{wid}/agent` → `{ "is_busy": true }` |

### SSE Events

| Legacy | V1 |
|---|---|
| `GET /event?directory=...` | `GET /v1/workspaces/{wid}/events?client_id=UUID` |
| Global stream, filter by sessionID client-side | Workspace-scoped, `client_id` required |

The `client_id` query parameter is **required** (must be a valid UUID). The server uses it to track attached clients and manage workspace lifecycle (workspace is torn down when last client disconnects).

**V1 SSE event types** (partial list):
- Message created/updated (includes full `Message` with parts)
- Session created/updated/deleted
- `RunComplete` — authoritative end-of-run signal
- Permission request / resolution
- Question request / resolution
- Agent info changed
- Config changed
- LSP events
- Skill state changes

### Agents

| Legacy | V1 |
|---|---|
| `GET /agent` | `GET /v1/workspaces/{wid}/agent` |
| Returns list of agents | Returns current agent info (is_busy, model, etc.) |

Note: V1 does not have a "list agents" endpoint in the same way. The agent is configured at workspace/config level.

### Permissions (NEW)

| V1 Endpoint | Method | Purpose |
|---|---|---|
| `/v1/workspaces/{wid}/permissions/grant` | `POST` | Grant/deny a permission request |
| `/v1/workspaces/{wid}/permissions/skip` | `GET/POST` | Get/set YOLO mode |

**Grant request**:
```jsonc
{
  "permission": { /* permission request from SSE event */ },
  "action": "allow"   // "allow" | "allow_session" | "deny"
}
```

### Skills (NEW)

| V1 Endpoint | Method | Purpose |
|---|---|---|
| `/v1/workspaces/{wid}/skills` | `GET` | List available skills |
| `/v1/workspaces/{wid}/skills/read` | `POST` | Read a skill's content |

---

## Migration Steps

### Phase 1: Workspace Lifecycle

1. **Generate a stable `client_id`** (UUID v4) per Fourth Spark server instance. Store in memory or config.
2. **On server startup**, call `POST /v1/workspaces` with `{ path: WORKSPACE_DIR, client_id }` to create or join a workspace. Cache the returned `workspace_id`.
3. **Initialize the agent** with `POST /v1/workspaces/{wid}/agent/init`.
4. **Replace `opencode.subscribeEvents`** to call `GET /v1/workspaces/{wid}/events?client_id=UUID`.

### Phase 2: Session & Message API

5. **Replace session CRUD** calls to use `/v1/workspaces/{wid}/sessions/*` paths.
6. **Replace `opencode.prompt`** to call `POST /v1/workspaces/{wid}/agent` with `AgentMessage` body.
7. **Replace message fetching** to use `/v1/workspaces/{wid}/sessions/{sid}/messages`.
8. **Remove legacy `opencode.getTodos`** — todos are now in the `Session` object.
9. **Replace `opencode.abort`** with `POST /v1/workspaces/{wid}/agent/sessions/{sid}/cancel`.
10. **Replace status checks** with `GET /v1/workspaces/{wid}/agent` or session's `is_busy` field.

### Phase 3: Frontend Adaptation

11. **Update `MessagePart` types** — V1 uses `{ type, data }` wrapper; add normalization in `message-parts.ts`.
12. **Handle `RunComplete` SSE event** for reliable completion detection.
13. **Handle permission SSE events** — show permission dialog, call grant endpoint.
14. **Handle question SSE events** — show question dialog, call answer endpoint.

### Phase 4: Cleanup

15. Remove legacy endpoint references from `opencode.ts`.
16. Remove the `directory` query parameter from all calls (workspace handles this).
17. Update frontend agent store — agent info is per-workspace, not a list.

---

## Key Differences Summary

| Aspect | Legacy API | V1 Workspace API |
|---|---|---|
| Namespace | `/session/*` | `/v1/workspaces/{wid}/*` |
| Prompt format | `{ parts: [{ type, text }], agent }` | `{ session_id, prompt, attachments? }` |
| Agent selection | Per-message `agent` field | Per-workspace config |
| SSE scope | Global, client filters by sessionID | Per-workspace, server-managed |
| Client tracking | None | `client_id` UUID required |
| Workspace init | None | Explicit create + agent init |
| Todos | Separate endpoint | Embedded in Session |
| Message parts | Flat fields | Typed `{ type, data }` wrappers |
| Permissions | Auto-approved or N/A | SSE event + grant endpoint |
| Skills | Not exposed | List + read endpoints |
| Run correlation | None | `run_id` → `RunComplete` event |

---

## Source References

All type definitions derived from [charmbracelet/crush](https://github.com/charmbracelet/crush) (the continuation of opencode-ai/opencode):

- Server routes: `internal/server/server.go`
- Request/response handlers: `internal/server/proto.go`
- Proto types: `internal/proto/proto.go`
- Session types: `internal/proto/session.go`
- Message types: `internal/proto/message.go`
- API docs: https://opencode.ai/docs/server/
