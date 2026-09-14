/**
 * The tools the agent can call.
 *
 * Author each tool with `defineTool` in its own file, then register it here.
 */

import type { SiloTool } from "@burn0/silo";

import type { State } from "../state.js";
import { getProfits } from "./profit.js";

export const tools: SiloTool<State>[] = [getProfits];
