import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { AlertTriangle, ArrowLeft, ArrowUp, Check, ChevronDown, Menu, PanelRight, Plus, RotateCcw, Square, X } from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import clsx from "clsx"
import { AttachButton, AttachmentStrip, useAttachments } from "./Attachments"
import { VoiceButton } from "./VoiceButton"
import { VoiceOverlay, VoiceStatusBar } from "./VoiceOverlay"
import { useVoiceInput } from "../hooks/use-voice-input"
import {
  EMPTY_MESSAGES,
  EMPTY_QUEUE,
  EMPTY_TODOS,
  useSessionStore,
} from "../stores/session-store"
import type { Message as ApiMessage, ModelInfo, Session } from "../lib/api-client"
import { listModels } from "../lib/api-client"
import { useRepoStore, selectActiveRepoName } from "../stores/repo-store"
import { useCustomAgentStore } from "../stores/custom-agent-store"
import { useIssueStore } from "../stores/issue-store"
import { orchestrator } from "../lib/session-orchestrator"
import { ExecutionBlock } from "./ExecutionBlock"
import { TodoProgressCompact } from "./TodoProgress"
import { InputBar } from "./InputBar"

const STATUS_META: Record<
  string,
  { glyph: string; label: string; color: string; spin: boolean }
> = {
  idle: { glyph: "●", label: "ready", color: "text-emerald-400", spin: false },
  busy: { glyph: "◌", label: "running", color: "text-amber-400", spin: true },
  retry: { glyph: "◌", label: "retrying", color: "text-amber-400", spin: true },
  error: { glyph: "✗", label: "error", color: "text-red-400", spin: false },
}

// Deterministic initial-letter avatar. Static class strings so Tailwind can pick them up.
const AGENT_AVATAR_PALETTE = [
  { bg: "bg-blue-500/15", text: "text-blue-500" },
  { bg: "bg-purple-500/15", text: "text-purple-500" },
  { bg: "bg-emerald-500/15", text: "text-emerald-500" },
  { bg: "bg-amber-500/15", text: "text-amber-500" },
  { bg: "bg-rose-500/15", text: "text-rose-500" },
  { bg: "bg-cyan-500/15", text: "text-cyan-500" },
  { bg: "bg-indigo-500/15", text: "text-indigo-500" },
  { bg: "bg-orange-500/15", text: "text-orange-500" },
] as const

function agentAvatar(name: string): { bg: string; text: string; initial: string } {
  const trimmed = name.trim()
  const code = trimmed.charCodeAt(0) || 0
  const palette = AGENT_AVATAR_PALETTE[code % AGENT_AVATAR_PALETTE.length]
  return { ...palette, initial: (trimmed.charAt(0) || "?").toUpperCase() }
}

function StatusBadge({ status, reason }: { status: string | undefined; reason?: string }) {
  const meta = STATUS_META[status ?? "idle"] ?? STATUS_META.idle
  return (
    <span
      className={clsx(
        "flex items-center gap-1.5 rounded border border-line px-2 py-0.5 font-mono text-xs",
        meta.color,
      )}
      title={status === "error" && reason ? reason : undefined}
    >
      <span className={clsx("leading-none", meta.spin && "fs-spin")}>
        {meta.glyph}
      </span>
      <span>{meta.label}</span>
    </span>
  )
}

const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  "claude-opus-4": 1_000_000,
  "claude-sonnet-4": 1_000_000,
  "claude-sonnet-5": 1_000_000,
  "claude-opus-5": 1_000_000,
  "claude-3-7-sonnet": 200_000,
  "claude-3-5-sonnet": 200_000,
  "claude-3-5-haiku": 200_000,
  "claude-3-opus": 200_000,
  "claude-3-sonnet": 200_000,
  "claude-3-haiku": 200_000,
}
const DEFAULT_CONTEXT_LIMIT = 1_000_000

