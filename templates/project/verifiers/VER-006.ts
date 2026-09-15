/**
 * Grades TASK-006.
 *
 * The set of items that had to move is derived from the initial world by the
 * rule the task states — Atlas items in the Backlog state with no assignee —
 * rather than being listed by id.
 */

import { check, defineVerifier, optional } from "@burn0/silo";

import type { State } from "../state.js";
import { projectIdByKey, sprintIdByName } from "./shared.js";

export const ver006 = defineVerifier<State>({
  id: "VER-006",
  taskId: "TASK-006",
  name: "Unassigned Atlas backlog moved into the next sprint",
  check(final, initial) {
    const projectId = projectIdByKey(initial, "ATL");
    const sprintId = sprintIdByName(initial, "Atlas Sprint 13");

    const backlogState = Object.values(initial.workflowStates).find(
      (workflowState) => workflowState.name === "Backlog",
    );

    const shouldMove = Object.values(initial.workItems).filter(
      (item) =>
        item.projectId === projectId &&
        item.status === backlogState?.id &&
        item.assigneeId === null,
    );

    const moved = shouldMove.filter((item) => final.workItems[item.id]?.sprintId === sprintId);

    const noStrays = Object.values(final.workItems)
      .filter((item) => item.sprintId === sprintId)
      .every((item) => shouldMove.some((candidate) => candidate.id === item.id));

    return [
      check(
        "Every unassigned Atlas backlog item is in the next sprint",
        shouldMove.length > 0 && moved.length === shouldMove.length,
        `${moved.length} of ${shouldMove.length} moved into ${sprintId ?? "?"}`,
      ),
      check(
        "The sprint started empty, so the items are the agent's work",
        Object.values(initial.workItems).every((item) => item.sprintId !== sprintId),
        "sprint had no work items before the rollout",
      ),
      optional(
        "Nothing else was swept into that sprint",
        noStrays,
        "only the backlog items landed there",
      ),
      optional(
        "The moved items were not reassigned or closed on the way",
        moved.every((item) => final.workItems[item.id]?.status === item.status),
        "statuses unchanged",
      ),
    ];
  },
});
