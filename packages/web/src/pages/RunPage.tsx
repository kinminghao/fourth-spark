import { useEffect, useState } from "react"
import { ChevronLeft, ChevronRight, X } from "lucide-react"
import clsx from "clsx"
import { useSessionStore, EMPTY_TODOS, EMPTY_MESSAGES } from "../stores/session-store"
import { useLayoutStore } from "../stores/layout-store"
import { RunView } from "../components/RunView"
import { SidePanel } from "../components/SidePanel"
import { useSwipeDrawer } from "../hooks/use-swipe-drawer"
import { SwipeDrawer } from "../components/SwipeDrawer"
import { SessionPanel } from "./run/SessionPanel"
import { FilePreviewContent, usePreviewTabs } from "./run/FilePreviewContent"

function useIsXl(): boolean {
  const [isXl, setIsXl] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 1280px)").matches,
  )
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1280px)")
    const handler = (e: MediaQueryListEvent) => setIsXl(e.matches)
    mq.addEventListener("change", handler)
    return () => mq.removeEventListener("change", handler)
  }, [])
  return isXl
}

function scrollToMessage(messageId: string) {
  const el = document.querySelector(`[data-message-id="${messageId}"]`)
  if (!el) return
  el.scrollIntoView({ behavior: "smooth", block: "center" })
  el.classList.add("fs-highlight")
  setTimeout(() => el.classList.remove("fs-highlight"), 2000)
}