function getContextLimit(modelID?: string): number {
  if (!modelID) return DEFAULT_CONTEXT_LIMIT
  for (const [prefix, limit] of Object.entries(MODEL_CONTEXT_LIMITS)) {
    if (modelID.startsWith(prefix)) return limit
  }
  return DEFAULT_CONTEXT_LIMIT
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function formatCost(cost: number): string {
  if (cost >= 1) return `$${cost.toFixed(2)}`
  if (cost >= 0.01) return `$${cost.toFixed(3)}`
  if (cost > 0) return `$${cost.toFixed(4)}`
  return "$0"
}

function getLastAssistantTokens(messages: readonly ApiMessage[]) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === "assistant" && m.tokens) {
      const t = m.tokens
      if (t.cache && (t.cache.read > 0 || t.cache.write > 0)) return t
      if (t.input > 0 || t.output > 0) return t
    }
  }
  return null
}

function ContextInfo({ session, messages }: { session: Session | null; messages: readonly ApiMessage[] }) {
  const lastTokens = getLastAssistantTokens(messages)
  const cost = session?.cost ?? 0
  if (!lastTokens && !cost) return null

  const contextLength = lastTokens
    ? lastTokens.input + (lastTokens.cache?.read ?? 0) + (lastTokens.cache?.write ?? 0)
    : 0
  const contextLimit = getContextLimit(session?.model?.modelID)
  const percentage = contextLength > 0 ? Math.min(Math.round((contextLength / contextLimit) * 100), 999) : 0

  const percentColor =
    percentage >= 80
      ? "text-red-400"
      : percentage >= 50
        ? "text-amber-400"
        : "text-fg-5"

  return (
    <div className="flex items-center gap-2 font-mono text-[11px] text-fg-5">
      {contextLength > 0 && (
        <>
          <span title={`当前上下文 = cache_read + cache_write + input (最近一次请求)`}>
            {formatTokens(contextLength)}
          </span>
          <span className="text-fg-6">·</span>
          <span className={percentColor} title={`上下文占比 (${formatTokens(contextLimit)} 窗口)`}>
            {percentage}%
          </span>
          <span className="text-fg-6">·</span>
        </>
      )}
      <span title="会话累计费用">{formatCost(cost)}</span>
    </div>
  )
}

const MAX_NEW_HEIGHT_PX = 144
const STICK_TO_BOTTOM_THRESHOLD_PX = 64

