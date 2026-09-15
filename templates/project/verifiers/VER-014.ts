/**
 * Grades TASK-014.
 *
 * The Backlog state is found by name rather than by id, so renumbering the
 * workflow does not break grading.
 */

import { check, defineVerifier, optional } from "@burn0/silo";

import type { State } from "../state.js";
import { finalNumber, statesNumber, unchanged } from "./shared.js";

function backlogCount(state: State): number {
  const backlog = Object.values(state.workflowStates).find(
    (workflowState) => workflowState.name === "Backlog",
  );

  if (!backlog) return 0;

  return Object.values(state.workItems).filter((item) => item.status === backlog.id).length;
}

export const ver014 = defineVerifier<State>({
  id: "VER-014",
  taskId: "TASK-014",
  name: "Backlog size reported correctly",
  check(final, initial, context) {
    const expected = backlogCount(initial);
    const answered = finalNumber(context.agentOutput);

    return [
      check(
        "The reported backlog count is correct",
        statesNumber(context.agentOutput, expected),
        `answered ${answered ?? "nothing"}, expected ${expected}`,
      ),
      optional(
        "The count is the figure the answer closes on",
        answered !== null && answered === expected,
        `final number = ${answered ?? "none"}`,
      ),
      optional("Answering left the world unchanged", unchanged(final, initial), "state is untouched"),
    ];
  },
});
