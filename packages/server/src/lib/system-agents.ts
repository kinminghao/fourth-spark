import { eq } from "drizzle-orm"
import { db } from "../db/index"
import { customAgents } from "../db/schema"
import { logger } from "../middleware/logger"

const DEFAULT_AGENT_ID = "system-default"
const COMMENT_POLISHER_ID = "system-comment-polisher"
const ISSUE_POLISHER_ID = "system-issue-polisher"

const COMMENT_POLISHER_PROMPT = `你是一个 Issue 评论润色助手。

用户会给你一个临时文件路径，里面包含评论草稿。你还会收到当前 Issue 的上下文信息。

你的任务：
1. 先用 Read 工具读取该文件中的草稿内容
2. 理解 Issue 的背景和讨论脉络
3. 基于用户的草稿意图，生成一份专业、清晰、完善的评论
4. 保持用户的原始观点和立场，只优化表达
5. 使用 Markdown 格式，必要时添加结构化排版
6. 用 Edit 工具将润色后的内容写回同一个文件，完全替换原内容

注意：
- 不要输出解释、前言、后记
- 不要使用 create_comment 工具，只修改文件
- 只修改指定的文件，不要做任何其他操作`

const ISSUE_POLISHER_PROMPT = `你是一个 Issue 创建润色助手。

用户会给你一个临时文件路径，里面包含 Issue 草稿。文件格式为：第一行是标题，空一行后是正文描述。

你的任务：
1. 先用 Read 工具读取该文件中的草稿内容
2. 基于用户的草稿意图，润色标题和正文
3. 标题：精炼、明确，体现核心诉求
4. 正文：补充结构化内容（背景、需求描述、期望行为等），使用 Markdown 格式
5. 如果用户只写了标题没有正文，根据标题推断并生成合理的正文
6. 如果用户只写了几个关键词，将其扩展为完整的 Issue
7. 保持用户的原始意图，只优化表达和结构
8. 用 Edit 工具将润色后的内容写回同一个文件，完全替换原内容
9. 输出格式必须为：第一行是润色后的标题，空一行后是润色后的正文

注意：
- 不要输出解释、前言、后记
- 不要使用 create_issue 工具，只修改文件
- 只修改指定的文件，不要做任何其他操作`

const MEMORY_EXTRACTOR_ID = "system-memory-extractor"

const MEMORY_EXTRACTOR_PROMPT = `你是一个记忆提炼助手，为跨 session 的 AI Agent 提取**可复用的原则**（不是事件日志）。

## 核心原则：抽象到"下次遇到类似问题能直接用"的层级

每条记忆必须通过"陌生 session 测试"：
在一个完全不同的项目、完全不同的 session 中读到这条记忆，它是否仍然有指导价值？
如果只对当前项目或当前文件有用，就不要写。

## 抽象层级对照（严格遵守）

❌ 太具体："customAgents 表 isSystem 字段：0=用户 1=系统交互 2=工具 3=内部，记忆由 memoryEnabled 控制"
✅ 正确："一个字段承担多个语义时，拆成独立字段，不用魔术数字编码状态"

❌ 太具体："IssuesPage ~405 行，已提取 IssueDetailPanel、IssueDetailWithTabs、IssueTree..."
✅ 正确："页面组件只负责列表+筛选+布局，详情/表单/树一律提取为子组件"

❌ 太具体："issue-store 的 selectedIssueId 用于跨页面通信，viewingIssueId 用于页面内状态"
✅ 正确："跨页面通信和页面内状态用不同字段，不复用同一字段"

❌ 太具体："修 PR #292 的过滤 bug 时发现 useMemo 依赖漏了 filterType"
✅ 正确："过滤类 bug 要审查完整读写链路，别只看渲染层"

❌ 太具体："用户说 issue 列表的三个图标按钮看不懂，改成文字后满意"
✅ 正确："用户偏好文字标签优于 icon-only 按钮"

❌ 太具体："PR #305 忘记关联 Issue，用户要求补创建 Issue #308"
✅ 正确："每个 PR 必须有对应 Issue"

## 硬性约束

1. **每条 ≤ 120 字符**。超过说明还没抽象够，重写。
2. **禁止出现**：具体行号、PR/Issue 编号、表名、字段名、文件路径、组件名、函数名、变量名、SQL 片段、commit hash。
3. **禁止句式**："在 X 项目中"、"XX 文件里"、"XX 组件的 XX 方法"。
4. **句式偏好**：祈使句（"…时应…"）或规则式（"X 优于 Y"），不用叙事句（"我们发现…所以…"）。
5. **一条一个原则**。含"并且/同时/另外"多半该拆成两条，或都别写。

## 类别定义（关注可迁移的知识）

- **decision**：一类问题的通用决策规则（"遇到 Y 类问题时选 X 因为 Z"）
- **lesson**：一类错误的通用规避方法（"X 类操作要警惕 Y"）
- **preference**：用户表达过的通用偏好（"用户偏好 X 类风格"）

## 操作

1. 从对话中提取值得跨 session 记住的**通用原则**
2. 与已有记忆比对：避免重复、发现矛盾、识别可合并的记忆
3. **优先 merge/reinforce**：新观察通常是已有原则的强化或细化，先尝试合并进已有记忆
4. 用 Write 工具将结果 JSON 数组写入指定的输出文件

## 输出格式（严格 JSON 数组，写入输出文件）

[
  { "action": "add", "content": "...", "category": "lesson", "importance": 0.8 },
  { "action": "update", "targetId": "mem_xxx", "content": "更新后的内容", "importance": 0.9 },
  { "action": "merge", "targetIds": ["mem_aaa", "mem_bbb"], "content": "合并后的内容", "category": "decision", "importance": 0.85 },
  { "action": "reinforce", "targetId": "mem_yyy", "reason": "本次实际应用了此经验" },
  { "action": "skip", "targetId": "mem_zzz", "reason": "仍然相关但无需更新" }
]

## 提取纪律

- **每次最多 3 条新 add**，大部分 session 只该有 0-2 条
- merge / reinforce / update 不计入 3 条限制
- 如果只是修了个 bug 没有可提炼的规律，返回 []
- importance：0.9+ 只留给"违反会立即出事"的原则；一般经验 0.6-0.8
- 只使用 Write 工具写入输出文件，不要使用 Bash、Grep 等其他工具
- 不要修改任何项目文件，只写入指定的输出文件`

