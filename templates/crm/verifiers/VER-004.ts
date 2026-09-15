/**
 * Grades TASK-004, a question the agent answers rather than a change it makes.
 *
 * The expected total is derived from the seeded world through the same helper
 * the tools use, never hardcoded — change an amount or a stage probability in
 * `data/` and this verifier still grades correctly.
 */

import { check, defineVerifier, optional } from "@burn0/silo";

import { type State, sumMoney, weightedAmount } from "../state.js";
import { finalNumber, statesNumber } from "./shared.js";

function expectedWeightedTotal(state: State): number {
  return sumMoney(
    Object.values(state.opportunities)
      .filter((opportunity) => opportunity.status === "open")
      .map((opportunity) => weightedAmount(state, opportunity)),
  ).amount;
}

export const ver004 = defineVerifier<State>({
  id: "VER-004",
  taskId: "TASK-004",
  name: "Weighted open pipeline reported correctly",
  check(final, initial, context) {
    const expected = expectedWeightedTotal(initial);
    const answered = finalNumber(context.agentOutput);

    return [
      check(
        "The reported weighted total is correct",
        statesNumber(context.agentOutput, expected),
        `answered ${answered ?? "nothing"}, expected ${expected}`,
      ),
      optional(
        "The total is the figure the answer closes on",
        answered !== null && Math.abs(answered - expected) <= 0.01,
        `final number = ${answered ?? "none"}`,
      ),
      optional(
        "Answering left the world unchanged",
        JSON.stringify(final) === JSON.stringify(initial),
        "state is untouched",
      ),
    ];
  },
});
