import { useMemo, useState } from "react"
import { Activity, Box, Cpu, FileText, GitBranch, Keyboard, Wifi, Zap } from "lucide-react"
import clsx from "clsx"
import { isNativePlatform, getServerUrl } from "../lib/config"
import { RepoListContent } from "./ReposPage"
import { AccountSection } from "./settings/AccountSection"
import { GitHostSection } from "./settings/GitHostSection"
import { ModelManagementSection } from "./settings/ModelSection"
import { AgentsMdSection } from "./settings/AgentsMdSection"
import { ServerSection } from "./settings/ServerSection"
import { QuickInputSection } from "./settings/QuickInputSection"
import { DiagnosticsSection } from "./settings/DiagnosticsSection"

type Tab = "repos" | "usage" | "git" | "models" | "agents" | "general" | "server" | "diagnostics"

const BASE_TABS: { id: Tab; label: string; icon: typeof Zap }[] = [
  { id: "repos", label: "仓库", icon: Box },
  { id: "usage", label: "Claude 账号", icon: Zap },
  { id: "git", label: "Git 源站", icon: GitBranch },
  { id: "models", label: "模型", icon: Cpu },
  { id: "agents", label: "AGENTS.md", icon: FileText },
  { id: "general", label: "通用", icon: Keyboard },
  { id: "diagnostics", label: "诊断", icon: Activity },
]

const SERVER_TAB: { id: Tab; label: string; icon: typeof Zap } = {
  id: "server", label: "服务器", icon: Wifi,
}

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>("usage")
  const tabs = useMemo(() => (isNativePlatform() || getServerUrl()) ? [...BASE_TABS, SERVER_TAB] : BASE_TABS, [])

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className={clsx("mx-auto", tab === "repos" ? "max-w-4xl" : "max-w-2xl")}>
        <h1 className="text-lg font-semibold text-fg">设置</h1>
        <p className="mt-0.5 text-sm text-fg-4">全局配置</p>

        <div className="mt-6 flex gap-1 overflow-x-auto rounded-lg border border-line bg-surface p-1 scrollbar-none">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={clsx(
                "flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                tab === t.id
                  ? "bg-base text-fg shadow-sm"
                  : "text-fg-4 hover:text-fg-3",
              )}
            >
              <t.icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          ))}
        </div>

        <div className="mt-4">
          {tab === "repos" && <RepoListContent />}
          {tab === "usage" && <AccountSection />}
          {tab === "git" && <GitHostSection />}
          {tab === "models" && <ModelManagementSection />}
          {tab === "agents" && <AgentsMdSection />}
          {tab === "general" && <QuickInputSection />}
          {tab === "server" && <ServerSection />}
          {tab === "diagnostics" && <DiagnosticsSection />}
        </div>
      </div>
    </div>
  )
}