function NewSessionInput({ onToggleSidebar }: { onToggleSidebar?: () => void }) {
  const [draft, setDraft] = useState("")
  const [customAgentId, setCustomAgentId] = useState("")
  const [issueId, setIssueId] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [models, setModels] = useState<ModelInfo[]>([])
  const createSession = useSessionStore((state) => state.createSession)
  const sendError = useSessionStore((state) => state.sendError)
  const activeRepoId = useRepoStore((state) => state.activeRepoId)
  const customAgents = useCustomAgentStore((state) => state.agents)
  const visibleAgents = customAgents.filter((a) => a.isSystem < 2)
  const selectedIssueId = useIssueStore((state) => state.selectedIssueId)
  const linkedIssueLabel = useIssueStore((state) => {
    if (!issueId) return null
    const issue = state.issues.find((i) => i.id === issueId)
    return issue ? `#${issue.number} ${issue.title}` : null
  })
  const [searchParams, setSearchParams] = useSearchParams()

  useEffect(() => {
    if (visibleAgents.length > 0 && !customAgentId) {
      setCustomAgentId(visibleAgents[0].id)
    }
  }, [visibleAgents, customAgentId])

  useEffect(() => {
    if (!activeRepoId) { setModels([]); return }
    let cancelled = false
    void listModels(activeRepoId).then((m) => { if (!cancelled) setModels(m) }).catch(() => { if (!cancelled) setModels([]) })
    return () => { cancelled = true }
  }, [activeRepoId])

  const imagesAllowed = models.length === 0 || models.some((m) => m.supportsImage !== false)
  const { attachments, promptFiles, error: attachError, addFiles, onPaste, remove, clear } = useAttachments(imagesAllowed)

  useEffect(() => {
    if (selectedIssueId) {
      setIssueId(selectedIssueId)
      useIssueStore.getState().setSelectedIssue(null)
    }
  }, [selectedIssueId])

  useEffect(() => {
    const paramDraft = searchParams.get("draft")
    if (paramDraft) {
      setDraft(paramDraft)
      setSearchParams({}, { replace: true })
    }
  }, [searchParams, setSearchParams])

  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, MAX_NEW_HEIGHT_PX)}px`
  }, [draft])

  const selectedAgentDesc = visibleAgents.find((a) => a.id === customAgentId)?.description
  const hasContext = Boolean(issueId)

  const submit = () => {
    const text = draft.trim()
    if (!activeRepoId || (!text && !hasContext && attachments.length === 0)) return
    setDraft("")
    clear()
    void createSession(text, undefined, undefined, undefined, issueId || undefined, customAgentId || undefined, promptFiles.length > 0 ? promptFiles : undefined)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  const handleVoiceSubmit = useCallback(
    (text: string) => {
      void createSession(text, undefined, undefined, undefined, issueId || undefined, customAgentId || undefined)
    },
    [createSession, issueId, customAgentId],
  )

  const voice = useVoiceInput(handleVoiceSubmit)

  return (
    <div className="relative flex flex-1 flex-col items-center justify-center bg-term">
      <button
        type="button"
        onClick={onToggleSidebar}
        aria-label="Open sidebar"
        className="absolute left-3 top-3 rounded-lg p-2 text-fg-3 hover:bg-elevated md:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>

      <div className="w-full max-w-2xl px-6">
        <div className="mb-8 text-center">
          <div className="font-mono text-2xl text-fg-6">
            <span className="text-emerald-500/60">❯</span>
            <span className="fs-blink text-fg-4"> ▋</span>
          </div>
        </div>

        <AttachmentStrip attachments={attachments} error={attachError} onRemove={remove} />

        <div className={clsx(
          "relative rounded-xl border bg-base/80 shadow-sm transition-colors",
          "border-line focus-within:border-fg-5",
        )}>
          <VoiceOverlay
            phase={voice.stt.phase}
            transcript={voice.stt.transcript}
            interimTranscript={voice.stt.interimTranscript}
            editText={voice.editText}
            onEditTextChange={voice.setEditText}
            onTextareaKeyDown={voice.handleTextareaKeyDown}
            textareaRef={voice.textareaRef}
            wrapperClassName="absolute bottom-full left-0 right-0 z-20 mb-2 overflow-hidden rounded-xl border border-line bg-surface/95 backdrop-blur-sm"
          />

          {visibleAgents.length > 0 && (
            <>
              <div className="flex gap-1.5 overflow-x-auto px-4 pt-3 pb-1 scrollbar-none">
                {visibleAgents.map((a) => {
                  const avatar = agentAvatar(a.name)
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setCustomAgentId(a.id)}
                      className={clsx(
                        "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors",
                        customAgentId === a.id
                          ? "bg-blue-500/15 text-blue-400 ring-1 ring-inset ring-blue-500/30"
                          : "text-fg-4 hover:bg-elevated hover:text-fg-3",
                      )}
                    >
                      <span className={clsx(
                        "inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold",
                        avatar.bg,
                        avatar.text,
                      )}>
                        {avatar.initial}
                      </span>
                      {a.name}
                    </button>
                  )
                })}
              </div>
              {selectedAgentDesc && (
                <p className="px-4 pb-1 text-[11px] leading-relaxed text-fg-5">{selectedAgentDesc}</p>
              )}
            </>
          )}

          <div
            className="flex items-start gap-2 px-4 py-3"
          >
            <span className={clsx(
              "select-none pt-px font-mono text-sm leading-6",
              "text-emerald-400",
            )}>
              ❯
            </span>
            <textarea
              ref={textareaRef}
              rows={1}
              value={draft}
              autoFocus
              disabled={!activeRepoId}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={onPaste}
              placeholder={!activeRepoId ? "请先选择一个仓库" : issueId ? "输入补充指令，或直接发送" : "让 Agent 做什么？"}
              className="flex-1 resize-none bg-transparent font-mono text-sm leading-6 text-fg placeholder:text-fg-6 focus:outline-none disabled:cursor-not-allowed"
            />
            <AttachButton
              onFiles={(files) => void addFiles(files)}
              disabled={!activeRepoId}
              allowed
            />
            <VoiceButton
              isListening={voice.stt.isListening}
              disabled={!activeRepoId}
              onStart={voice.stt.start}
              onStop={() => void voice.stt.stop()}
            />
            <button
              type="button"
              onClick={submit}
              disabled={!activeRepoId || (!draft.trim() && !hasContext && attachments.length === 0)}
              aria-label="Start run"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-emerald-600 text-white transition-colors duration-150 hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-fg-6/30 disabled:text-fg-5"
            >
              <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
            </button>
          </div>

          {linkedIssueLabel && (
            <div className="flex items-center gap-2 border-t border-line/60 px-4 py-1.5">
              <span className="shrink-0 font-mono text-[11px] text-fg-5">关联</span>
              <span className="min-w-0 truncate rounded bg-blue-500/10 px-1.5 py-0.5 font-mono text-[11px] text-blue-400">
                {linkedIssueLabel}
              </span>
              <button
                type="button"
                onClick={() => setIssueId("")}
                className="shrink-0 text-fg-5 hover:text-fg-3"
                aria-label="取消关联"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>

        <VoiceStatusBar
          phase={voice.stt.phase}
          volumeLevel={voice.stt.volumeLevel}
          elapsed={voice.elapsed}
          editText={voice.editText}
          error={voice.stt.error}
          onCancel={voice.cancel}
          onConfirm={() => void voice.confirm()}
          idleHint="⌘⏎ / ctrl+⏎ 开始运行"
          className="mt-2 flex items-center justify-center gap-2"
        />

        {sendError && (
          <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-2 font-mono text-xs text-red-400">
            {sendError}
          </div>
        )}
      </div>
    </div>
  )
}


function IssueBody({ body }: { body?: string }) {
  if (!body) return <p className="py-10 text-center font-mono text-xs text-fg-5">该 Issue 没有描述内容</p>
  return (
    <div className="markdown-body leading-relaxed">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
    </div>
  )
}

function IssueHeader({ issue }: { issue: { number: number; title: string; state: string; labels?: Array<{ id: number; name: string; color: string }> } }) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className={clsx(
          "shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold",
          issue.state === "open" ? "bg-emerald-500/15 text-emerald-400" : "bg-purple-500/15 text-purple-400",
        )}>
          #{issue.number} {issue.state}
        </span>
        {issue.labels?.map((l) => (
          <span key={l.id} className="rounded px-1.5 py-0.5 text-[10px] font-medium" style={{ backgroundColor: `#${l.color}20`, color: `#${l.color}` }}>
            {l.name}
          </span>
        ))}
      </div>
      <h2 className="mt-0.5 truncate text-sm font-medium text-fg">{issue.title}</h2>
    </div>
  )
}

