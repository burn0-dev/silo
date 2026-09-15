/**
 * Builds the world each rollout starts from.
 *
 * Every run calls this fresh, so whatever it returns must be newly created
 * rather than shared — otherwise one rollout would see another's changes.
 * This is where datasets from `data/` get loaded and assembled.
 */

import type { State } from "./state.js";

export function createState(): State {
  return {};
}
