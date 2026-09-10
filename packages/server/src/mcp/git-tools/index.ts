import { McpServer } from "@modelcontextprotocol/server"
import { registerIssueTools } from "./issue-tools"
import { registerPrTools } from "./pr-tools"
import type { McpToolProvider, ToolContext } from "../../core/types"

export const gitToolProvider: McpToolProvider = {
  id: "fourth-spark-git",
  register(server, context: ToolContext) {
    registerIssueTools(server as McpServer, context.repoId, context.sessionId)
    registerPrTools(server as McpServer, context.repoId, context.sessionId)
  },
}

export function buildGitMcpServer(repoId: string, sessionId?: string): McpServer {
  const server = new McpServer({
    name: "fourth-spark-git",
    version: "1.0.0",
  })
  gitToolProvider.register(server, { repoId, sessionId })
  return server
}
