/**
 * Grades TASK-003.
 *
 * The closed-won stage is looked up by its properties rather than by id, so
 * renaming or renumbering the pipeline in `data/stages.json` does not break
 * grading.
 */

import { check, defineVerifier, optional } from "@burn0/silo";

import type { State } from "../state.js";

const OPPORTUNITY_ID = "OPP-007";
const CONTRACTED_AMOUNT = 118000;

export const ver003 = defineVerifier<State>({
  id: "VER-003",
  taskId: "TASK-003",
  name: "Deal booked won at the contracted amount",
  check(final, initial) {
    const opportunity = final.opportunities[OPPORTUNITY_ID];

    const wonStage = Object.values(final.stages).find(
      (stage) => stage.isClosed && stage.probability === 100,
    );

    const loggedToday = Object.values(final.activities).some(
      (activity) =>
        activity.relatedTo.type === "opportunity" &&
        activity.relatedTo.id === OPPORTUNITY_ID &&
        activity.completedDate === final.now &&
        initial.activities[activity.id] === undefined,
    );

    const othersUnchanged = Object.values(initial.opportunities)
      .filter((row) => row.id !== OPPORTUNITY_ID)
      .every((row) => final.opportunities[row.id]?.status === row.status);

    return [
      check(
        "The deal is won",
        opportunity?.status === "won",
        `status = ${opportunity?.status ?? "missing"}`,
      ),
      check(
        "The amount is the contracted figure",
        opportunity?.amount.amount === CONTRACTED_AMOUNT,
        `amount = ${opportunity?.amount.amount ?? "missing"}, expected ${CONTRACTED_AMOUNT}`,
      ),
      check(
        "The deal sits in the closed-won stage",
        wonStage !== undefined && opportunity?.stageId === wonStage.id,
        `stage = ${opportunity?.stageId ?? "missing"}, closed-won = ${wonStage?.id ?? "none"}`,
      ),
      check(
        "The close date is today",
        opportunity?.closedDate === final.now,
        `closedDate = ${opportunity?.closedDate ?? "null"}, today = ${final.now}`,
      ),
      optional(
        "The signed contract was noted on the deal",
        loggedToday,
        loggedToday ? "activity recorded today" : "no new activity on the deal",
      ),
      optional(
        "No other deal was opened or closed",
        othersUnchanged,
        "other opportunities unchanged",
      ),
    ];
  },
});
