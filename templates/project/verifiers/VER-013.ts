/**
 * Grades TASK-013.
 *
 * Over-commitment is computed with the same load helper the tools use, so the
 * expected answer follows a change to a capacity or an estimate in `data/`.
 */

import { check, defineVerifier, optional } from "@burn0/silo";

import { type State, loadFor } from "../state.js";
import { mentions, statesNumber, unchanged } from "./shared.js";

function overCommitted(state: State) {
  return Object.values(state.members)
    .map((member) => ({ member, over: loadFor(state, member.id) - member.weeklyCapacityPoints }))
    .filter((row) => row.over > 0)
    .sort((a, b) => b.over - a.over || a.member.id.localeCompare(b.member.id));
}

export const ver013 = defineVerifier<State>({
  id: "VER-013",
  taskId: "TASK-013",
  name: "Over-committed member named with the overage",
  check(final, initial, context) {
    const rows = overCommitted(initial);
    const worst = rows[0];

    return [
      check(
        "The over-committed member is named",
        !!worst && mentions(context.agentOutput, worst.member.name),
        worst ? `expected ${worst.member.name}` : "nobody is over capacity",
      ),
      check(
        "The number of points they are over by is correct",
        !!worst && statesNumber(context.agentOutput, worst.over),
        worst ? `expected ${worst.over}` : "nobody is over capacity",
      ),
      optional(
        "Exactly one member is over capacity in the seed data",
        rows.length === 1,
        `${rows.length} over capacity`,
      ),
      optional("Answering left the world unchanged", unchanged(final, initial), "state is untouched"),
    ];
  },
});
