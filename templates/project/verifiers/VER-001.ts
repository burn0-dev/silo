/**
 * Grades TASK-001.
 *
 * The item is found by title rather than by id, so renumbering the seed data
 * does not silently break grading.
 */

import { check, defineVerifier, optional } from "@burn0/silo";

import { type State, isDone } from "../state.js";
import { isDoneIn, workItemByTitle } from "./shared.js";

export const ver001 = defineVerifier<State>({
  id: "VER-001",
  taskId: "TASK-001",
  name: "Tax rules engine recorded as done",
  check(final, initial) {
    const target = workItemByTitle(initial, "Tax rules engine");

    const otherItemsUntouched = Object.values(initial.workItems)
      .filter((item) => item.id !== target?.id)
      .every((item) => final.workItems[item.id]?.status === item.status);

    return [
      check(
        "The tax rules engine is in a done state",
        !!target && isDoneIn(final, target.id),
        target ? `${target.id} status = ${final.workItems[target.id]?.status ?? "missing"}` : "item not found",
      ),
      check(
        "It was not already done before the rollout",
        !!target && !isDone(initial, target),
        target ? `started in ${target.status}` : "item not found",
      ),
      optional(
        "No other work item changed status",
        otherItemsUntouched,
        "other statuses unchanged",
      ),
    ];
  },
});