function IssueMatchView({ onToggleSidebar }: { onToggleSidebar?: () => void }) {
  const parentId = useIssueStore((s) => s.matchingParentId)
  const candidateId = useIssueStore((s) => s.matchingCandidateId)
  const parent = useIssueStore((s) => s.issues.find((i) => i.id === parentId))
  const candidate = useIssueStore((s) => s.issues.find((i) => i.id === candidateId))
  const exitMatchMode = useIssueStore((s) => s.exitMatchMode)
  const linkChild = useIssueStore((s) => s.linkChild)
  const [linking, setLinking] = useState(false)

  if (!parent) return null

  const handleConfirm = async () => {
    if (!candidate) return
    setLinking(true)
    await linkChild(parent.number, candidate.number)
    setLinking(false)
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-term">
      <header className="flex items-center gap-3 border-b border-line bg-base px-4 py-2.5">
        <button
          type="button"
          onClick={onToggleSidebar}
          aria-label="Open sidebar"
          className="-ml-1 rounded-lg p-1.5 text-fg-3 hover:bg-elevated md:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
        <span className="text-xs font-medium text-fg-4">匹配子任务</span>
        <span className="font-mono text-xs text-fg-3">父: #{parent.number}</span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={exitMatchMode}
          className="flex h-8 items-center gap-1.5 rounded-md border border-line px-2.5 text-xs text-fg-3 transition-colors hover:border-fg-5 hover:text-fg"
        >
          <X className="h-3.5 w-3.5" />
          退出匹配
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-b border-line md:border-b-0 md:border-r">
          <div className="border-b border-line/60 px-4 py-2.5">
            <IssueHeader issue={parent} />
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-6">
            <IssueBody body={parent.body} />
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {candidate ? (
            <>
              <div className="border-b border-line/60 px-4 py-2.5">
                <IssueHeader issue={candidate} />
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-6">
                <IssueBody body={candidate.body} />
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <p className="font-mono text-xs text-fg-5">← 从左侧列表选择候选 Issue</p>
            </div>
          )}
        </div>
      </div>

      {candidate && (
        <div className="flex items-center justify-center gap-3 border-t border-line bg-base px-4 py-3">
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={linking}
            className="flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" />
            {linking ? "关联中…" : `确认: 将 #${candidate.number} 设为 #${parent.number} 的子任务`}
          </button>
        </div>
      )}
    </div>
  )
}

