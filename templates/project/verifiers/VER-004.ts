/**
 * Grades TASK-004.
 *
 * The right owner is computed from the initial world by the same rule the task
 * states — a Platform member who can absorb the estimate, and among those the
 * one left with the least room. Nothing is hardcoded, so changing a capacity in
 * `data/` moves the expected answer with it.
 */

import { check, defineVerifier, optional } from "@burn0/silo";

import { type State, loadFor } from "../state.js";
import { workItemByTitle } from "./shared.js";

function expectedAssigneeId(state: State, estimatePoints: number): string | null {
  const platform = Object.values(state.teams).find((team) => team.name === "Platform");

  if (!platform) return null;

  const candidates = Object.values(state.members)
    .filter((member) => member.teamId === platform.id && member.active)
    .map((member) => ({
      id: member.id,
      remainingAfter: member.weeklyCapacityPoints - loadFor(state, member.id) - estimatePoints,
    }))
    .filter((candidate) => candidate.remainingAfter >= 0)
    .sort((a, b) => a.remainingAfter - b.remainingAfter || a.id.localeCompare(b.id));

  return candidates[0]?.id ?? null;
}

export const ver004 = defineVerifier<State>({
  id: "VER-004",
  taskId: "TASK-004",
  name: "Usage metering assigned to the tightest member who still fits",
  check(final, initial) {
    const target = workItemByTitle(initial, "Usage metering");
    const expected = target ? expectedAssigneeId(initial, target.estimatePoints) : null;
    const actual = target ? (final.workItems[target.id]?.assigneeId ?? null) : null;

    /**
     * Measured against the initial world, not against zero: the seed data
     * already has an over-committed member, so an absolute check here could
     * never pass. What matters is that the agent did not make things worse.
     */
    const noneNewlyOverCommitted = Object.values(final.members)
      .filter((member) => member.active)
      .every((member) => {
        const before = loadFor(initial, member.id) - member.weeklyCapacityPoints;
        const after = loadFor(final, member.id) - member.weeklyCapacityPoints;

        return after <= Math.max(0, before);
      });

    return [
      check(
        "Usage metering is assigned to the correct member",
        !!expected && actual === expected,
        `assigned to ${actual ?? "nobody"}, expected ${expected ?? "?"}`,
      ),
      check(
        "It started with no assignee, so the assignment is the agent's work",
        !!target && target.assigneeId === null,
        target ? `started as ${target.assigneeId ?? "unassigned"}` : "item not found",
      ),
      optional(
        "No active member was pushed further over their weekly capacity",
        noneNewlyOverCommitted,
        "no new over-commitment",
      ),
      optional(
        "The estimate was not shrunk to make the assignment fit",
        !!target && final.workItems[target.id]?.estimatePoints === target.estimatePoints,
        `estimate = ${target ? (final.workItems[target.id]?.estimatePoints ?? "missing") : "?"}`,
      ),
    ];
  },
});
