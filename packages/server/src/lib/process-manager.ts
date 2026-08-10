// ---------------------------------------------------------------------------
// Process manager — thin wiring module.
//
// Real behavior now lives in:
//   * core/runtime-manager.ts          — DefaultRuntimeManager (lifecycle,
//                                        session monitor, cloud lease pool)
//   * runtimes/opencode/provider.ts    — OpenCodeProvider (per-repo `opencode
//                                        serve` process, port allocation,
//                                        MCP injection, orphan adoption)
//
// This file wires the OpenCode provider into the DefaultRuntimeManager and
// exports it under two names:
//   * `runtimeManager`  — canonical name for new code
//   * `processManager`  — backward-compat alias so pre-existing routes and
//                         MCP tools keep compiling
// ---------------------------------------------------------------------------

import { createDefaultRuntimeManager } from "../core/runtime-manager"
import { createOpenCodeProvider } from "../runtimes/opencode/provider"
import { createClaudeCodeProvider } from "../runtimes/claude-code/provider"
import { PORT } from "./config"

const manager = createDefaultRuntimeManager()
manager.registerProvider(createOpenCodeProvider(PORT))
manager.registerProvider(createClaudeCodeProvider(PORT))

export const runtimeManager = manager
export const processManager = manager