export function RunPage() {
  const [leftOpen, setLeftOpen] = useState(false)
  const [rightOpen, setRightOpen] = useState(false)
  const [sidePanelOpen, setSidePanelOpen] = useState(false)

  const isXl = useIsXl()
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const preview = usePreviewTabs(activeSessionId)
  const sessionPanelCollapsed = useLayoutStore((s) => s.sessionPanelCollapsed)
  const toggleSessionPanel = useLayoutStore((s) => s.toggleSessionPanel)
  const todos = useSessionStore((s) => {
    const id = s.activeSessionId
    return id ? (s.todos[id] ?? EMPTY_TODOS) : EMPTY_TODOS
  })
  const messages = useSessionStore((s) => {
    const id = s.activeSessionId
    return id ? (s.messages[id] ?? EMPTY_MESSAGES) : EMPTY_MESSAGES
  })
  const sessionLinks = useSessionStore((s) => {
    const id = s.activeSessionId
    return id ? s.sessionLinks[id] : undefined
  })

  useEffect(() => {
    if (isXl && activeSessionId) {
      setSidePanelOpen(true)
    } else if (!isXl) {
      setSidePanelOpen(false)
    }
  }, [isXl, activeSessionId])

  const desktopSidePanelVisible = sidePanelOpen && !!activeSessionId

  const toggleRightPanel = () => {
    if (window.matchMedia("(max-width: 767px)").matches) {
      setRightOpen((v) => !v)
    } else {
      setSidePanelOpen((v) => !v)
    }
  }

  const swipeHandlers = useSwipeDrawer({
    onSwipeRight: () => setLeftOpen(true),
    onSwipeLeft: () => setRightOpen(true),
    disabled: leftOpen || rightOpen,
  })

  return (
    <div className="flex min-h-0 flex-1" {...swipeHandlers}>
      {/* Desktop left sidebar — collapsible at md+ */}
      <div className="relative hidden shrink-0 md:flex">
        <div
          className={clsx(
            "overflow-hidden transition-[width] duration-200 ease-in-out",
            sessionPanelCollapsed ? "w-0" : "w-80",
          )}
        >
          <div className="h-full w-80">
            <SessionPanel />
          </div>
        </div>
        {/* Edge toggle handle — vertical tab on the panel/content boundary */}
        <button
          type="button"
          data-guide="run-panel-handle"
          onClick={toggleSessionPanel}
          title={sessionPanelCollapsed ? "展开运行记录" : "收起运行记录"}
          className={clsx(
            "absolute left-full top-1/2 z-20 flex h-14 w-4 -translate-y-1/2 items-center justify-center rounded-r-md border-y border-r border-line text-fg-5 transition-all duration-200 hover:bg-elevated hover:text-fg-3",
            sessionPanelCollapsed
              ? "bg-surface opacity-80 hover:w-5 hover:opacity-100"
              : "bg-surface/80 opacity-40 hover:opacity-100",
          )}
        >
          {sessionPanelCollapsed
            ? <ChevronRight className="h-3 w-3" />
            : <ChevronLeft className="h-3 w-3" />
          }
        </button>
      </div>

      {/* Mobile left drawer — Session list */}
      <SwipeDrawer side="left" open={leftOpen} onClose={() => setLeftOpen(false)}>
        <SessionPanel onClose={() => setLeftOpen(false)} />
      </SwipeDrawer>

      {/* Mobile right drawer — SidePanel (Todo + Prompts) */}
      <SwipeDrawer side="right" open={rightOpen} onClose={() => setRightOpen(false)}>
        <SidePanel
          todos={todos}
          messages={messages}
          sessionLinks={sessionLinks}
          sessionId={activeSessionId}
          onScrollToMessage={(id) => { setRightOpen(false); setTimeout(() => scrollToMessage(id), 300) }}
        />
      </SwipeDrawer>

      {/* Main content */}
      <div className="flex min-w-0 flex-1 flex-col">
        {preview.tabs.length > 0 && (
          <div className="flex shrink-0 items-end gap-0 border-b border-line bg-surface">
            <button
              type="button"
              onClick={() => preview.activate(null)}
              className={clsx(
                "flex items-center gap-1.5 border-r border-line px-3 py-1.5 text-xs font-medium transition-colors",
                preview.activeIdx === null
                  ? "border-b-2 border-b-blue-500 bg-base text-fg-2"
                  : "text-fg-4 hover:bg-elevated/60 hover:text-fg-2",
              )}
            >
              对话
            </button>
            {preview.tabs.map((tab, i) => (
              <div
                key={tab.url}
                className={clsx(
                  "group flex items-center gap-1 border-r border-line px-2 py-1.5 text-xs transition-colors",
                  preview.activeIdx === i
                    ? "border-b-2 border-b-blue-500 bg-base text-fg-2"
                    : "text-fg-4 hover:bg-elevated/60 hover:text-fg-2",
                )}
              >
                <button
                  type="button"
                  onClick={() => preview.activate(i)}
                  className="min-w-0 max-w-[120px] truncate font-mono"
                  title={tab.name}
                >
                  {tab.name}
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); preview.close(i) }}
                  className="shrink-0 rounded p-0.5 text-fg-5 opacity-0 transition-opacity hover:bg-elevated hover:text-fg-2 group-hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className={clsx("min-h-0 flex-1 flex flex-col", preview.activeIdx !== null && "hidden")}>
          <RunView
            onToggleSidebar={() => setLeftOpen((v) => !v)}
            onToggleRightPanel={toggleRightPanel}
            rightPanelOpen={desktopSidePanelVisible}
          />
        </div>
        {preview.activeIdx !== null && preview.tabs[preview.activeIdx] && (
          <div className="min-h-0 flex-1 bg-base">
            <FilePreviewContent file={preview.tabs[preview.activeIdx]} />
          </div>
        )}
      </div>

      {/* Desktop right sidebar — SidePanel (Todo + Prompts) */}
      {desktopSidePanelVisible && (
        <div className="hidden shrink-0 md:flex">
          <SidePanel
            todos={todos}
            messages={messages}
            sessionLinks={sessionLinks}
            sessionId={activeSessionId}
            onScrollToMessage={scrollToMessage}
            onPreviewFile={preview.open}
          />
        </div>
      )}
    </div>
  )
}
