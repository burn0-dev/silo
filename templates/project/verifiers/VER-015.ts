/**
 * Grades TASK-015.
 *
 * A sprint that was closed with work still inside it is the awkward row this
 * task exists to surface. Both the sprint and the points left in it are derived
 * from the initial world.
 */

import { check, defineVerifier, optional } from "@burn0/silo";

import { type State, isDone, workItemsForSprint } from "../state.js";
import { mentions, statesNumber, unchanged } from "./shared.js";

function completedSprintsWithUnfinishedWork(state: State) {
  return Object.values(state.sprints)
    .filter((sprint) => sprint.status === "completed")
    .map((sprint) => ({
      sprint,
      remainingPoints: workItemsForSprint(state, sprint.id)
        .filter((item) => !isDone(state, item))
        .reduce((total, item) => total + item.estimatePoints, 0),
    }))
    .filter((row) => row.remainingPoints > 0)
    .sort((a, b) => a.sprint.id.localeCompare(b.sprint.id));
}

export const ver015 = defineVerifier<State>({
  id: "VER-015",
  taskId: "TASK-015",
  name: "Completed sprint with carry-over reported correctly",
  check(final, initial, context) {
    const rows = completedSprintsWithUnfinishedWork(initial);
    const target = rows[0];

    return [
      check(
        "The sprint that closed with unfinished work is named",
        !!target && mentions(context.agentOutput, target.sprint.name),
        target ? `expected ${target.sprint.name}` : "no sprint closed with carry-over",
      ),
      check(
        "The points still unfinished in it are reported correctly",
        !!target && statesNumber(context.agentOutput, target.remainingPoints),
        target ? `expected ${target.remainingPoints}` : "no carry-over",
      ),
      optional(
        "Exactly one completed sprint carries unfinished work in the seed data",
        rows.length === 1,
        `${rows.length} such sprint(s)`,
      ),
      optional("Answering left the world unchanged", unchanged(final, initial), "state is untouched"),
    ];
  },
});
