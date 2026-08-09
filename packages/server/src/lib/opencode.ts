// ---------------------------------------------------------------------------
// Backward-compat shim. The real definitions now live in:
//   * core/runtime-types.ts       — shared data types + RuntimeError
//   * core/runtime-client.ts      — RuntimeClient interface
//   * runtimes/opencode/client.ts — HttpRuntimeClient implementation
//
// Existing code that imports from "./opencode" or "../lib/opencode" keeps
// working through the re-exports below. New code MUST import from the core/
// and runtimes/ locations directly.
// ---------------------------------------------------------------------------

export type {
  Session,
  Message,
  MessagePart,
  Todo,
  Agent,
  Provider,
  ProviderModel,
  ProviderListResponse,
  SessionStatus,
  PendingQuestion,
} from "../core/runtime-types"

// OpenCodeError is aliased to RuntimeError so `err instanceof OpenCodeError`
// still holds. Everything the OpenCode runtime throws is a RuntimeError now.
export { RuntimeError as OpenCodeError } from "../core/runtime-types"

import { HttpRuntimeClient } from "../runtimes/opencode/client"
import type { RuntimeClient } from "../core/runtime-client"

export type OpenCodeClient = RuntimeClient

export function createOpenCodeClient(baseUrl: string, directory: string): RuntimeClient {
  return new HttpRuntimeClient(baseUrl, directory)
}
