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

const SYSTEM_AGENTS = [
  {
    id: COMMENT_POLISHER_ID,
    name: "评论助手",
    baseAgent: "Sisyphus - ultraworker",
    systemPrompt: COMMENT_POLISHER_PROMPT,
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

export { COMMENT_POLISHER_ID }
