import { eq } from "drizzle-orm"
import { db } from "../db/index"
import { customAgents } from "../db/schema"
import { logger } from "../middleware/logger"

const COMMENT_POLISHER_ID = "system-comment-polisher"

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

const MEMORY_EXTRACTOR_ID = "system-memory-extractor"

const MEMORY_EXTRACTOR_PROMPT = `你是一个记忆提炼助手。

用户会给你一段 AI Agent 的对话历史、该 Agent 已有的记忆列表（带 ID），以及一个输出文件路径。

你的任务：
1. 从对话中提取值得跨 session 记住的关键信息
2. 与已有记忆比对：避免重复、发现矛盾、识别可合并的记忆
3. 识别本次 session 中实际用到的已有记忆（强化信号）
4. 用 Write 工具将结果 JSON 数组写入指定的输出文件

提取类别：
- decision：做了什么技术选择，为什么
- lesson：踩过的坑，怎么解决的
- preference：用户纠正过的行为模式
- pattern：反复出现的操作模式

输出格式（严格 JSON 数组，写入输出文件）：
[
  { "action": "add", "content": "...", "category": "lesson", "importance": 0.8 },
  { "action": "update", "targetId": "mem_xxx", "content": "更新后的内容", "importance": 0.9 },
  { "action": "merge", "targetIds": ["mem_aaa", "mem_bbb"], "content": "合并后的内容", "category": "pattern", "importance": 0.85 },
  { "action": "reinforce", "targetId": "mem_yyy", "reason": "本次实际应用了此经验" },
  { "action": "skip", "targetId": "mem_zzz", "reason": "仍然相关但无需更新" }
]

注意：
- importance 范围 0-1，越重要越高
- 每次最多提取 5 条新记忆（add），宁少勿多
- merge 和 reinforce 不计入 5 条限制
- 不要提取琐碎信息（如文件路径、临时变量名）
- 只提取对未来 session 有价值的、可泛化的知识
- 如果这个 session 没有值得记住的内容，写入空数组 []
- 只使用 Write 工具写入输出文件，不要使用 Bash、Grep 等其他工具
- 不要修改任何项目文件，只写入指定的输出文件`

const SYSTEM_AGENTS = [
  {
    id: COMMENT_POLISHER_ID,
    name: "评论助手",
    baseAgent: "Sisyphus - ultraworker",
    systemPrompt: COMMENT_POLISHER_PROMPT,
  },
  {
    id: MEMORY_EXTRACTOR_ID,
    name: "记忆提炼助手",
    baseAgent: "Sisyphus - ultraworker",
    systemPrompt: MEMORY_EXTRACTOR_PROMPT,
  },
]

export async function seedSystemAgents(): Promise<void> {
  for (const agent of SYSTEM_AGENTS) {
    const [existing] = await db.select({ id: customAgents.id })
      .from(customAgents)
      .where(eq(customAgents.id, agent.id))

    if (existing) {
      await db.update(customAgents).set({
        baseAgent: agent.baseAgent,
        systemPrompt: agent.systemPrompt,
        updatedAt: Date.now(),
      }).where(eq(customAgents.id, agent.id))
      continue
    }

    const now = Date.now()
    await db.insert(customAgents).values({
      id: agent.id,
      name: agent.name,
      baseAgent: agent.baseAgent,
      model: null,
      systemPrompt: agent.systemPrompt,
      systemPromptPosition: -1,
      isSystem: 1,
      repoId: null,
      sortOrder: -1,
      createdAt: now,
      updatedAt: now,
    })
    logger.info({ agentId: agent.id, name: agent.name }, "seeded system agent")
  }
}

export { COMMENT_POLISHER_ID, MEMORY_EXTRACTOR_ID, MEMORY_EXTRACTOR_PROMPT }
