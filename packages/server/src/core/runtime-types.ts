// ---------------------------------------------------------------------------
// Shared runtime data types — the frontend-facing contract for agent runtimes.
// Copied from lib/opencode.ts so the abstraction layer owns these definitions
// and runtime implementations depend on this file, not on the OpenCode-specific
// module. Kept in shape with OpenCode responses (boundary trust: the runtime is
// a local, controlled process).
// ---------------------------------------------------------------------------

export type Session = {
  id: string
  title?: string
  parentID?: string
  createdAt?: string
  updatedAt?: string
}

export type MessagePart = {
  type: string
  content?: string
  toolName?: string
  input?: unknown
  output?: unknown
  // url must be a data: URL — OpenCode's validateMedia rejects anything else
  mime?: string
  url?: string
  filename?: string
}

export type Message = {
  id: string
  role: string
  parts?: MessagePart[]
  info?: { agent?: string; providerID?: string; modelID?: string }
}

export type Todo = {
  id: string
  content: string
  status: string
  priority?: string
}

export type Agent = {
  id: string
  name: string
  description?: string
}

export type ProviderModel = {
  id: string
  name?: string
  status?: string
  capabilities?: {
    toolcall?: boolean
    input?: { text?: boolean; image?: boolean; pdf?: boolean }
    output?: { text?: boolean; image?: boolean }
  }
  cost?: { input?: number; output?: number }
  limit?: { context?: number }
}

export type Provider = {
  id: string
  name?: string
  models?: Record<string, ProviderModel>
}

export type ProviderListResponse = {
  all: Provider[]
  default?: unknown
  connected?: unknown
}

export type SessionStatus = { type: "idle" | "busy" | "retry" }

export type PendingQuestion = {
  id: string
  sessionID: string
  questions: Array<{
    question: string
    header?: string
    options: Array<{ label: string; description?: string }>
    multiple?: boolean
  }>
  tool?: { messageID: string; callID: string }
}

export type PromptFile = { mime: string; url: string; filename?: string }

export type PromptOpts = { agent?: string; model?: string; variant?: string; files?: PromptFile[] }

export class RuntimeError extends Error {
  readonly status: number
  readonly body: string
  readonly runtimeId: string

  constructor(runtimeId: string, message: string, status: number, body: string) {
    super(message)
    this.name = "RuntimeError"
    this.runtimeId = runtimeId
    this.status = status
    this.body = body
  }
}

export interface CredentialWriter {
  read(): Promise<{ access?: string; refresh?: string; expires?: number } | undefined>
  write(token:
    | { kind: "full"; refresh: string; access?: string; expires?: number }
    | { kind: "lease"; access: string; expires: number }
  ): Promise<void>
}
