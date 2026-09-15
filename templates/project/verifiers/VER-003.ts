/**
 * Grades TASK-003.
 *
 * The set of work that had to move is derived from the initial world, so adding
 * another stranded item to the seed data does not weaken this verifier. Deriving
 * it from the final world instead would be circular: an agent that deleted the
 * items would pass.
 */

import { check, defineVerifier, optional } from "@burn0/silo";

import { type State, isDone } from "../state.js";
import { memberIdByName } from "./shared.js";

export const ver003 = defineVerifier<State>({
  id: "VER-003",
  taskId: "TASK-003",
  name: "Departed member's unfinished work moved to the new owner",
  check(final, initial) {
    const departedId = memberIdByName(initial, "Devon Ito");
    const newOwnerId = memberIdByName(initial, "Farid Haddad");

    const shouldMove = Object.values(initial.workItems).filter(
      (item) => item.assigneeId === departedId && !isDone(initial, item),
    );

    const moved = shouldMove.filter(
      (item) => final.workItems[item.id]?.assigneeId === newOwnerId,
    );

    const stillOpen = shouldMove.filter((item) => {
      const finalItem = final.workItems[item.id];

      return !!finalItem && !isDone(final, finalItem);
    });

    const remainingWithDeparted = Object.values(final.workItems).filter(
      (item) => item.assigneeId === departedId && !isDone(final, item),
    );

    const finishedWorkKeptOwner = Object.values(initial.workItems)
      .filter((item) => item.assigneeId === departedId && isDone(initial, item))
      .every((item) => final.workItems[item.id]?.assigneeId === departedId);

    const othersUntouched = Object.values(initial.workItems)
      .filter((item) => item.assigneeId !== departedId)
      .every((item) => final.workItems[item.id]?.assigneeId === item.assigneeId);

    return [
      check(
        "Every unfinished item of the departed member moved to the new owner",
        shouldMove.length > 0 && moved.length === shouldMove.length,
        `${moved.length} of ${shouldMove.length} moved to ${newOwnerId ?? "?"}`,
      ),
      check(
        "The departed member holds no unfinished work",
        remainingWithDeparted.length === 0,
        `${remainingWithDeparted.length} still assigned to ${departedId ?? "?"}`,
      ),
      check(
        "The moved items are still unfinished, not closed to make them go away",
        stillOpen.length === shouldMove.length,
        `${stillOpen.length} of ${shouldMove.length} still open`,
      ),
      optional(
        "Work the departed member had already finished kept their name on it",
        finishedWorkKeptOwner,
        "finished history preserved",
      ),
      optional(
        "Nobody else's work changed hands",
        othersUntouched,
        "other assignees unchanged",
      ),
    ];
  },
});
