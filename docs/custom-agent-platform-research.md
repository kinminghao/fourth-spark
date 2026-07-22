# Fourth Spark — Research & Architecture Document

> **Project:** Fourth Spark — AI Agent Platform
> **Date:** 2026-07-21
> **Context:** Based on a deep-dive discussion analyzing oh-my-openagent (omo) internals, OpenCode Server API capabilities, and architecture options for building a custom multi-tenant AI agent platform.

---

## Table of Contents

1. [Project Overview: oh-my-openagent](#1-project-overview)
2. [Core Runtime Mechanism](#2-core-runtime-mechanism)
3. [Runtime Components Breakdown](#3-runtime-components-breakdown)
4. [Requirements](#4-requirements)
5. [Architecture Options Analysis](#5-architecture-options-analysis)
6. [OpenCode Server API Assessment](#6-opencode-server-api-assessment)
7. [Recommended Architecture](#7-recommended-architecture)
8. [Phased Implementation Plan](#8-phased-implementation-plan)
9. [Key Decisions & Open Questions](#9-key-decisions--open-questions)

---

## 1. Project Overview

oh-my-openagent (omo) is an OpenCode plugin that transforms OpenCode from a basic AI coding tool into a multi-agent orchestration platform.

### Two Editions, One Product

| Edition | Package | Description |
|---------|---------|-------------|
| **Ultimate** | `oh-my-opencode` / `oh-my-openagent` | Full plugin for OpenCode (`packages/omo-opencode/`) |
| **Light** | `lazycodex-ai` | Portable components for OpenAI Codex CLI (`packages/omo-codex/`) |

### Core Capabilities

- **11 Agents** — Sisyphus (orchestrator), Hephaestus (deep worker), Prometheus (planner), Oracle (consultant), Explorer, Librarian, etc.
- **54-62 Lifecycle Hooks** — intercept and enhance every stage of OpenCode
- **12-35 Tools** — base 12 always-on, up to 35 with config-gated features
- **3-Tier MCP System** — built-in MCP, Claude Code `.mcp.json`, skill-embedded MCP (with OAuth 2.0)
- **Team Mode** — parallel multi-agent coordination (off by default)
- **IntentGate** — automatic keyword detection (ultrawork/search/analyze/team)
- **Hashline Edit** — content-hash verified edits, zero stale-line errors
- **19 Core Packages** — harness-neutral pure TypeScript packages

### Monorepo Structure (39 packages)

```
oh-my-opencode/
├── packages/
│   ├── omo-opencode/        # OpenCode plugin adapter (main)
│   ├── omo-codex/           # Codex CLI Light edition
│   ├── omo-senpi/           # Senpi adapter
│   ├── shared-skills/       # Cross-harness Skill bundle
│   ├── web/                 # Marketing site (Next.js 15 + Cloudflare Workers)
│   ├── 19 Core packages     # Pure TS core logic (harness-neutral)
│   ├── 3 MCP packages       # LSP/Git Bash MCP servers
│   └── 12 platform binaries # Per-OS compiled artifacts
├── bin/                     # CLI entry (5 aliases → same program)
├── script/                  # Build/publish automation
└── docs/                    # User-facing docs
```

---

## 2. Core Runtime Mechanism

### omo is a Strategy Layer, not an Execution Layer

omo does **not** run independently. It parasitically extends OpenCode by intercepting every lifecycle event and injecting behavior. It is middleware for an AI agent.

```
OpenCode starts → loads omo plugin → omo returns 14 Hook handlers
→ Every time OpenCode sends a message / calls a tool / creates a session / errors
→ omo's Hooks fire first, injecting agent logic, tools, rules, prompt rewrites, fallback recovery...
```

### What omo owns vs. what OpenCode owns

**OpenCode provides:**
- Session management (create/store/recover/compact)
- LLM API calls (provider routing, streaming, retry)
- Tool execution loop (LLM decides tool → execute → return result)
- Agent definitions & switching
- MCP protocol base implementation
- TUI rendering
- Message persistence (SQLite)

**omo provides:**
- 14 Hook handlers (intercept every OpenCode event)
- 54-62 micro-hooks (behavior injection)
- 12-35 tool definitions (execution dispatched by OpenCode)
- 11 Agent prompt + configuration
- Multi-agent orchestration logic (BackgroundManager / task())
- 19 Core pure-TS packages (harness-neutral)
- Skill / MCP / Rules system

### Initialization Pipeline (20 steps)

```
serverPlugin() called by OpenCode
  ├── installAgentSortShim()          # Force agent ordering
  ├── initConfigContext()             # Detect config layout
  ├── detectDuplicateOmoPlugin()      # Prevent double-loading
  ├── injectServerAuthIntoClient()    # Inject auth
  ├── loadPluginConfig()              # JSONC parse → multi-level merge → Zod validate → migrate
  ├── initI18n()                      # Internationalization
  ├── initializeOpenClaw()            # External notifications (Discord/Telegram)
  ├── checkTeamModeDependencies()     # Team Mode dependency check
  ├── createManagers()                # 7 managers
  ├── createTools()                   # Tool registry (12-35 tools)
  ├── createHooks()                   # 5-tier hook composition (54-62 hooks)
  ├── createPluginInterface()         # 14 OpenCode hook handlers
  └── createPluginDispose()           # Cleanup logic
```

### Data Flow

```
User input "ultrawork refactor auth module"
    │
    ▼
┌── chat.message ───┐
│  IntentGate detects │
│  "ultrawork" keyword │
│  → inject ultrawork  │
│    mode prompt       │
└────────┬────────────┘
         ▼
┌─ messages.transform ─┐
│  Inject AGENTS.md     │
│  Inject .omo/rules/*  │
│  Inject team status   │
└────────┬────────────┘
         ▼
┌──── chat.params ─────┐
│  Select model + effort│
│  Apply model fallback │
└────────┬────────────┘
         ▼
   OpenCode calls LLM
         │
   LLM decides to call tool
         ▼
┌─ tool.execute.before ┐
│  Hashline validation  │
│  Write-file guard     │
│  Rules injection      │
└────────┬────────────┘
         ▼
   Tool executes (Edit/Read/...)
         ▼
┌─ tool.execute.after ──┐
│  comment-checker      │
│  Output truncation    │
│  Hashline read enhance│
└────────┬────────────┘
         ▼
   Continue conversation loop...
         │
   Session idle/complete
         ▼
┌───── event ──────────┐
│  Todos incomplete?    │
│  → auto-continue      │
│  Error?               │
│  → runtime fallback   │
└──────────────────────┘
```

---

## 3. Runtime Components Breakdown

### 3.1 Managers (7)

| Manager | Purpose |
|---------|---------|
| **BackgroundManager** | Background agent scheduler. Manages subagent lifecycle — create, queue (FIFO per provider/model, 5 concurrent), notify parent, destroy |
| **TmuxSessionManager** | Tmux window management. Tracks each subagent session's tmux pane |
| **SkillMcpManager** | Tier-3 MCP client manager. Isolated by `${sessionID}:${skillName}:${serverName}` |
| **ConfigHandler** | 6-phase config pipeline for OpenCode's `config` hook |
| **ModelFallbackControllerAccessor** | Per-agent fallback chain state tracker |
| **TuiStateMirror** *(optional)* | TUI sidebar state sync |
| **MonitorManager** *(optional)* | Background monitoring (when `monitor.enabled`) |

### 3.2 Tools (12-35)

#### Always-on (12 core tools)

| Tool | Function |
|------|----------|
| `grep` | Regex search file contents |
| `glob` | File name pattern matching |
| `session_list` | List historical sessions |
| `session_read` | Read session messages |
| `session_search` | Full-text search session content |
| `session_info` | Session metadata statistics |
| `background_output` | Get background task output |
| `background_cancel` | Cancel background tasks |
| `call_omo_agent` | Directly invoke a specific agent |
| `task` | **Core delegation tool** — category + skills → auto model selection → launch subagent |
| `skill` | Load SKILL.md instructions |
| `skill_mcp` | Invoke skill-embedded MCP servers |

#### Conditional tools (by config)

| Tool | Gate | Count |
|------|------|-------|
| `look_at` | multimodal-looker agent not disabled | +1 |
| `interactive_bash` | `tmux` binary on PATH | +1 |
| `edit` (hashline) | `hashline_edit: true` | +1 |
| `monitor_start/stop/list/output` | `monitor.enabled: true` | +4 |
| `task_create/get/list/update` | `experimental.task_system: true` | +4 |
| `team_create/delete/...` (12 tools) | `team_mode.enabled: true` | +12 |

> Note: 6 `lsp_*` tools are served by the built-in `lsp` MCP, not in the ToolRegistry.

### 3.3 Hooks (54-62, 5-tier pyramid)

All hooks follow `isHookEnabled(name) → safeHook(name, factory)` pattern — individually disableable via `disabled_hooks` config.

#### Tier 1: Session Hooks (24)

| Hook | Function |
|------|----------|
| `preemptiveCompaction` | Proactively trigger compaction before context overflow |
| `sessionNotification` | Desktop notification on session complete/error |
| `thinkMode` | Control extended thinking mode |
| `modelFallback` | **Proactive fallback** — switch model by per-agent fallback chain in `chat.params` |
| `anthropicContextWindowLimitRecovery` | Auto-recover from Anthropic context limit |
| `autoUpdateChecker` | Check omo version on startup |
| `codegraphBootstrap` | Bootstrap CodeGraph index on first session |
| `astGrepSgProvision` | Ensure `sg` (ast-grep) binary available |
| `agentUsageReminder` | Remind user which agent to use |
| `nonInteractiveEnv` | Adapt behavior for CI environments |
| `interactiveBashSession` | Tmux interactive bash session management |
| `ralphLoop` | **Ralph Loop** — self-referential loop until 100% complete |
| `editErrorRecovery` | Auto-recover from Edit tool failures |
| `delegateTaskRetry` | Auto-retry on `task()` delegation failure |
| `startWork` | `/start-work` command hook support |
| `prometheusMdOnly` | **Force Prometheus to only edit .md files** |
| `sisyphusJuniorNotepad` | Sisyphus-Junior notepad functionality |
| `noSisyphusGpt` | Prevent Sisyphus from using GPT models |
| `noHephaestusNonGpt` | Prevent Hephaestus from using non-GPT models |
| `hephaestusAgentsMdInjector` | Inject AGENTS.md context for Hephaestus |
| `questionLabelTruncator` | Truncate overly long Question tool labels |
| `taskResumeInfo` | Provide task resume context |
| `runtimeFallback` | **Reactive fallback** — auto-switch model after session error |
| `legacyPluginToast` | Legacy plugin name warning toast |

#### Tier 2: ToolGuard Hooks (18)

| Hook | Function |
|------|----------|
| `commentChecker` | **AI slop detector** — block AI-pattern comments |
| `toolOutputTruncator` | Smart truncation of oversized tool output |
| `directoryAgentsInjector` | Auto-inject same-directory AGENTS.md on file read |
| `directoryReadmeInjector` | Auto-inject README.md on directory read |
| `emptyTaskResponseDetector` | Detect empty subagent responses |
| `rulesInjector` | **Rules injection** — auto-load `.omo/rules/*.md` etc. |
| `tasksTodowriteDisabler` | Conditionally disable todowrite for subagents |
| `writeExistingFileGuard` | **Must Read before Write** — block Write without prior Read |
| `bashFileReadGuard` | Block bash cat/head/tail (should use Read tool) |
| `hashlineReadEnhancer` | Add `LINE#ID` hash tags to Read output |
| `jsonErrorRecovery` | Auto-fix malformed JSON tool output |
| `readImageResizer` | Auto-resize large images on Read |
| `todoDescriptionOverride` | Override todowrite description with stricter format |
| `webfetchRedirectGuard` | WebFetch redirect protection |
| `fsyncSkipWarning` | fsync skip warning |
| `teamToolGating` | Block `team_*` tools when Team Mode disabled |
| `notepadWriteGuard` | Notepad write safety guard |
| `planFormatValidator` | Plan agent output format validation |

#### Tier 3: Transform Hooks (7)

| Hook | Function |
|------|----------|
| `claudeCodeHooks` | Execute Claude Code compatibility layer hooks |
| `keywordDetector` | **IntentGate** — detect ultrawork/search/analyze/team keywords |
| `contextInjectorMessagesTransform` | Inject all collected context (AGENTS.md, rules, README) into message stream |
| `teamModeStatusInjector` | *(team_mode)* Inject current team status |
| `teamMailboxInjector` | *(team_mode)* Inject unread team mailbox messages |
| `toolPairValidator` | Validate tool call pairing (Read→Write) |
| `monitorStatusInjector` | *(monitor)* Inject background monitor status |

#### Tier 4: Continuation Hooks (7)

| Hook | Function |
|------|----------|
| `stopContinuationGuard` | `/stop-continuation` command implementation |
| `compactionContextInjector` | Inject critical info during context compaction |
| `compactionTodoPreserver` | Preserve todo list state during compaction |
| `todoContinuationEnforcer` | **Todo forced continuation** — force agent to continue if todos incomplete |
| `unstableAgentBabysitter` | Detect agent crash/spin patterns, trigger protection |
| `backgroundNotificationHook` | Notify parent session on background task completion |
| `atlasHook` | Atlas agent special behavior (auto git commit etc.) |

#### Tier 5: Skill Hooks (2)

| Hook | Function |
|------|----------|
| `categorySkillReminder` | Remind available skills during task delegation |
| `autoSlashCommand` | Auto-recognize and route slash commands |

#### Count Summary

| Config | Session | ToolGuard | Transform | Continuation | Skill | Total |
|--------|---------|-----------|-----------|--------------|-------|-------|
| **Default** | 24 | 17 | 4 | 7 | 2 | **54** |
| **+team_mode** | 24 | 18 | 7 | 7 | 2 | **58** |
| **+team event handlers** | — | — | — | — | — | **+4 = 62** |

### 3.4 The 14 OpenCode Hook Handlers

The sole interface between omo and OpenCode. The 54-62 micro-hooks are dispatched within these 14 handlers:

| # | Hook | Purpose |
|---|------|---------|
| 1 | `config` | 6-phase config pipeline: provider → components → agents → tools → MCPs → commands |
| 2 | `tool` | Register 12-35 tools into OpenCode |
| 3 | `tool.definition` | Per-tool definition transform (todoDescriptionOverride) |
| 4 | `chat.message` | First-message variant, session setup, keyword detection |
| 5 | `chat.params` | API call params: effort level, think mode, model fallback |
| 6 | `chat.headers` | HTTP header injection (Copilot `x-initiator`) |
| 7 | `command.execute.before` | Pre-command guards, slash command routing |
| 8 | `event` | Session lifecycle (created/deleted/idle/error), OpenClaw dispatch, runtime fallback, todo continuation |
| 9 | `tool.execute.before` | Pre-tool guards: write guard, Prometheus md-only, rules injection, hashline... |
| 10 | `tool.execute.after` | Post-tool: comment-checker, truncation, hashline read enhance, JSON recovery... |
| 11 | `experimental.chat.messages.transform` | Context injection, keyword detection, tool-pair validation |
| 12 | `experimental.chat.system.transform` | System-level ultrawork prompt injection |
| 13 | `experimental.session.compacting` | Preserve context + todos during compaction |
| 14 | `experimental.compaction.autocontinue` | Auto-resume if todos incomplete after compaction |

---

## 4. Requirements

### Functional Requirements

1. **Multi-platform UI** — A friendly UI that supports phone, desktop, and other platforms simultaneously, with customizable display formats
2. **Session Management** — Create sessions on demand for custom application scenarios; all sessions persistently stored and searchable, never lost
3. **Custom Agents** — Extend agent system with custom agents based on business scenarios, building on top of existing agent architecture
4. **Custom Injection** — Freely inject custom MCP servers, skills, and agent definitions
5. **K8s Pod Isolation** — Each trigger launches an isolated K8s pod running a single agent; all I/O stored separately
6. **Business Layer** — Wrap custom business logic on top of the platform
7. **Multi-tenant / Multi-account** — Manage multiple provider accounts, multi-tenant isolation

### Non-functional Requirements (implied)

- Real-time streaming of agent execution
- Persistent storage beyond pod lifecycle
- Horizontal scalability
- Provider key isolation per tenant

---

## 5. Architecture Options Analysis

### Option A: Fork OpenCode + Keep omo Plugin

```
Custom Chat UI ← Modified OpenCode TUI/interaction layer
     │
     ▼
OpenCode Core (Go) ← Keep as-is
     │
     ▼
omo plugin ← Keep as-is
```

| Pros | Cons |
|------|------|
| Minimal changes, all omo features work | OpenCode is Go, changing TUI requires Go skills |
| Battle-tested code | Tied to OpenCode's architecture decisions |
| | Not designed for multi-tenant/K8s |

**Verdict:** Only suitable for UI skin replacement, insufficient for platform requirements.

### Option B: OpenCode Server as Black-box Executor

```
Custom Platform (API Gateway + Frontend)
     │  HTTP API + SSE
     ▼
OpenCode Server (opencode serve) + omo plugin
     (running inside K8s Pod)
```

| Pros | Cons |
|------|------|
| Zero changes to OpenCode/omo | Heavy container image (~500MB+) |
| 100% omo capability (all 54 hooks, 35 tools, 11 agents) | OpenCode is black box, debugging requires Go source |
| API is comprehensive (16 categories, see Section 6) | Dependent on OpenCode release cycle |
| Single-user limitation becomes advantage in Pod isolation | Session data in local SQLite (needs archival before pod destruction) |

**Verdict:** Viable for Phase 1. Best effort-to-value ratio.

### Option C: Custom Executor Engine + omo Core Packages

```
Custom Platform
     │
     ▼
Custom Agent Runtime (TypeScript)
  ├── Vercel AI SDK (LLM calls)
  ├── Custom tool execution loop
  ├── omo Core packages (strategy layer)
  └── Direct event reporting → MQ
```

| Pros | Cons |
|------|------|
| Full control, maximum extensibility | Large development effort (6-8 weeks minimum) |
| Lightweight containers (~150MB) | Only ~30-40% of omo capability reusable |
| Self-directed upgrade path | Must re-learn all the lessons encoded in omo's 54 hooks |
| No external dependency | |

**Verdict:** Maximum long-term potential but high upfront cost. Better as Phase 3 evolution.

### Recommendation: B → C Progressive Migration

Start with Option B to validate product logic quickly. Identify ceilings through real usage. Progressively replace modules that hit limitations with custom implementations using omo Core packages.

---

## 6. OpenCode Server API Assessment

### API Surface (from SDK source `@opencode-ai/sdk` v2)

OpenCode `serve` exposes a **comprehensive 16-category REST + SSE API**, fully typed via OpenAPI-generated TypeScript SDK.

#### Complete API Inventory

| Category | Key Endpoints | Platform Usefulness |
|----------|--------------|---------------------|
| **Session CRUD** | `create / get / update / delete / list / fork / abort / status / children` | Multi-turn conversation, session resume, history view |
| **Messages** | `prompt` (streaming) / `promptAsync` / `messages` / `revert` | Multi-turn interaction, streaming output |
| **SSE Events** | `event.subscribe` — pushes `message.updated`, `tool.execute`, `session.idle`, `todo.updated`, `file.edited` | Real-time agent execution display |
| **Agent Management** | `app.agents()` / `prompt({agent})` | Agent selection/switching |
| **Tool Management** | `tool.list(provider, model)` / `tool.ids()` / `prompt({tools})` | Tool availability control |
| **MCP Management** | `mcp.status / add / connect / disconnect` + OAuth | Runtime MCP addition |
| **Config** | `config.get / update / providers` | Runtime config modification |
| **Auth/Provider** | `provider.list / auth.set / auth.remove / oauth.*` | Multi-account provider key management |
| **File Operations** | `file.list / read / status` | Workspace inspection |
| **VCS** | `vcs.diff / apply` | See agent changes |
| **Permission/Question** | `permission.list / reply` / `question.list / reply / reject` | Interactive confirmation |
| **PTY** | `pty.create / connect` (WebSocket) | Remote terminal |
| **Workspace** | `workspace.create / list / remove / warp` | Isolated workspaces |
| **Todo** | `session.todo` | Task progress tracking |
| **Project** | `project.list / current / update` | Multi-project |
| **TUI Control** | `tui.appendPrompt / submitPrompt / executeCommand` | Not needed (TUI-specific) |

#### Requirements Fit Assessment

| Requirement | API Support | Gap |
|-------------|-------------|-----|
| Multi-turn interaction | `session.prompt()` multiple calls with same sessionID | None |
| Streaming output | SSE `event.subscribe` | None |
| Session history & search | `session.list / messages` | Pod destruction loses SQLite → need archival sidecar |
| Agent selection | `prompt({agent})` / `app.agents()` | None |
| Custom agent definition | Config-file pre-defined, API-selectable | Cannot create agents at runtime via API — use Init Container injection |
| MCP management | `mcp.add / connect` at runtime | None |
| Skill injection | Filesystem SKILL.md, not API | Need Volume/ConfigMap injection |
| Tool control | `prompt({tools})` enable/disable | None |
| Permission confirmation | `permission.reply` | None |
| Provider management | `auth.set / remove` | None |
| Workspace isolation | `workspace.create` | None |
| Todo tracking | `session.todo` | None |
| PTY terminal | WebSocket PTY | None |

#### Key Gaps (3 total)

1. **Agent/Skill cannot be created at runtime via API** — only config-file pre-defined → Solve with Init Container injection
2. **Session data in local SQLite** — lost on Pod destruction → Solve with Sidecar archival
3. **No multi-tenant concept** — Pod-level isolation solves this

#### `opencode run` vs `opencode serve`

| Capability | `opencode run` | `opencode serve` |
|------------|----------------|-------------------|
| Use case | One-shot task execution | Interactive multi-turn sessions |
| Output | `--json` → `{ sessionId, success, durationMs, messageCount, summary }` | Full REST API + SSE |
| Multi-turn | `--session-id` for resume only | `session.prompt()` on same ID |
| Agent selection | `--agent` flag | API parameter |
| MCP control | No | Yes (`mcp.add/connect`) |
| Tool control | No | Yes (`prompt({tools})`) |
| Permission handling | No | Yes (`permission.reply`) |
| Streaming | stdout event stream | SSE |

**Conclusion:** Interactive scenarios require `serve` mode. `run` is only for fire-and-forget single tasks.

---

## 7. Recommended Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        Frontend Layer                        │
│                                                              │
│  ┌─────────┐  ┌─────────┐  ┌──────────┐  ┌──────────────┐  │
│  │ Web App │  │ Mobile  │  │ Desktop  │  │ API / SDK    │  │
│  │ (React) │  │  (RN)   │  │(Electron)│  │ (REST/WS)    │  │
│  └────┬────┘  └────┬────┘  └────┬─────┘  └──────┬───────┘  │
│       └────────────┴────────────┴────────────────┘          │
│                            │                                 │
│                       WebSocket + REST                       │
└────────────────────────────┬─────────────────────────────────┘
                             │
┌────────────────────────────┴─────────────────────────────────┐
│                      API Gateway Layer                        │
│                                                              │
│  Auth (JWT/OAuth) → Rate Limit → Tenant Router → API Server │
│                                                              │
│  Core API:                                                   │
│    POST /sessions          — Create session                  │
│    POST /sessions/:id/run  — Send message / execute          │
│    GET  /sessions/:id/stream — SSE real-time event stream    │
│    GET  /sessions          — List/search session history     │
│    CRUD /agents            — Agent definition management     │
│    CRUD /skills            — Skill definition management     │
│    CRUD /mcps              — MCP config management           │
│    CRUD /accounts          — Multi-account (provider keys)   │
│    CRUD /tenants           — Multi-tenant management         │
└────────────────────────────┬─────────────────────────────────┘
                             │
┌────────────────────────────┴─────────────────────────────────┐
│                   Orchestration Layer                         │
│                                                              │
│  ┌─────────────────┐    ┌────────────────────────────┐       │
│  │ Session Manager │    │   Agent Scheduler (K8s)    │       │
│  │                 │    │                            │       │
│  │ • Create/resume │    │  Receive execution request │       │
│  │ • Persist (PG)  │◄──►│  Select agent template     │       │
│  │ • Tenant isolate│    │  Create K8s Job/Pod        │       │
│  │ • History index │    │  Inject MCP/Skill/Rules    │       │
│  │                 │    │  Mount workspace volume    │       │
│  └─────────────────┘    │  Monitor execution status  │       │
│                         │  Collect output            │       │
│  ┌──────────────────┐   │  Destroy Pod               │       │
│  │  Message Queue   │   └─────────────┬──────────────┘       │
│  │  (Redis/NATS)    │                 │                      │
│  │  • Agent comms   │◄────────────────┘                      │
│  │  • Parent↔child  │                                        │
│  │  • Real-time →WS │                                        │
│  └──────────────────┘                                        │
└──────────────────────────────────────────────────────────────┘
                             │
┌────────────────────────────┴─────────────────────────────────┐
│              Agent Execution Layer (K8s Pod)                  │
│                                                              │
│  ┌────────────────────────────────────────────────────┐      │
│  │  Init Container                                    │      │
│  │  • Pull agent config from API                      │      │
│  │  • Write .opencode/oh-my-openagent.jsonc            │      │
│  │  • Mount workspace code                            │      │
│  │  • Inject provider API keys                        │      │
│  └────────────────────────────────────────────────────┘      │
│                                                              │
│  ┌────────────────────────────────────────────────────┐      │
│  │  Main Container: opencode serve + omo plugin       │      │
│  │                                                    │      │
│  │  All 54+ hooks, 35 tools, 11 agents active         │      │
│  │  Single-user single-session = perfect Pod isolation │      │
│  └────────────────────────────────────────────────────┘      │
│                                                              │
│  ┌────────────────────────────────────────────────────┐      │
│  │  Sidecar Container                                 │      │
│  │  • Connect localhost:8080 SSE                      │      │
│  │  • Forward events → Message Queue                  │      │
│  │  • Before pod exit: extract SQLite → archive to PG │      │
│  └────────────────────────────────────────────────────┘      │
│                                                              │
│  Volumes:                                                    │
│  • /workspace  — code repository                             │
│  • /config     — agent/skill/rules definitions               │
│  • /data       — SQLite persistence                          │
└──────────────────────────────────────────────────────────────┘
                             │
┌────────────────────────────┴─────────────────────────────────┐
│                      Storage Layer                           │
│                                                              │
│  PostgreSQL          — sessions / messages / tenants / users │
│  Redis               — real-time state / MQ / cache          │
│  S3/MinIO            — agent output artifacts / workspace    │
│  (Optional) Vector DB — session semantic search              │
└──────────────────────────────────────────────────────────────┘
```

### omo Core Packages Reusable in Custom Engine (Phase 3)

If/when migrating from Option B to Option C, these 19 packages can be directly imported:

| Package | Usage |
|---------|-------|
| `model-core` | Model selection + provider routing + fallback chains |
| `prompts-core` | Agent prompt template management |
| `rules-engine` | Rule discovery + matching |
| `delegate-core` | Task delegation selection and retry |
| `skills-loader-core` | Skill loading + matching |
| `mcp-client-core` | MCP client + OAuth |
| `mcp-stdio-core` | MCP stdio communication |
| `lsp-core` | LSP engine |
| `boulder-state` | Work state tracking state machine |
| `team-core` | Team Mode registry/mailbox/tasklist primitives |
| `agents-md-core` | AGENTS.md discovery and injection |
| `comment-checker-core` | AI slop detection |
| `hashline-core` | Hashline edit primitives |
| `telemetry-core` | Telemetry |
| `utils` | General utilities |
| `tmux-core` | Tmux session/pane primitives |
| `claude-code-compat-core` | Claude Code compatibility loaders |
| `openclaw-core` | External notification gateway |
| `omo-config-core` | Harness-neutral omo.json schema |

All packages are **pure TypeScript, harness-neutral** (CI-enforced: no `@opencode-ai/*` imports), runnable on any TS/JS runtime (Bun/Node/Deno).

---

## 8. Phased Implementation Plan

### Phase 1: Validate with OpenCode Executor (Month 1-2)

**Goal:** Web UI + backend that creates sessions, sends messages, and displays agent execution in real-time.

**Build:**
- API Server (Node/Bun + Hono/Fastify)
- K8s Pod template (Dockerfile + Job spec) with OpenCode + omo
- Sidecar (collect/forward SSE events, archive SQLite)
- Session Manager (PostgreSQL persistence)
- Web UI (React + WebSocket for real-time display)
- Basic multi-tenant routing

**Deliverable:** Working prototype where you can create a session via web, watch an agent work, and review history.

### Phase 2: Identify Ceilings (Month 3-4)

**Goal:** After 2 months of real usage, identify:
- Where OpenCode's API is insufficient
- Where black-box debugging is too painful
- Which business scenarios need finer-grained control
- Which omo hooks you don't actually need

**These findings determine whether to proceed with Phase 3.**

### Phase 3: Selective Module Replacement (Month 5+)

**Goal:** Replace only the modules that hit ceilings.

Not a full migration, but module-by-module replacement:
- LLM calls not flexible enough? → Replace with Vercel AI SDK + `model-core`
- Tool execution needs customization? → Build custom Tool Executor + `rules-engine`
- Agent orchestration needs changes? → Build custom Hook Dispatcher + `delegate-core`
- OpenCode behavior can't be changed? → Replace that module with custom implementation

**Final state:** Hybrid — some scenarios use OpenCode executor (mature), some use custom engine (need fine control). Both coexist on the same platform.

### Phase 4: Multi-tenant + Multi-platform (Month 5-6, parallel with Phase 3)

- Tenant isolation (DB row-level / schema-level)
- Provider key management (per-tenant)
- Mobile app
- Usage metering/billing foundation

---

## 9. Key Decisions & Open Questions

### Decided

- [x] **Execution model:** Start with OpenCode Server as black-box executor in K8s Pod (Option B)
- [x] **API mode:** Use `opencode serve` (not `opencode run`) for interactive multi-turn scenarios
- [x] **Migration strategy:** Progressive B → C, driven by real usage ceilings
- [x] **Language:** TypeScript for platform backend (enables direct import of omo Core packages if needed)

### Open Questions

- [ ] **Container image strategy:** Base image size for OpenCode + omo + Bun? Optimization path?
- [ ] **Session archival format:** How to extract SQLite data from Pod before destruction? Direct SQLite copy vs API dump?
- [ ] **Agent config injection:** ConfigMap vs Secret vs API-driven Init Container?
- [ ] **Workspace management:** Git clone per Pod? Shared NFS? Object storage mount?
- [ ] **Cost model:** Pod startup time + LLM cost per session? Cold start optimization?
- [ ] **Provider key security:** How to inject tenant API keys into Pod without exposing to agent code?
- [ ] **Scaling limits:** Max concurrent Pods per cluster? Resource requests/limits per Pod?
- [ ] **Frontend framework:** React + Next.js? Or lighter SPA?
- [ ] **Phase 2 exit criteria:** What specific ceilings would trigger Phase 3 migration?
