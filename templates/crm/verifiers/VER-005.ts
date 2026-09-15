/**
 * Grades TASK-005.
 *
 * Both the rep and the count are derived from the initial world. If the seed
 * data changes so that a different rep leads, this verifier follows it.
 */

import { check, defineVerifier, optional } from "@burn0/silo";

import { type State, STALE_STAGE_DAYS, isStale } from "../state.js";
import { mentions, statesNumber } from "./shared.js";

function staleCounts(state: State): Map<string, number> {
  const counts = new Map<string, number>();

  for (const opportunity of Object.values(state.opportunities)) {
    if (!isStale(state, opportunity, STALE_STAGE_DAYS)) continue;

    counts.set(opportunity.ownerId, (counts.get(opportunity.ownerId) ?? 0) + 1);
  }

  return counts;
}

export const ver005 = defineVerifier<State>({
  id: "VER-005",
  taskId: "TASK-005",
  name: "Rep with the most stalled deals identified",
  check(final, initial, context) {
    const counts = [...staleCounts(initial).entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    );

    const top = counts.at(0);
    const runnerUp = counts.at(1);
    const expectedName = top ? (initial.users[top[0]]?.name ?? top[0]) : "";

    /** A tie would make the task ambiguous; the seed data must not produce one. */
    const unambiguous = top !== undefined && (runnerUp === undefined || runnerUp[1] < top[1]);

    return [
      check(
        "The named rep is the one with the most stalled deals",
        expectedName !== "" && mentions(context.agentOutput, expectedName),
        `expected ${expectedName || "none"}, output = ${context.agentOutput || "(empty)"}`,
      ),
      check(
        "The number of stalled deals is correct",
        top !== undefined && statesNumber(context.agentOutput, top[1]),
        `expected ${top?.[1] ?? "none"} stalled deals`,
      ),
      optional(
        "The seeded world has a single clear leader",
        unambiguous,
        `top = ${top?.[1] ?? 0}, runner-up = ${runnerUp?.[1] ?? 0}`,
      ),
      optional(
        "Answering left the world unchanged",
        JSON.stringify(final) === JSON.stringify(initial),
        "state is untouched",
      ),
    ];
  },
});
