/**
 * Builds the world each rollout starts from.
 *
 * Datasets in `data/` are imported as JSON modules, which Node caches for the
 * life of the process. Cloning here is what makes every rollout independent —
 * without it, one rollout's mutations would leak into the next.
 */

import type { State } from "./state.js";
import customers from "./data/customers.json" with { type: "json" };

export function createState(): State {
  return structuredClone({ customers }) as State;
}
