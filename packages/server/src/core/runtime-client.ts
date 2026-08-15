// ---------------------------------------------------------------------------
// RuntimeClient — the unified session operations interface routes depend on.
// One instance per repo. Implementations live under src/runtimes/<id>/client.ts.
// ---------------------------------------------------------------------------

import type {
  Session,
  Message,
  Todo,
  Agent,
  SessionStatus,
  PendingQuestion,
  ProviderListResponse,
  PromptOpts,
} from "./runtime-types"

export interface RuntimeClient {
  readonly directory: string
  withDirectory(directory: string): RuntimeClient

  listSessions(): Promise<Session[]>
  createSession(opts: { agent?: string; title?: string }): Promise<Session>
  getSession(sessionId: string): Promise<Session>
  deleteSession(sessionId: string): Promise<void>
  getMessages(sessionId: string): Promise<Message[]>
  prompt(sessionId: string, content: string, opts?: PromptOpts): Promise<void>
  abort(sessionId: string): Promise<void>
  getTodos(sessionId: string): Promise<Todo[]>
  getSessionStatus(): Promise<Record<string, SessionStatus>>
  eventStream(signal?: AbortSignal): Promise<Response>
  listQuestions(): Promise<PendingQuestion[]>
  replyQuestion(requestID: string, answers: string[][]): Promise<void>
  rejectQuestion(requestID: string): Promise<void>
  listAgents(): Promise<Agent[]>
  getProviders(): Promise<ProviderListResponse>
  revert(sessionId: string, messageID: string, partID?: string): Promise<Session>
}
