/**
 * Grades TASK-002.
 *
 * The blocking work is derived from the target's own `dependsOn` in the initial
 * world rather than listed here, so adding another dependency to the seed data
 * strengthens this verifier instead of bypassing it.
 */

import { check, defineVerifier, optional } from "@burn0/silo";

import { type State, unresolvedDependencies } from "../state.js";
import { isDoneIn, workItemByTitle } from "./shared.js";

export const ver002 = defineVerifier<State>({
  id: "VER-002",
  taskId: "TASK-002",
  name: "Payment retry scheduler unblocked and finished",
  check(final, initial) {
    const target = workItemByTitle(initial, "Payment retry scheduler");
    const blockers = target ? unresolvedDependencies(initial, target) : [];

    const blockersDone = blockers.filter((blocker) => isDoneIn(final, blocker.id));

    const unrelatedUntouched = Object.values(initial.workItems)
      .filter((item) => item.id !== target?.id && !blockers.some((blocker) => blocker.id === item.id))
      .every((item) => final.workItems[item.id]?.status === item.status);

    return [
      check(
        "Everything the scheduler was waiting on is finished",
        blockers.length > 0 && blockersDone.length === blockers.length,
        `${blockersDone.length} of ${blockers.length} blockers done`,
      ),
      check(
        "The payment retry scheduler itself is done",
        !!target && isDoneIn(final, target.id),
        target ? `${target.id} status = ${final.workItems[target.id]?.status ?? "missing"}` : "item not found",
      ),
      check(
        "Nothing was closed while a dependency was still open",
        !!target &&
          final.workItems[target.id] !== undefined &&
          unresolvedDependencies(final, final.workItems[target.id]!).length === 0,
        "no unresolved dependencies remain on the scheduler",
      ),
      optional(
        "The dependency was not simply deleted to get around the rule",
        !!target && (final.workItems[target.id]?.dependsOn.length ?? 0) === target.dependsOn.length,
        `dependsOn kept ${final.workItems[target?.id ?? ""]?.dependsOn.length ?? 0} entries`,
      ),
      optional(
        "No unrelated work item changed status",
        unrelatedUntouched,
        "other statuses unchanged",
      ),
    ];
  },
});
