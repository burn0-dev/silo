/**
 * The tools the agent can call.
 *
 * Author each tool with `defineTool` in its own file, then register it here.
 * Registration is explicit on purpose: a file appearing on disk should never
 * silently become a new agent capability.
 */

import type { SiloTool } from "@burn0/silo";

import type { State } from "../state.js";

export const tools: SiloTool<State>[] = [];
