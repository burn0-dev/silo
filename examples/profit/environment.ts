/**
 * Builds the world each rollout starts from.
 *
 * Datasets in `data/` are imported as JSON modules, which Node caches for the
 * life of the process. Cloning here is what makes every rollout independent.
 */

import type { State } from "./state.js";
import profit from "./data/profit.json" with { type: "json" };

export function createState(): State {
  return structuredClone(profit) as State;
}
