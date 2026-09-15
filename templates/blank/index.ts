/**
 * Blank environment.
 *
 * Silo loads an environment through the three exports below: `createState`,
 * `bindTools` and `verifiers`. Tasks are discovered from `tasks/*.json`.
 * This file is copied into your project, so edit it freely.
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
