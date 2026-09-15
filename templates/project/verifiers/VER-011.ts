/**
 * Grades TASK-011.
 *
 * The total is summed from the seeded time logs rather than written down here,
 * so editing an hours figure in `data/` keeps grading correct.
 */

import { check, defineVerifier, optional } from "@burn0/silo";

import { type State, timeLogsForWorkItem, totalHoursFor, workItemsForProject } from "../state.js";
import { finalNumber, projectIdByKey, statesNumber, unchanged } from "./shared.js";

function hoursOnProject(state: State, projectId: string): number {
  return totalHoursFor(
    state,
    workItemsForProject(state, projectId).flatMap((item) => timeLogsForWorkItem(state, item.id)),
  );
}

export const ver011 = defineVerifier<State>({
  id: "VER-011",
  taskId: "TASK-011",
  name: "Hours logged against the billing platform reported correctly",
  check(final, initial, context) {
    const projectId = projectIdByKey(initial, "ATL");
    const expected = projectId ? hoursOnProject(initial, projectId) : 0;
    const answered = finalNumber(context.agentOutput);

    const otherProjectTotals = Object.values(initial.projects)
      .filter((project) => project.id !== projectId)
      .map((project) => hoursOnProject(initial, project.id));

    return [
      check(
        "The reported total is correct",
        !!projectId && statesNumber(context.agentOutput, expected),
        `answered ${answered ?? "nothing"}, expected ${expected}`,
      ),
      optional(
        "The total is the figure the answer closes on",
        answered !== null && Math.abs(answered - expected) <= 0.01,
        `final number = ${answered ?? "none"}`,
      ),
      optional(
        "Another project's total was not reported by mistake",
        otherProjectTotals.every((total) => Math.abs(total - expected) > 0.01),
        "project totals are distinct in the seed data",
      ),
      optional("Answering left the world unchanged", unchanged(final, initial), "state is untouched"),
    ];
  },
});
