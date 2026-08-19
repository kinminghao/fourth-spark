import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react"
import { useNavigate } from "react-router-dom"
import { AlertTriangle, ArrowLeft, ArrowUp, Check, ChevronDown, ExternalLink, GitBranch, Loader2, Menu, PanelRight, Play, Plus, RotateCcw, Search, Send, Square, X } from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import clsx from "clsx"
import { AttachButton, AttachmentStrip, useAttachments } from "./Attachments"
import { VoiceButton } from "./VoiceButton"
import { useSpeechToText } from "../hooks/use-speech-to-text"
import { MarkdownTable } from "./MarkdownTable"
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
const VOICE_TEXTAREA_MAX_HEIGHT_PX = 240
const VOICE_TICK_INTERVAL_MS = 1000

// Per-bar amplitude multipliers so the 7 bars scale volumeLevel at slightly
// different intensities — otherwise every bar would move in perfect lockstep
// even as the mic level fluctuates. Values center around 1.0.
const VOICE_BAR_MULTIPLIERS = [0.85, 1.25, 0.65, 1.4, 0.75, 1.15, 0.95] as const
const VOICE_BAR_MIN_HEIGHT_PX = 4
const VOICE_BAR_MAX_HEIGHT_PX = 24

function formatVoiceDuration(totalSeconds: number): string {
  const mm = Math.floor(totalSeconds / 60).toString().padStart(2, "0")
  const ss = Math.floor(totalSeconds % 60).toString().padStart(2, "0")
  return `${mm}:${ss}`
}

function VoiceWaveform({ volumeLevel }: { volumeLevel: number }) {
  const clampedVolume = Math.min(Math.max(volumeLevel, 0), 1)
  return (
    <div className="flex h-6 items-center gap-1" aria-hidden="true">
      {VOICE_BAR_MULTIPLIERS.map((multiplier, i) => {
        const raw =
          VOICE_BAR_MIN_HEIGHT_PX +
          clampedVolume *
            multiplier *
            (VOICE_BAR_MAX_HEIGHT_PX - VOICE_BAR_MIN_HEIGHT_PX)
        const height = Math.max(
          VOICE_BAR_MIN_HEIGHT_PX,
          Math.min(VOICE_BAR_MAX_HEIGHT_PX, raw),
        )
        return (
          <span
            key={i}
            className="w-1 rounded-full bg-red-400 transition-[height] duration-150 ease-out"
            style={{ height: `${height}px` }}
          />
        )
      })}
    </div>
  )
}

