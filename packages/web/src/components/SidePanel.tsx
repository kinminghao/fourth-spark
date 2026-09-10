import { useState, useRef } from "react"
import clsx from "clsx"
import type { Message, Todo, SessionLinks } from "../lib/api-client"
import { useRepoStore } from "../stores/repo-store"
import { useSessionStore } from "../stores/session-store"
import { TodoTab } from "./side-panel/TodoTab"
import { PromptsTab } from "./side-panel/PromptsTab"
import { LinksTab } from "./side-panel/LinksTab"
import { SubtasksTab } from "./side-panel/SubtasksTab"
import { FilesPanel, type PreviewFileInfo } from "./side-panel/FilesPanel"
import type { Tab } from "./side-panel/side-panel-utils"

export type { PreviewFileInfo }

export function SidePanel({
  todos,
  messages,
  sessionLinks,
  sessionId,
  onScrollToMessage,
  onPreviewFile,
}: {
  todos: readonly Todo[]
  messages: readonly Message[]
  sessionLinks?: SessionLinks
  sessionId: string | null
  onScrollToMessage?: (messageId: string) => void
  onPreviewFile?: (info: PreviewFileInfo) => void
}) {
  const [activeTab, setActiveTab] = useState<Tab>("todo")
  const containerRef = useRef<HTMLDivElement>(null)
  const activeRepoId = useRepoStore((s) => s.activeRepoId)

  const allSessions = useSessionStore((s) => s.sessions)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const userCount = messages.filter((m) => m.role === "user").length
  const linkCount = (sessionLinks?.issues?.length ?? 0) + (sessionLinks?.pullRequests?.length ?? 0)
  const activeSession = allSessions.find((s) => s.id === activeSessionId)
  const subtaskParentId = activeSession?.parentID ?? activeSessionId
  const subtaskCount = allSessions.filter((s) => s.parentID === subtaskParentId).length

  return (
    <div
      ref={containerRef}
      className="flex h-full w-72 shrink-0 flex-col border-l border-line bg-surface"
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div data-guide="run-side-tabs" className="flex items-center border-b border-line">
          <button
            type="button"
            onClick={() => setActiveTab("todo")}
            className={clsx(
              "flex flex-1 items-center justify-center gap-1 border-b-2 px-2 py-2.5 text-xs font-medium transition-colors",
              activeTab === "todo"
                ? "border-blue-500 text-blue-500"
                : "border-transparent text-fg-4 hover:text-fg-2",
            )}
          >
            待办
            {todos.length > 0 && (
              <span className="font-mono text-[10px] text-fg-5">{todos.length}</span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("prompts")}
            className={clsx(
              "flex flex-1 items-center justify-center gap-1 border-b-2 px-2 py-2.5 text-xs font-medium transition-colors",
              activeTab === "prompts"
                ? "border-blue-500 text-blue-500"
                : "border-transparent text-fg-4 hover:text-fg-2",
            )}
          >
            输入
            {userCount > 0 && (
              <span className="font-mono text-[10px] text-fg-5">{userCount}</span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("links")}
            className={clsx(
              "flex flex-1 items-center justify-center gap-1 border-b-2 px-2 py-2.5 text-xs font-medium transition-colors",
              activeTab === "links"
                ? "border-blue-500 text-blue-500"
                : "border-transparent text-fg-4 hover:text-fg-2",
            )}
          >
            关联
            {linkCount > 0 && (
              <span className="font-mono text-[10px] text-fg-5">{linkCount}</span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("subtasks")}
            className={clsx(
              "flex flex-1 items-center justify-center gap-1 border-b-2 px-2 py-2.5 text-xs font-medium transition-colors",
              activeTab === "subtasks"
                ? "border-blue-500 text-blue-500"
                : "border-transparent text-fg-4 hover:text-fg-2",
            )}
          >
            子任务
            {subtaskCount > 0 && (
              <span className="font-mono text-[10px] text-fg-5">{subtaskCount}</span>
            )}
          </button>
        </div>

        {activeTab === "todo" ? (
          <TodoTab todos={todos} />
        ) : activeTab === "prompts" ? (
          <PromptsTab messages={messages} onScrollToMessage={onScrollToMessage} />
        ) : activeTab === "links" ? (
          <LinksTab links={sessionLinks} sessionId={sessionId} />
        ) : (
          <SubtasksTab />
        )}
      </div>

      {sessionId && activeRepoId && (
        <FilesPanel
          repoId={activeRepoId}
          sessionId={sessionId}
          containerRef={containerRef}
          onPreviewFile={onPreviewFile}
        />
      )}
    </div>
  )
}
