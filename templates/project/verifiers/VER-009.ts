/**
 * Grades TASK-009, a question the agent answers rather than a change it makes.
 *
 * The expected set is derived from the seeded world through the same helper the
 * tools use, never hardcoded — add a dependency in `data/` and this verifier
 * still grades correctly.
 */

import { check, defineVerifier, optional } from "@burn0/silo";

import { type State, isBlocked } from "../state.js";
import { mentions, statesNumber, unchanged } from "./shared.js";

function blockedItems(state: State) {
  return Object.values(state.workItems)
    .filter((item) => isBlocked(state, item))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export const ver009 = defineVerifier<State>({
  id: "VER-009",
  taskId: "TASK-009",
  name: "Blocked work items counted and named",
  check(final, initial, context) {
    const blocked = blockedItems(initial);
    const named = blocked.filter((item) => mentions(context.agentOutput, item.id));

    return [
      check(
        "The reported number of blocked work items is correct",
        statesNumber(context.agentOutput, blocked.length),
        `expected ${blocked.length}`,
      ),
      check(
        "Every blocked work item is named",
        blocked.length > 0 && named.length === blocked.length,
        `named ${named.length} of ${blocked.length}`,
      ),
      optional(
        "No unblocked work item was reported as blocked",
        Object.values(initial.workItems)
          .filter((item) => !isBlocked(initial, item) && item.dependsOn.length > 0)
          .every((item) => !mentions(context.agentOutput, item.id)),
        "resolved dependencies not miscounted",
      ),
      optional("Answering left the world unchanged", unchanged(final, initial), "state is untouched"),
    ];
  },
});