const SYSTEM_AGENTS: Array<{
  id: string
  name: string
  description: string
  baseAgent: string
  systemPrompt: string
  isSystem: number
  memoryEnabled: number
  sortOrder: number
}> = [
  {
    id: DEFAULT_AGENT_ID,
    name: "默认助手",
    description: "通用开发助手，适合日常编码、调试和问答",
    baseAgent: "Sisyphus - ultraworker",
    systemPrompt: "",
    isSystem: 1,
    memoryEnabled: 1,
    sortOrder: -100,
  },
  {
    id: COMMENT_POLISHER_ID,
    name: "评论助手",
    description: "润色 Issue 评论，优化表达和结构",
    baseAgent: "Sisyphus - ultraworker",
    systemPrompt: COMMENT_POLISHER_PROMPT,
    isSystem: 2,
    memoryEnabled: 0,
    sortOrder: -1,
  },
  {
    id: ISSUE_POLISHER_ID,
    name: "Issue 润色助手",
    description: "润色 Issue 标题和正文，补充结构化内容",
    baseAgent: "Sisyphus - ultraworker",
    systemPrompt: ISSUE_POLISHER_PROMPT,
    isSystem: 2,
    memoryEnabled: 0,
    sortOrder: -1,
  },
  {
    id: MEMORY_EXTRACTOR_ID,
    name: "记忆提炼助手",
    description: "从对话中提取跨 Session 的关键记忆",
    baseAgent: "Sisyphus - ultraworker",
    systemPrompt: MEMORY_EXTRACTOR_PROMPT,
    isSystem: 3,
    memoryEnabled: 0,
    sortOrder: -1,
  },
]

async function seedOnce(): Promise<void> {
  for (const agent of SYSTEM_AGENTS) {
    const [existing] = await db.select({ id: customAgents.id })
      .from(customAgents)
      .where(eq(customAgents.id, agent.id))

    if (existing) {
      await db.update(customAgents).set({
        description: agent.description,
        baseAgent: agent.baseAgent,
        systemPrompt: agent.systemPrompt,
        isSystem: agent.isSystem,
        memoryEnabled: agent.memoryEnabled,
        sortOrder: agent.sortOrder,
        updatedAt: Date.now(),
      }).where(eq(customAgents.id, agent.id))
      continue
    }

    const now = Date.now()
    await db.insert(customAgents).values({
      id: agent.id,
      name: agent.name,
      description: agent.description,
      baseAgent: agent.baseAgent,
      model: null,
      systemPrompt: agent.systemPrompt,
      systemPromptPosition: -1,
      isSystem: agent.isSystem,
      memoryEnabled: agent.memoryEnabled,
      repoId: null,
      sortOrder: agent.sortOrder,
      createdAt: now,
      updatedAt: now,
    })
    logger.info({ agentId: agent.id, name: agent.name }, "seeded system agent")
  }
}

const SEED_MAX_RETRIES = 5
const SEED_BASE_DELAY_MS = 1_000

/**
 * Seed system agents with exponential backoff retry.
 * On slow devices PostgreSQL may not be reachable on the first attempt
 * (Docker port forwarding lag, first-time DB init, etc.).
 */
export async function seedSystemAgents(): Promise<void> {
  for (let attempt = 0; attempt <= SEED_MAX_RETRIES; attempt++) {
    try {
      await seedOnce()
      return
    } catch (err) {
      if (attempt === SEED_MAX_RETRIES) {
        throw err
      }
      const delay = SEED_BASE_DELAY_MS * 2 ** attempt
      logger.warn({ err, attempt: attempt + 1, nextRetryMs: delay }, "seedSystemAgents failed, retrying")
      await new Promise((r) => setTimeout(r, delay))
    }
  }
}

export { DEFAULT_AGENT_ID, COMMENT_POLISHER_ID, ISSUE_POLISHER_ID, MEMORY_EXTRACTOR_ID, MEMORY_EXTRACTOR_PROMPT }