export function RunView({
  onToggleSidebar,
  onToggleRightPanel,
  rightPanelOpen,
}: {
  onToggleSidebar?: () => void
  onToggleRightPanel?: () => void
  rightPanelOpen?: boolean
}) {
  const navigate = useNavigate()
  const repoName = useRepoStore(selectActiveRepoName)
  const activeSessionId = useSessionStore((state) => state.activeSessionId)
  const session = useSessionStore(
    (state) =>
      state.sessions.find((item) => item.id === state.activeSessionId) ?? null,
  )
  const messages = useSessionStore((state) => {
    const id = state.activeSessionId
    return id ? (state.messages[id] ?? EMPTY_MESSAGES) : EMPTY_MESSAGES
  })
  const todos = useSessionStore((state) => {
    const id = state.activeSessionId
    return id ? (state.todos[id] ?? EMPTY_TODOS) : EMPTY_TODOS
  })
  const status = useSessionStore((state) => {
    const id = state.activeSessionId
    return id ? state.sessionStatuses[id] : undefined
  })
  const queuedIds = useSessionStore((state) => {
    const id = state.activeSessionId
    return id ? (state.queuedMessageIds[id] ?? EMPTY_QUEUE) : EMPTY_QUEUE
  })
  const errorReason = useSessionStore((state) => {
    const id = state.activeSessionId
    return id ? state.errorReasons[id] : undefined
  })
  const messagesMeta = useSessionStore((state) => {
    const id = state.activeSessionId
    return id ? state.messagesMeta[id] : undefined
  })
  const loadMoreMessages = useSessionStore((state) => state.loadMoreMessages)
  const sendError = useSessionStore((state) => state.sendError)
  const abortSession = useSessionStore((state) => state.abortSession)
  const revertToMessage = useSessionStore((state) => state.revertToMessage)
  const activeRepo = useRepoStore((state) => state.repos.find((r) => r.id === state.activeRepoId))
  const canRevert = activeRepo?.runtimeType !== "claude-code"
  const [revertingId, setRevertingId] = useState<string | null>(null)
  const [headerExpanded, setHeaderExpanded] = useState(false)
  const linkedIssue = useIssueStore((state) =>
    session?.issueId ? state.issues.find((i) => i.id === session.issueId) : undefined,
  )

  useEffect(() => {
    if (!activeSessionId) return
    orchestrator.activateSession(activeSessionId)
    return () => orchestrator.deactivateSession(activeSessionId)
  }, [activeSessionId])

  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)
  useEffect(() => {
    const element = scrollRef.current
    if (element && stickToBottomRef.current) {
      element.scrollTop = element.scrollHeight
    }
  }, [messages, todos])

  useEffect(() => {
    stickToBottomRef.current = true
    setShowScrollToBottom(false)
  }, [activeSessionId])

  useEffect(() => {
    if (status !== "busy" && status !== "retry") return
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return
      const target = event.target as HTMLElement | null
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable
      ) return
      void abortSession()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [status, abortSession])

  const matchingParentId = useIssueStore((state) => state.matchingParentId)

  if (!activeSessionId) {
    if (matchingParentId) return <IssueMatchView onToggleSidebar={onToggleSidebar} />
    return <NewSessionInput onToggleSidebar={onToggleSidebar} />
  }

  const busy = status === "busy"
  const retrying = status === "retry"
  const stoppable = busy || retrying

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-term">
      {/* ── Mobile header (< md) ── */}
      <header className="border-b border-line bg-base md:hidden">
        <div
          className="flex items-center gap-2 px-3 py-2"
          onClick={() => setHeaderExpanded((v) => !v)}
        >
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={onToggleSidebar}
              aria-label="Open sidebar"
              className="-ml-1 rounded-lg p-1.5 text-fg-3 hover:bg-elevated"
            >
              <Menu className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => useSessionStore.setState({ activeSessionId: null })}
              aria-label="新建运行"
              title="新建运行"
              className="rounded-lg p-1.5 text-fg-3 hover:bg-elevated"
            >
              <Plus className="h-5 w-5" />
            </button>
          </div>
          <div className="min-w-0 flex-1">
            {session?.parentID && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); void useSessionStore.getState().setActiveSession(session.parentID!) }}
                className="mb-0.5 flex items-center gap-1 text-[11px] text-fg-4 transition-colors hover:text-blue-400"
              >
                <ArrowLeft className="h-3 w-3" />
                返回父会话
              </button>
            )}
            <h2 className="text-sm font-medium leading-snug text-fg">
              {session?.title?.trim() || "untitled run"}
            </h2>
          </div>
          {stoppable && (
            <span className={clsx("h-2 w-2 shrink-0 rounded-full", retrying ? "bg-amber-400 animate-pulse" : "bg-amber-400 animate-pulse")} />
          )}
          {!stoppable && status === "error" && (
            <span className="h-2 w-2 shrink-0 rounded-full bg-red-400" />
          )}
          <ChevronDown className={clsx("h-4 w-4 shrink-0 text-fg-5 transition-transform duration-200", headerExpanded && "rotate-180")} />
        </div>
        <div
          className={clsx(
            "grid transition-[grid-template-rows] duration-200 ease-in-out",
            headerExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
          )}
        >
          <div className="overflow-hidden">
            <div className="flex flex-col gap-2.5 border-t border-line/60 px-4 py-3">
              {session?.agent && (
                <div className="flex items-center gap-2 font-mono text-xs text-fg-4">
                  <span className="w-14 shrink-0 text-fg-5">Agent</span>
                  <span className="truncate">{session.agent}</span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <span className="w-14 shrink-0 font-mono text-xs text-fg-5">Status</span>
                <StatusBadge status={status} reason={errorReason} />
              </div>
              <div className="flex items-center gap-2">
                <span className="w-14 shrink-0 font-mono text-xs text-fg-5">Context</span>
                <ContextInfo session={session} messages={messages} />
              </div>
              {linkedIssue && (
                <div className="flex items-center gap-2">
                  <span className="w-14 shrink-0 font-mono text-xs text-fg-5">Issue</span>
                  <button
                    type="button"
                    onClick={() => navigate(`/${encodeURIComponent(repoName!)}/dev/issues?id=${linkedIssue.id}`)}
                    className="flex items-center gap-1.5 truncate font-mono text-xs text-fg-3 transition-colors hover:text-blue-400"
                  >
                    <span className={clsx(
                      "shrink-0 rounded px-1 py-0.5 text-[10px] font-semibold",
                      linkedIssue.state === "open" ? "bg-emerald-500/15 text-emerald-400" : "bg-purple-500/15 text-purple-400",
                    )}>
                      #{linkedIssue.number}
                    </span>
                    <span className="truncate">{linkedIssue.title}</span>
                  </button>
                </div>
              )}
              {stoppable && (
                <button
                  type="button"
                  onClick={() => void abortSession()}
                  className="mt-0.5 flex w-full items-center justify-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 font-mono text-xs text-fg-2 transition-colors hover:border-red-500/50 hover:text-red-400"
                >
                  <Square className="h-3 w-3 fill-current" />
                  {retrying ? "stop retry" : "stop"}
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* ── Desktop header (md+) ── */}
      <header className="hidden items-center gap-3 border-b border-line bg-base px-4 py-2.5 md:flex">
        <div className="min-w-0 flex-1">
          {session?.parentID && (
            <button
              type="button"
              onClick={() => void useSessionStore.getState().setActiveSession(session.parentID!)}
              className="mb-0.5 flex items-center gap-1 text-[11px] text-fg-4 transition-colors hover:text-blue-400"
            >
              <ArrowLeft className="h-3 w-3" />
              返回父会话
            </button>
          )}
          <h2 className="truncate text-sm font-medium text-fg">
            {session?.title?.trim() || "untitled run"}
          </h2>
          {session?.agent && (
            <p className="truncate font-mono text-xs text-fg-4">
              {session.agent}
            </p>
          )}
          <ContextInfo session={session} messages={messages} />
        </div>
        {linkedIssue && (
          <button
            type="button"
            onClick={() => navigate(`/${encodeURIComponent(repoName!)}/dev/issues?id=${linkedIssue.id}`)}
            className="flex items-center gap-1 rounded-md border border-line px-2 py-1 font-mono text-xs text-fg-3 transition-colors hover:border-fg-5 hover:text-fg"
          >
            <span className={clsx(
              "rounded px-1 py-0.5 text-[10px] font-semibold",
              linkedIssue.state === "open" ? "bg-emerald-500/15 text-emerald-400" : "bg-purple-500/15 text-purple-400",
            )}>
              #{linkedIssue.number}
            </span>
            <span className="hidden max-w-[120px] truncate sm:inline">{linkedIssue.title}</span>
          </button>
        )}
        <StatusBadge status={status} reason={errorReason} />
        {onToggleRightPanel && (
          <button
            type="button"
            onClick={onToggleRightPanel}
            aria-label={rightPanelOpen ? "关闭侧边栏" : "打开侧边栏"}
            className={clsx(
              "flex items-center justify-center rounded-md border border-line p-1.5 transition-colors",
              rightPanelOpen
                ? "bg-blue-500/10 text-blue-500 hover:bg-blue-500/20"
                : "text-fg-4 hover:bg-elevated hover:text-fg-2",
            )}
          >
            <PanelRight className="h-4 w-4" />
          </button>
        )}
        {stoppable && (
          <button
            type="button"
            onClick={() => void abortSession()}
            className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 font-mono text-xs text-fg-2 transition-colors hover:border-red-500/50 hover:text-red-400"
          >
            <Square className="h-3 w-3 fill-current" />
            {retrying ? "stop retry" : "stop"}
          </button>
        )}
      </header>

      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={() => {
            const element = scrollRef.current
            if (!element) return
            const atBottom =
              element.scrollHeight - element.clientHeight - element.scrollTop <=
              STICK_TO_BOTTOM_THRESHOLD_PX
            stickToBottomRef.current = atBottom
            setShowScrollToBottom(!atBottom)

            if (
              element.scrollTop < 200 &&
              activeSessionId &&
              messagesMeta?.hasMore &&
              !messagesMeta.loading
            ) {
              const prevHeight = element.scrollHeight
              loadMoreMessages(activeSessionId).then(() => {
                requestAnimationFrame(() => {
                  if (scrollRef.current) {
                    scrollRef.current.scrollTop = scrollRef.current.scrollHeight - prevHeight
                  }
                })
              })
            }
          }}
          className="h-full overflow-y-auto"
        >
          <div className="mx-auto flex max-w-4xl flex-col gap-3 px-4 py-4">
            {messagesMeta?.loading && (
              <div className="flex justify-center py-2">
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-fg-5 border-t-transparent" />
              </div>
            )}
            {messagesMeta && !messagesMeta.loading && messagesMeta.hasMore && (
              <button
                type="button"
                onClick={() => activeSessionId && loadMoreMessages(activeSessionId)}
                className="mx-auto rounded-md border border-line px-3 py-1 font-mono text-xs text-fg-4 transition-colors hover:border-fg-5 hover:text-fg-2"
              >
                加载更早的消息
              </button>
            )}
            {messages.length === 0 ? (
              <p className="py-10 text-center font-mono text-xs text-fg-6">
                <span className="text-emerald-500/60">❯</span> waiting for input
                <span className="fs-blink"> ▋</span>
              </p>
            ) : (
              messages.map((message, index) => (
                <Fragment key={message.id}>
                  {index > 0 && message.role === "user" && (
                    <div className="group/revert relative border-t border-line py-2">
                      {canRevert && !stoppable && (
                        <button
                          type="button"
                          disabled={revertingId !== null}
                          onClick={async () => {
                            const count = messages.length - index
                            if (!window.confirm(`回退到此处？将移除后续 ${count} 条对话记录（不影响已产生的代码改动）。`)) return
                            setRevertingId(message.id)
                            await revertToMessage(activeSessionId!, message.id)
                            setRevertingId(null)
                          }}
                          className="absolute left-1/2 top-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full border border-line bg-base px-2.5 py-1 font-mono text-[11px] text-fg-4 opacity-60 shadow-sm transition-all duration-150 hover:border-amber-500/50 hover:text-amber-400 md:opacity-30 md:group-hover/revert:opacity-100 disabled:opacity-50"
                        >
                          {revertingId === message.id ? (
                            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                          ) : (
                            <RotateCcw className="h-3 w-3" />
                          )}
                          回退到此处
                        </button>
                      )}
                    </div>
                  )}
                  <div data-message-id={message.id}>
                    <ExecutionBlock message={message} isStreaming={busy && index === messages.length - 1} queued={queuedIds.includes(message.id)} />
                  </div>
                </Fragment>
              ))
            )}
            {todos.length > 0 && (
              <TodoProgressCompact
                todos={[...todos]}
                onClick={onToggleRightPanel}
              />
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            const el = scrollRef.current
            if (!el) return
            el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
            stickToBottomRef.current = true
          }}
          aria-label="滚动到底部"
          className={clsx(
            "absolute bottom-4 right-4 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-line bg-surface/90 text-fg-4 shadow-lg backdrop-blur transition-all duration-200",
            "hover:bg-elevated hover:text-fg-2",
            showScrollToBottom
              ? "translate-y-0 opacity-100"
              : "pointer-events-none translate-y-2 opacity-0",
          )}
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>

      {status === "error" && errorReason && (
        <div className="flex items-center gap-2 border-t border-red-500/20 bg-red-500/10 px-4 py-2 font-mono text-xs text-red-400">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{errorReason}</span>
        </div>
      )}
      {sendError && (
        <div className="flex items-center gap-2 border-t border-red-500/20 bg-red-500/10 px-4 py-2 font-mono text-xs text-red-400">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{sendError}</span>
        </div>
      )}

      <InputBar />
    </div>
  )
}
