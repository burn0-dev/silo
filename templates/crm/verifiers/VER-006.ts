/**
 * Grades TASK-006.
 *
 * "Still with the company" means active, and the task says so — so the
 * deactivated rep, who is on zero attainment and would otherwise be the
 * obvious answer, is excluded here too. An agent that ignores the word
 * "active" lands on him and fails.
 */

import { check, defineVerifier, optional } from "@burn0/silo";

import { type State, wonAmountFor } from "../state.js";
import { mentions, statesNumber } from "./shared.js";

type Attainment = { userId: string; name: string; percent: number };

function attainmentOfActiveReps(state: State): Attainment[] {
  return Object.values(state.users)
    .filter((user) => user.role === "rep" && user.active && user.quota.amount > 0)
    .map((user) => ({
      userId: user.id,
      name: user.name,
      percent: Math.round((wonAmountFor(state, user.id).amount / user.quota.amount) * 1000) / 10,
    }))
    .sort((a, b) => a.percent - b.percent || a.userId.localeCompare(b.userId));
}

export const ver006 = defineVerifier<State>({
  id: "VER-006",
  taskId: "TASK-006",
  name: "Weakest active rep against quota identified",
  check(final, initial, context) {
    const ranked = attainmentOfActiveReps(initial);
    const lowest = ranked.at(0);
    const nextUp = ranked.at(1);

    const inactiveRep = Object.values(initial.users).find(
      (user) => user.role === "rep" && !user.active,
    );

    return [
      check(
        "The named rep is the weakest active rep against quota",
        lowest !== undefined && mentions(context.agentOutput, lowest.name),
        `expected ${lowest?.name ?? "none"}, output = ${context.agentOutput || "(empty)"}`,
      ),
      check(
        "The attainment percentage is correct",
        lowest !== undefined && statesNumber(context.agentOutput, lowest.percent, 0.1),
        `expected ${lowest?.percent ?? "none"}%`,
      ),
      check(
        "The deactivated rep was not offered as the answer",
        inactiveRep === undefined || !mentions(context.agentOutput, inactiveRep.name),
        `deactivated rep = ${inactiveRep?.name ?? "none"}`,
      ),
      optional(
        "The seeded world has a single clear answer",
        lowest !== undefined && (nextUp === undefined || nextUp.percent > lowest.percent),
        `lowest = ${lowest?.percent ?? 0}%, next = ${nextUp?.percent ?? 0}%`,
      ),
      optional(
        "Answering left the world unchanged",
        JSON.stringify(final) === JSON.stringify(initial),
        "state is untouched",
      ),
    ];
  },
});
