/**
 * Grades TASK-012 — the task whose answer turns on a qualifier that is easy to
 * skim past.
 *
 * "Assigned to a member who is still active" excludes the overdue work left
 * behind by someone who has gone. An agent that drops the qualifier gets a
 * different, larger number, which is exactly what the second check looks for:
 * the two readings must not collide, or the task would be ungradeable.
 */

import { check, defineVerifier, optional } from "@burn0/silo";

import { type State, isOverdue } from "../state.js";
import { finalNumber, statesNumber, unchanged } from "./shared.js";

function overdueItems(state: State) {
  return Object.values(state.workItems).filter((item) => isOverdue(state, item));
}

function pointsHeldByActiveMembers(state: State): number {
  return overdueItems(state)
    .filter((item) => !!item.assigneeId && (state.members[item.assigneeId]?.active ?? false))
    .reduce((total, item) => total + item.estimatePoints, 0);
}

function pointsIgnoringTheQualifier(state: State): number {
  return overdueItems(state).reduce((total, item) => total + item.estimatePoints, 0);
}

export const ver012 = defineVerifier<State>({
  id: "VER-012",
  taskId: "TASK-012",
  name: "Overdue points held by active members reported correctly",
  check(final, initial, context) {
    const expected = pointsHeldByActiveMembers(initial);
    const ignoringQualifier = pointsIgnoringTheQualifier(initial);
    const answered = finalNumber(context.agentOutput);

    return [
      check(
        "The reported total counts only work held by an active member",
        statesNumber(context.agentOutput, expected),
        `answered ${answered ?? "nothing"}, expected ${expected}`,
      ),
      check(
        "The total that ignores the qualifier was not reported instead",
        ignoringQualifier === expected || !statesNumber(context.agentOutput, ignoringQualifier),
        `${ignoringQualifier} would be the answer without the 'still active' qualifier`,
      ),
      optional(
        "The qualifier actually changes the answer in this world",
        ignoringQualifier !== expected,
        `${expected} with the qualifier, ${ignoringQualifier} without`,
      ),
      optional("Answering left the world unchanged", unchanged(final, initial), "state is untouched"),
    ];
  },
});
