/**
 * Grades TASK-001, a question the agent answers rather than a change it makes.
 *
 * The expected total is derived from the seeded world through `totalProfit`,
 * never hardcoded — change the data and this verifier still grades correctly.
 */

import { check, defineVerifier, optional } from "@burn0/silo";

import { type State, totalProfit } from "../state.js";

/** The agent's closing figure: the last number it wrote. */
function finalAnswer(output: string): number | null {
  const numbers = output.replace(/[$,]/g, "").match(/-?\d+(?:\.\d+)?/g);
  const last = numbers?.at(-1);

  return last === undefined ? null : Number(last);
}

export const ver001 = defineVerifier<State>({
  id: "VER-001",
  taskId: "TASK-001",
  name: "Total profit reported correctly",
  check(final, initial, context) {
    const expected = totalProfit(initial);
    const answered = finalAnswer(context.agentOutput);

    return [
      check(
        "The reported total is correct",
        answered === expected,
        `answered ${answered ?? "nothing"}, expected ${expected}`,
      ),
      optional(
        "An answer was given",
        answered !== null,
        `output = ${context.agentOutput || "(empty)"}`,
      ),
      optional(
        "Answering left the world unchanged",
        JSON.stringify(final) === JSON.stringify(initial),
        "state is untouched",
      ),
    ];
  },
});
