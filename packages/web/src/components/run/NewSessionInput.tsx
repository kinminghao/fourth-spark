import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { useSearchParams } from "react-router-dom"
import { ArrowUp, Menu, X } from "lucide-react"
import clsx from "clsx"
import { AttachButton, AttachmentStrip, shouldFoldText, useAttachments } from "../Attachments"
import { VoiceButton } from "../VoiceButton"
import { VoiceOverlay, VoiceStatusBar } from "../VoiceOverlay"
import { useVoiceInput } from "../../hooks/use-voice-input"
import {
  useSessionStore,
} from "../../stores/session-store"
import type { ModelInfo } from "../../lib/api-client"
import { listModels } from "../../lib/api-client"
import { useRepoStore } from "../../stores/repo-store"
import { useCustomAgentStore } from "../../stores/custom-agent-store"
import { useIssueStore } from "../../stores/issue-store"
import { agentAvatar } from "../../lib/agent-avatar"

export const MAX_NEW_HEIGHT_PX = 144

export function NewSessionInput({ onToggleSidebar }: { onToggleSidebar?: () => void }) {
  const [draft, setDraft] = useState("")
  const [customAgentId, setCustomAgentId] = useState("")
  const [selectedVariant, setSelectedVariant] = useState("")
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
  const { attachments, foldedTexts, promptFiles, error: attachError, addFiles, onPaste: imageOnPaste, addFoldedText, expandFoldedTexts, remove, removeFoldedText, clear } = useAttachments(imagesAllowed)

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

  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files)
    if (files.length > 0) {
      imageOnPaste(event)
      return
    }
    const text = event.clipboardData.getData("text/plain")
    if (!text || !shouldFoldText(text)) return
    event.preventDefault()
    const fold = addFoldedText(text)
    const textarea = event.currentTarget
    const start = textarea.selectionStart ?? draft.length
    const end = textarea.selectionEnd ?? draft.length
    const newValue = draft.slice(0, start) + fold.placeholder + draft.slice(end)
    setDraft(newValue)
    requestAnimationFrame(() => {
      const pos = start + fold.placeholder.length
      textarea.setSelectionRange(pos, pos)
    })
  }

  const handleRemoveFoldedText = (id: string) => {
    const fold = foldedTexts.find((f) => f._id === id)
    if (fold) setDraft(draft.replace(fold.placeholder, ""))
    removeFoldedText(id)
  }

  const submit = () => {
    const text = expandFoldedTexts(draft.trim())
    if (!activeRepoId || (!text && !hasContext && attachments.length === 0)) return
    setDraft("")
    clear()
    void createSession(text, undefined, undefined, selectedVariant || undefined, issueId || undefined, customAgentId || undefined, promptFiles.length > 0 ? promptFiles : undefined)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    if (event.key === "Tab" && visibleAgents.length > 1) {
      event.preventDefault()
      const currentIdx = visibleAgents.findIndex((a) => a.id === customAgentId)
      const nextIdx = event.shiftKey
        ? (currentIdx - 1 + visibleAgents.length) % visibleAgents.length
        : (currentIdx + 1) % visibleAgents.length
      setCustomAgentId(visibleAgents[nextIdx].id)
      return
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  const handleVoiceSubmit = useCallback(
    (text: string) => {
      void createSession(text, undefined, undefined, selectedVariant || undefined, issueId || undefined, customAgentId || undefined)
    },
    [createSession, issueId, customAgentId, selectedVariant],
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

        <AttachmentStrip attachments={attachments} foldedTexts={foldedTexts} error={attachError} onRemove={remove} onRemoveFoldedText={handleRemoveFoldedText} />

        <div data-guide="run-new-input" className={clsx(
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
              <div className="flex items-center gap-1.5 overflow-x-auto px-4 pt-3 pb-1 scrollbar-none">
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
                {visibleAgents.length > 1 && (
                  <span className="hidden shrink-0 ml-auto font-mono text-[10px] text-fg-6 md:inline">Tab 切换</span>
                )}
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
              onPaste={handlePaste}
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
              disabled={!activeRepoId || (!draft.trim() && !hasContext && attachments.length === 0 && foldedTexts.length === 0)}
              aria-label="Start run"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-emerald-600 text-white transition-colors duration-150 hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-fg-6/30 disabled:text-fg-5"
            >
              <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
            </button>
          </div>

          <div className="flex items-center gap-2 border-t border-line/60 px-4 py-1.5">
            {linkedIssueLabel && (
              <>
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
              </>
            )}
            <div className="ml-auto flex items-center gap-1.5">
              <span className="font-mono text-[11px] text-fg-5">variant</span>
              <select
                value={selectedVariant}
                onChange={(e) => setSelectedVariant(e.target.value)}
                className="rounded border border-line bg-surface px-2 py-0.5 font-mono text-[11px] text-fg-4 focus:border-fg-5 focus:outline-none"
              >
                <option value="">默认</option>
                <option value="max">max</option>
                <option value="high">high</option>
              </select>
            </div>
          </div>
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
