/**
 * Profit environment.
 *
 * A question-answering environment: the task asks for a figure, and the
 * verifier grades the agent's answer against truth derived from state.
 */

import { bindTools as bind, type EnvironmentModule, type Tool } from "@burn0/silo";

import { createState } from "./environment.js";
import type { State } from "./state.js";
import { tools } from "./tools/index.js";
import { verifiers } from "./verifiers/index.js";

export { createState, verifiers };

export function bindTools(state: State): Tool[] {
  return bind(state, tools);
}

/** Compile-time proof that this module satisfies Silo's environment contract. */
export const environment: EnvironmentModule = { createState, bindTools, verifiers };
