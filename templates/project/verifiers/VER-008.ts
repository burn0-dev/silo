/**
 * Grades TASK-008.
 *
 * The work that had to be finished first is derived from the initial world, so
 * the verifier keeps working if another unfinished item is added to that
 * project — the agent would then have to close that one too.
 */

import { check, defineVerifier, optional } from "@burn0/silo";

import { type State, isDone } from "../state.js";
import { isDoneIn, projectIdByKey } from "./shared.js";

export const ver008 = defineVerifier<State>({
  id: "VER-008",
  taskId: "TASK-008",
  name: "Ledger migration finished and the project closed",
  check(final, initial) {
    const projectId = projectIdByKey(initial, "LED");

    const mustFinish = Object.values(initial.workItems).filter(
      (item) => item.projectId === projectId && !isDone(initial, item),
    );

    const finished = mustFinish.filter((item) => isDoneIn(final, item.id));

    const otherProjectsUntouched = Object.values(initial.projects)
      .filter((project) => project.id !== projectId)
      .every((project) => final.projects[project.id]?.status === project.status);

    return [
      check(
        "The project is marked completed",
        !!projectId && final.projects[projectId]?.status === "completed",
        `status = ${projectId ? (final.projects[projectId]?.status ?? "missing") : "?"}`,
      ),
      check(
        "Every outstanding work item on it was finished first",
        mustFinish.length > 0 && finished.length === mustFinish.length,
        `${finished.length} of ${mustFinish.length} finished`,
      ),
      check(
        "The project was not already completed before the rollout",
        !!projectId && initial.projects[projectId]?.status !== "completed",
        `started as ${projectId ? (initial.projects[projectId]?.status ?? "?") : "?"}`,
      ),
      optional(
        "The outstanding work was finished rather than deleted",
        mustFinish.every((item) => final.workItems[item.id] !== undefined),
        "work items still present",
      ),
      optional(
        "No other project was closed",
        otherProjectsUntouched,
        "other project statuses unchanged",
      ),
    ];
  },
});
