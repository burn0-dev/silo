/**
 * Grades TASK-002.
 *
 * The set of deals that had to move is derived from the initial world rather
 * than listed here, so adding another opportunity to the seed data does not
 * silently weaken this verifier.
 */

import { check, defineVerifier, optional } from "@burn0/silo";

import type { State } from "../state.js";

const DEPARTED_ID = "USR-004";
const NEW_OWNER_ID = "USR-003";

export const ver002 = defineVerifier<State>({
  id: "VER-002",
  taskId: "TASK-002",
  name: "Departed rep's open deals moved to the new owner",
  check(final, initial) {
    const shouldMove = Object.values(initial.opportunities).filter(
      (opportunity) => opportunity.ownerId === DEPARTED_ID && opportunity.status === "open",
    );

    const moved = shouldMove.filter(
      (opportunity) => final.opportunities[opportunity.id]?.ownerId === NEW_OWNER_ID,
    );

    const stillOpen = shouldMove.filter(
      (opportunity) => final.opportunities[opportunity.id]?.status === "open",
    );

    const remainingWithDeparted = Object.values(final.opportunities).filter(
      (opportunity) => opportunity.ownerId === DEPARTED_ID && opportunity.status === "open",
    );

    const closedUnchanged = Object.values(initial.opportunities)
      .filter((opportunity) => opportunity.ownerId === DEPARTED_ID && opportunity.status !== "open")
      .every((opportunity) => final.opportunities[opportunity.id]?.ownerId === DEPARTED_ID);

    const untouched = Object.values(initial.opportunities)
      .filter((opportunity) => opportunity.ownerId !== DEPARTED_ID)
      .every(
        (opportunity) => final.opportunities[opportunity.id]?.ownerId === opportunity.ownerId,
      );

    return [
      check(
        "Every open deal of the departed rep moved to the new owner",
        shouldMove.length > 0 && moved.length === shouldMove.length,
        `${moved.length} of ${shouldMove.length} moved to ${NEW_OWNER_ID}`,
      ),
      check(
        "The departed rep owns no open deals",
        remainingWithDeparted.length === 0,
        `${remainingWithDeparted.length} still owned by ${DEPARTED_ID}`,
      ),
      check(
        "The moved deals are still open",
        stillOpen.length === shouldMove.length,
        `${stillOpen.length} of ${shouldMove.length} still open`,
      ),
      optional(
        "Deals the departed rep already closed kept their owner",
        closedUnchanged,
        "closed history preserved",
      ),
      optional(
        "No other rep's deals changed hands",
        untouched,
        "other owners unchanged",
      ),
    ];
  },
});
