/**
 * Builds the project-tracking world each rollout starts from.
 *
 * `data/` holds facts: ids, titles, status ids, estimates, dates, capacities.
 * Nothing here computes blocked-ness, member load or sprint velocity — all
 * three depend on things the agent changes mid-rollout (a dependency closing,
 * an item being reassigned), so they are pure helpers in `state.ts` surfaced
 * through tool output rather than fields baked in at load.
 *
 * Node caches imported JSON modules for the life of the process, so the
 * assembled world is cloned before it is handed to a rollout.
 */

import {
  type AuditEvent,
  type Member,
  type Project,
  type Sprint,
  type State,
  type Team,
  type TimeLog,
  type WorkItem,
  type WorkflowState,
  indexById,
} from "./state.js";

import auditLogData from "./data/auditLog.json" with { type: "json" };
import membersData from "./data/members.json" with { type: "json" };
import projectsData from "./data/projects.json" with { type: "json" };
import sequencesData from "./data/sequences.json" with { type: "json" };
import sprintsData from "./data/sprints.json" with { type: "json" };
import teamsData from "./data/teams.json" with { type: "json" };
import timeLogsData from "./data/timeLogs.json" with { type: "json" };
import workItemsData from "./data/workItems.json" with { type: "json" };
import workflowStatesData from "./data/workflowStates.json" with { type: "json" };

/**
 * The date every rollout starts from.
 *
 * Fixed rather than `new Date()` so that "overdue", "days in status" and every
 * sprint figure are reproducible. A real clock would make grading depend on
 * when the test ran.
 */
export const SIMULATION_NOW = "2026-03-16";

export function createState(): State {
  return structuredClone({
    now: SIMULATION_NOW,
    projects: indexById(projectsData as Project[]),
    workItems: indexById(workItemsData as WorkItem[]),
    sprints: indexById(sprintsData as Sprint[]),
    members: indexById(membersData as Member[]),
    teams: indexById(teamsData as Team[]),
    workflowStates: indexById(workflowStatesData as WorkflowState[]),
    timeLogs: indexById(timeLogsData as TimeLog[]),
    auditLog: auditLogData as AuditEvent[],
    sequences: sequencesData as Record<string, number>,
  });
}
