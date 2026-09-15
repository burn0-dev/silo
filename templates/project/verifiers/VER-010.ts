/**
 * Grades TASK-010.
 *
 * The strongest sprint is computed from the seeded world with the same velocity
 * helper the reporting tool uses, so changing an estimate in `data/` moves the
 * expected answer with it.
 */

import { check, defineVerifier, optional } from "@burn0/silo";

import { type State, velocityForSprint } from "../state.js";
import { mentions, statesNumber, unchanged } from "./shared.js";

function bestCompletedSprint(state: State) {
  return Object.values(state.sprints)
    .filter((sprint) => sprint.status === "completed")
    .map((sprint) => ({ sprint, delivered: velocityForSprint(state, sprint.id) }))
    .sort((a, b) => b.delivered - a.delivered || a.sprint.id.localeCompare(b.sprint.id))[0];
}

export const ver010 = defineVerifier<State>({
  id: "VER-010",
  taskId: "TASK-010",
  name: "Strongest completed sprint reported correctly",
  check(final, initial, context) {
    const best = bestCompletedSprint(initial);

    const runnersUp = Object.values(initial.sprints)
      .filter((sprint) => sprint.status === "completed" && sprint.id !== best?.sprint.id)
      .map((sprint) => velocityForSprint(initial, sprint.id));

    return [
      check(
        "The named sprint is the one that delivered most",
        !!best && mentions(context.agentOutput, best.sprint.name),
        best ? `expected ${best.sprint.name}` : "no completed sprint",
      ),
      check(
        "The points delivered are reported correctly",
        !!best && statesNumber(context.agentOutput, best.delivered),
        best ? `expected ${best.delivered}` : "no completed sprint",
      ),
      optional(
        "The answer is unambiguous in the seed data",
        !!best && runnersUp.every((delivered) => delivered < best.delivered),
        "one clear winner",
      ),
      optional("Answering left the world unchanged", unchanged(final, initial), "state is untouched"),
    ];
  },
});
