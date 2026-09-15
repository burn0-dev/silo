/**
 * Project-tracking environment template.
 *
 * A simulated software delivery organisation: projects and their sprints, the
 * work items inside them with dependencies and comments, the teams and members
 * who carry them, and the time logged against each. Edit anything here — this
 * file is copied into your project, it is not library code.
 *
 * Silo already uses the word "task" for its own objectives, so the thing being
 * tracked here is a **work item** throughout — in the types, the tools and the
 * data.
 *
 * Silo loads an environment through three exports: `createState`, `bindTools`
 * and `verifiers`. Tasks are discovered from `tasks/*.json`.
 */

import { bindTools as bind, type EnvironmentModule, type Tool } from "@burn0/silo";

import { createState } from "./environment.js";
import type { State } from "./state.js";
import { tools } from "./tools/index.js";
import { verifiers } from "./verifiers/index.js";

export * from "./state.js";
export * from "./tools/index.js";
export { SIMULATION_NOW, createState } from "./environment.js";
export { verifiers };

export function bindTools(state: State): Tool[] {
  return bind(state, tools);
}

/** Compile-time proof that this module satisfies Silo's environment contract. */
export const environment: EnvironmentModule = { createState, bindTools, verifiers };
