/**
 * Grades TASK-007.
 *
 * Both halves of the turnover are required. Closing the old sprint without
 * starting the new one leaves the project with nothing running, which is the
 * failure this task exists to catch.
 */

import { check, defineVerifier, optional } from "@burn0/silo";

import type { State } from "../state.js";
import { sprintIdByName } from "./shared.js";

export const ver007 = defineVerifier<State>({
  id: "VER-007",
  taskId: "TASK-007",
  name: "Atlas sprint closed out and the next one started",
  check(final, initial) {
    const finishedId = sprintIdByName(initial, "Atlas Sprint 12");
    const nextId = sprintIdByName(initial, "Atlas Sprint 13");

    const finished = finishedId ? final.sprints[finishedId] : undefined;
    const next = nextId ? final.sprints[nextId] : undefined;

    const carriedOverKept = Object.values(initial.workItems)
      .filter((item) => item.sprintId === finishedId)
      .every((item) => final.workItems[item.id]?.sprintId === finishedId);

    return [
      check(
        "The finished sprint is marked completed",
        finished?.status === "completed",
        `status = ${finished?.status ?? "missing"}`,
      ),
      check(
        "The next sprint is running",
        next?.status === "active",
        `status = ${next?.status ?? "missing"}`,
      ),
      check(
        "Exactly one Atlas sprint is running",
        Object.values(final.sprints).filter(
          (sprint) => sprint.projectId === next?.projectId && sprint.status === "active",
        ).length === 1,
        "one active sprint on the project",
      ),
      optional(
        "Unfinished work stayed attached to the sprint it was in",
        carriedOverKept,
        "carry-over preserved",
      ),
    ];
  },
});