function NewSessionInput({ onToggleSidebar }: { onToggleSidebar?: () => void }) {
  const [draft, setDraft] = useState("")
  const [customAgentId, setCustomAgentId] = useState("")
  const [issueId, setIssueId] = useState("")
  const [issueQuery, setIssueQuery] = useState("")
  const [issueDropdownOpen, setIssueDropdownOpen] = useState(false)
  const [voiceEditText, setVoiceEditText] = useState("")
  const [voiceElapsed, setVoiceElapsed] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const issueComboRef = useRef<HTMLDivElement>(null)
  const voiceTextareaRef = useRef<HTMLTextAreaElement>(null)
  const voiceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const voiceStartTimeRef = useRef(0)
  const [models, setModels] = useState<ModelInfo[]>([])
  const stt = useSpeechToText()
  const createSession = useSessionStore((state) => state.createSession)
  const sendError = useSessionStore((state) => state.sendError)
  const activeRepoId = useRepoStore((state) => state.activeRepoId)
  const customAgents = useCustomAgentStore((state) => state.agents)
  const issues = useIssueStore((state) => state.issues)
  const selectedIssueId = useIssueStore((state) => state.selectedIssueId)
  const pendingDraft = useIssueStore((state) => state.pendingDraft)

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
    if (pendingDraft) {
      setDraft(pendingDraft)
      useIssueStore.getState().setPendingDraft(null)
    }
  }, [pendingDraft])

  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, MAX_NEW_HEIGHT_PX)}px`
  }, [draft])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (issueComboRef.current && !issueComboRef.current.contains(e.target as Node)) {
        setIssueDropdownOpen(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  const openIssues = issues.filter((i) => i.state === "open")
  const selectedIssue = issues.find((i) => i.id === issueId)
  const iq = issueQuery.trim().toLowerCase()
  const filteredIssues = !iq
    ? openIssues
    : openIssues.filter((i) => `#${i.number} ${i.title}`.toLowerCase().includes(iq))

  const hasContext = Boolean(customAgentId) || Boolean(issueId)

  const submit = () => {
    const text = draft.trim()
    if (!activeRepoId || (!text && !hasContext && attachments.length === 0)) return
    setDraft("")
    clear()
    void createSession(text, undefined, undefined, undefined, issueId || undefined, customAgentId || undefined, promptFiles.length > 0 ? promptFiles : undefined)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  const handleVoiceCancel = () => {
    void stt.stop()
    stt.resetTranscript()
    setVoiceEditText("")
  }

  const handleVoiceConfirm = () => {
    const text = voiceEditText.trim()
    if (!text) { handleVoiceCancel(); return }
    stt.resetTranscript()
    setVoiceEditText("")
    void createSession(text, undefined, undefined, undefined, issueId || undefined, customAgentId || undefined)
  }

  useEffect(() => {
    if (stt.phase === "recording") {
      voiceStartTimeRef.current = Date.now()
      setVoiceElapsed(0)
      voiceTimerRef.current = setInterval(() => {
        setVoiceElapsed(
          Math.floor((Date.now() - voiceStartTimeRef.current) / 1000),
        )
      }, VOICE_TICK_INTERVAL_MS)
    } else {
      if (voiceTimerRef.current) {
        clearInterval(voiceTimerRef.current)
        voiceTimerRef.current = null
      }
    }
    return () => {
      if (voiceTimerRef.current) {
        clearInterval(voiceTimerRef.current)
        voiceTimerRef.current = null
      }
    }
  }, [stt.phase])

  useEffect(() => {
    if (stt.phase === "done") {
      setVoiceEditText(stt.transcript)
      requestAnimationFrame(() => {
        const el = voiceTextareaRef.current
        if (!el) return
        el.focus()
        el.setSelectionRange(el.value.length, el.value.length)
      })
    }
  }, [stt.phase, stt.transcript])

  useLayoutEffect(() => {
    if (stt.phase !== "done") return
    const el = voiceTextareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, VOICE_TEXTAREA_MAX_HEIGHT_PX)}px`
  }, [stt.phase, voiceEditText])

  useEffect(() => {
    if (stt.phase === "idle") return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && stt.phase !== "recognizing") {
        e.preventDefault()
        handleVoiceCancel()
        return
      }
      if (
        stt.phase === "done" &&
        e.key === "Enter" &&
        (e.metaKey || e.ctrlKey)
      ) {
        if ((e as unknown as { isComposing?: boolean }).isComposing) return
        e.preventDefault()
        handleVoiceConfirm()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stt.phase, voiceEditText])

  const handleVoiceTextareaKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleVoiceConfirm()
    }
  }

  const combinedRecordingHasText =
    stt.transcript.length > 0 || stt.interimTranscript.length > 0

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
          {stt.phase !== "idle" && (
            <div className="absolute bottom-full left-0 right-0 z-20 mb-2 overflow-hidden rounded-xl border border-line bg-surface/95 backdrop-blur-sm">
              <div className="max-h-[40vh] overflow-y-auto px-4 py-4">
                {stt.phase === "recording" && (
                  <div className="text-xl leading-relaxed">
                    {combinedRecordingHasText ? (
                      <>
                        <span className="text-fg">{stt.transcript}</span>
                        {stt.interimTranscript && (
                          <span className="text-fg-4">{stt.interimTranscript}</span>
                        )}
                      </>
                    ) : (
                      <span className="italic text-fg-5">正在聆听…</span>
                    )}
                  </div>
                )}

                {stt.phase === "recognizing" && (
                  <div className="flex items-center gap-3">
                    <Loader2 className="h-5 w-5 shrink-0 text-emerald-400 fs-spin" />
                    <span className="font-mono text-sm text-emerald-400">
                      识别中…
                    </span>
                    {stt.interimTranscript && (
                      <span className="truncate text-base text-fg-4">
                        {stt.interimTranscript}
                      </span>
                    )}
                  </div>
                )}

                {stt.phase === "done" && (
                  <textarea
                    ref={voiceTextareaRef}
                    value={voiceEditText}
                    onChange={(e) => setVoiceEditText(e.target.value)}
                    onKeyDown={handleVoiceTextareaKey}
                    rows={2}
                    placeholder="识别结果（可编辑）"
                    className="w-full resize-none bg-transparent text-xl leading-relaxed text-fg placeholder:text-fg-5 focus:outline-none"
                  />
                )}
              </div>
            </div>
          )}

          <div className="flex items-start gap-2 px-4 py-3">
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
              placeholder={activeRepoId ? "让 Agent 做什么？" : "请先选择一个仓库"}
              className="flex-1 resize-none bg-transparent font-mono text-sm leading-6 text-fg placeholder:text-fg-6 focus:outline-none disabled:cursor-not-allowed"
            />
            <AttachButton
              onFiles={(files) => void addFiles(files)}
              disabled={!activeRepoId}
              allowed
            />
            <VoiceButton
              isListening={stt.isListening}
              disabled={!activeRepoId}
              onStart={stt.start}
              onStop={() => void stt.stop()}
              error={stt.error}
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

          <div className="flex flex-col gap-2 border-t border-line/60 px-4 py-2 sm:flex-row sm:items-center sm:gap-3">
            <label className="flex items-center gap-1.5 font-mono text-[11px] text-fg-4">
              <span className="shrink-0">Agent</span>
              <select
                value={customAgentId}
                onChange={(e) => setCustomAgentId(e.target.value)}
                className="rounded border border-line bg-surface px-2 py-1 font-mono text-xs text-fg focus:border-fg-5 focus:outline-none"
              >
                <option value="">默认</option>
                {customAgents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </label>
            {issues.length > 0 && (
              <div ref={issueComboRef} className="relative hidden min-w-0 flex-1 items-center gap-1.5 font-mono text-[11px] text-fg-4 sm:flex">
                <span className="shrink-0">Issue</span>
                <button
                  type="button"
                  onClick={() => { setIssueDropdownOpen((v) => !v); setIssueQuery("") }}
                  className="flex min-w-0 flex-1 items-center gap-1 truncate rounded border border-line bg-surface px-2 py-1 font-mono text-xs text-fg transition-colors hover:border-fg-5 focus:border-fg-5 focus:outline-none"
                >
                  <span className="min-w-0 flex-1 truncate text-left">
                    {selectedIssue ? `#${selectedIssue.number} ${selectedIssue.title}` : "无"}
                  </span>
                  <ChevronDown className="h-3 w-3 shrink-0 text-fg-5" />
                </button>
                {issueId && (
                  <button
                    type="button"
                    onClick={() => { setIssueId(""); setIssueQuery("") }}
                    className="shrink-0 text-fg-5 hover:text-fg-3"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
                {issueDropdownOpen && (
                  <div className="absolute left-0 top-full z-50 mt-1 w-full min-w-[280px] rounded-md border border-line bg-surface shadow-lg">
                    <div className="flex items-center gap-1.5 border-b border-line px-2 py-1.5">
                      <Search className="h-3 w-3 shrink-0 text-fg-5" />
                      <input
                        type="text"
                        value={issueQuery}
                        onChange={(e) => setIssueQuery(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Escape") setIssueDropdownOpen(false) }}
                        placeholder="搜索 issue..."
                        autoFocus
                        className="min-w-0 flex-1 bg-transparent font-mono text-xs text-fg placeholder:text-fg-6 focus:outline-none"
                      />
                    </div>
                    <ul className="max-h-48 overflow-y-auto py-1">
                      {!iq && (
                        <li>
                          <button
                            type="button"
                            onClick={() => { setIssueId(""); setIssueDropdownOpen(false) }}
                            className={clsx(
                              "w-full px-2.5 py-1.5 text-left font-mono text-xs transition-colors hover:bg-elevated/60",
                              !issueId ? "text-blue-400" : "text-fg-4",
                            )}
                          >
                            无
                          </button>
                        </li>
                      )}
                      {filteredIssues.map((issue) => (
                        <li key={issue.id}>
                          <button
                            type="button"
                            onClick={() => { setIssueId(issue.id); setIssueQuery(""); setIssueDropdownOpen(false) }}
                            className={clsx(
                              "flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left transition-colors hover:bg-elevated/60",
                              issue.id === issueId ? "bg-blue-500/10" : "",
                            )}
                          >
                            <span className={clsx(
                              "shrink-0 rounded px-1 py-0.5 font-mono text-[10px] font-medium",
                              issue.state === "open" ? "bg-emerald-500/15 text-emerald-400" : "bg-purple-500/15 text-purple-400",
                            )}>
                              #{issue.number}
                            </span>
                            <span className="min-w-0 truncate font-mono text-xs text-fg-3">{issue.title}</span>
                          </button>
                        </li>
                      ))}
                      {filteredIssues.length === 0 && (
                        <li className="px-2.5 py-3 text-center font-mono text-[10px] text-fg-5">无匹配结果</li>
                      )}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {stt.phase === "idle" ? (
          <div className="mt-2 flex items-center justify-center gap-2 font-mono text-[10px] text-fg-6">
            {stt.error ? (
              <span className="text-red-400">{stt.error}</span>
            ) : (
              <span>⌘⏎ / ctrl+⏎ 开始运行</span>
            )}
          </div>
        ) : stt.phase === "done" ? (
          <div className="mt-2 flex items-center gap-2 px-1">
            <span className="hidden font-mono text-[10px] text-fg-6 sm:inline">
              ⌘/Ctrl+⏎ 发送 · Esc 取消
            </span>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={handleVoiceCancel}
                className="rounded-md border border-line px-3 py-1 text-xs text-fg-3 transition-colors hover:bg-elevated hover:text-fg"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleVoiceConfirm}
                disabled={voiceEditText.trim().length === 0}
                aria-label="发送"
                className="flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-fg-6/30 disabled:text-fg-5"
              >
                <Send className="h-3.5 w-3.5" strokeWidth={2.5} />
                <span>发送</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-2 flex items-center gap-3 px-1">
            {stt.phase === "recording" ? (
              <>
                <VoiceWaveform volumeLevel={stt.volumeLevel} />
                <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-medium text-red-400">
                  <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-red-400" />
                  录音中
                </span>
                <span className="font-mono text-[11px] tabular-nums text-fg-4">
                  {formatVoiceDuration(voiceElapsed)}
                </span>
              </>
            ) : (
              <>
                <Loader2 className="h-4 w-4 shrink-0 text-emerald-400 fs-spin" />
                <span className="font-mono text-[11px] text-emerald-400">
                  识别中…
                </span>
              </>
            )}
          </div>
        )}

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
  if (!body) return <p className="py-10 text-center font-mono text-xs text-fg-5">没有描述内容</p>
  return (
    <div className="markdown-body leading-relaxed">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ table: MarkdownTable }}>{body}</ReactMarkdown>
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

function IssuePreview({ onToggleSidebar }: { onToggleSidebar?: () => void }) {
  const previewId = useIssueStore((s) => s.previewIssueId)
  const issue = useIssueStore((s) => s.issues.find((i) => i.id === previewId))

  if (!issue) return <NewSessionInput onToggleSidebar={onToggleSidebar} />

  const startSession = () => {
    useIssueStore.getState().setSelectedIssue(issue.id)
    useIssueStore.getState().setPreviewIssue(null)
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
        <div className="min-w-0 flex-1">
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
        <div className="flex flex-wrap items-center justify-end gap-2">
          {issue.htmlUrl && (
            <a
              href={issue.htmlUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-8 items-center gap-1.5 rounded-md border border-line px-2.5 font-mono text-xs text-fg-3 transition-colors hover:border-fg-5 hover:text-fg"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              源站
            </a>
          )}
          <button
            type="button"
            onClick={() => useIssueStore.getState().enterMatchMode(issue.id)}
            className="flex h-8 items-center gap-1.5 rounded-md border border-line px-2.5 text-xs text-fg-3 transition-colors hover:border-blue-500/50 hover:text-blue-400"
          >
            <GitBranch className="h-3.5 w-3.5" />
            匹配子任务
          </button>
          <button
            type="button"
            onClick={startSession}
            className="flex h-8 items-center gap-1.5 rounded-md bg-blue-600 px-3 text-xs font-medium text-white transition-colors hover:bg-blue-500"
          >
            <Play className="h-3.5 w-3.5 fill-current" />
            开始处理
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-6 py-6">
          {issue.body ? (
            <div className="markdown-body leading-relaxed">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ table: MarkdownTable }}>{issue.body}</ReactMarkdown>
            </div>
          ) : (
            <p className="py-10 text-center font-mono text-xs text-fg-5">该 Issue 没有描述内容</p>
          )}
        </div>
      </div>
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
  const previewIssueId = useIssueStore((state) => state.previewIssueId)
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
    if (previewIssueId) return <IssuePreview onToggleSidebar={onToggleSidebar} />
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
                    onClick={() => navigate(`/${encodeURIComponent(repoName!)}/issues?issueId=${linkedIssue.id}`)}
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
            onClick={() => navigate(`/${encodeURIComponent(repoName!)}/issues?issueId=${linkedIssue.id}`)}
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
          }}
          className="h-full overflow-y-auto"
        >
          <div className="mx-auto flex max-w-4xl flex-col gap-3 px-4 py-4">
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
