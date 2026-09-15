/**
 * Lookup, summary and mutation helpers shared by every tool domain.
 *
 * Summaries are where derived numbers surface. The agent never sees state, so
 * anything computed — blocked-ness, member load, days in status, whether an
 * item is overdue — has to be put into a tool's output or it does not exist as
 * far as the agent is concerned.
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
  daysBetween,
  daysInStatus,
  isBlocked,
  isDone,
  isOverdue,
  loadFor,
  recordAudit,
  timeLogsForWorkItem,
  totalHoursFor,
  unresolvedDependencies,
  workflowStateOf,
} from "../state.js";
import { toolError } from "./contract.js";

function require_<T>(collection: Record<string, T>, id: string, label: string): T {
  const value = collection[id];

  if (!value) {
    throw toolError("not_found", `${label} "${id}" was not found.`);
  }

  return value;
}

export const requireMember = (state: State, id: string): Member =>
  require_(state.members, id, "Member");

export const requireTeam = (state: State, id: string): Team => require_(state.teams, id, "Team");

export const requireProject = (state: State, id: string): Project =>
  require_(state.projects, id, "Project");

export const requireWorkItem = (state: State, id: string): WorkItem =>
  require_(state.workItems, id, "Work item");

export const requireSprint = (state: State, id: string): Sprint =>
  require_(state.sprints, id, "Sprint");

export const requireWorkflowState = (state: State, id: string): WorkflowState =>
  require_(state.workflowStates, id, "Workflow state");

export const requireTimeLog = (state: State, id: string): TimeLog =>
  require_(state.timeLogs, id, "Time log");

/**
 * The member performing an action.
 *
 * A deactivated member cannot act. That is what makes rehoming their open work
 * a real task rather than a formality — the agent cannot simply keep using them.
 */
export function actor(state: State, id: string): Member {
  const member = requireMember(state, id);

  if (!member.active) {
    throw toolError(
      "not_allowed",
      `Member "${id}" (${member.name}) is deactivated and cannot act.`,
    );
  }

  return member;
}

/** An assignee must exist and still be active — finished work keeps its old owner. */
export function assertAssignable(state: State, id: string): Member {
  const member = requireMember(state, id);

  if (!member.active) {
    throw toolError(
      "not_allowed",
      `Member "${id}" (${member.name}) is deactivated and cannot be assigned work.`,
    );
  }

  return member;
}

/**
 * Refuses an assignment that would push a member past their weekly capacity.
 *
 * Capacity is the point of the rule: an over-committed sprint is the failure
 * this world is meant to make visible, so the tool will not create one silently.
 */
export function assertWithinCapacity(state: State, member: Member, extraPoints: number): void {
  const load = loadFor(state, member.id);

  if (load + extraPoints > member.weeklyCapacityPoints) {
    throw toolError(
      "not_allowed",
      `${member.name} (${member.id}) is committed to ${load} of ${member.weeklyCapacityPoints} points; adding ${extraPoints} more would over-commit them by ${
        load + extraPoints - member.weeklyCapacityPoints
      }.`,
      {
        memberId: member.id,
        currentLoad: load,
        weeklyCapacityPoints: member.weeklyCapacityPoints,
        additionalPoints: extraPoints,
      },
    );
  }
}

/**
 * Refuses to finish a work item while a dependency is still open.
 *
 * Blocked-ness is computed from the dependencies every time rather than read
 * from a flag, so closing the dependency first is all it takes to unblock.
 */
export function assertDependenciesResolved(state: State, item: WorkItem): void {
  const unresolved = unresolvedDependencies(state, item);

  if (unresolved.length > 0) {
    throw toolError(
      "not_allowed",
      `${item.id} depends on ${unresolved
        .map((dependency) => dependency.id)
        .join(", ")}, which ${unresolved.length === 1 ? "is" : "are"} not done yet.`,
      { workItemId: item.id, unresolved: unresolved.map((dependency) => dependency.id) },
    );
  }
}

export function audit(
  state: State,
  actorMemberId: string,
  action: string,
  entityType: string,
  entityId: string,
  detail: string,
): AuditEvent {
  return recordAudit(state, { actorMemberId, action, entityType, entityId, detail });
}

// --- summaries -------------------------------------------------------------

export function memberSummary(state: State, member: Member) {
  const load = loadFor(state, member.id);

  return {
    id: member.id,
    name: member.name,
    email: member.email,
    role: member.role,
    teamId: member.teamId,
    teamName: member.teamId ? (state.teams[member.teamId]?.name ?? null) : null,
    weeklyCapacityPoints: member.weeklyCapacityPoints,
    assignedPoints: load,
    remainingCapacityPoints: member.weeklyCapacityPoints - load,
    overCapacity: load > member.weeklyCapacityPoints,
    active: member.active,
  };
}

export function teamSummary(state: State, team: Team) {
  return {
    id: team.id,
    name: team.name,
    leadId: team.leadId,
    leadName: team.leadId ? (state.members[team.leadId]?.name ?? null) : null,
    memberCount: Object.values(state.members).filter((member) => member.teamId === team.id).length,
  };
}

export function projectSummary(state: State, project: Project) {
  const items = Object.values(state.workItems).filter((item) => item.projectId === project.id);
  const open = items.filter((item) => !isDone(state, item));

  return {
    id: project.id,
    name: project.name,
    key: project.key,
    status: project.status,
    leadId: project.leadId,
    leadName: state.members[project.leadId]?.name ?? null,
    startDate: project.startDate,
    targetDate: project.targetDate,
    workItemCount: items.length,
    openWorkItemCount: open.length,
    openPoints: open.reduce((total, item) => total + item.estimatePoints, 0),
  };
}

export function sprintSummary(state: State, sprint: Sprint) {
  const items = Object.values(state.workItems).filter((item) => item.sprintId === sprint.id);
  const done = items.filter((item) => isDone(state, item));

  return {
    id: sprint.id,
    name: sprint.name,
    projectId: sprint.projectId,
    projectName: state.projects[sprint.projectId]?.name ?? null,
    startDate: sprint.startDate,
    endDate: sprint.endDate,
    status: sprint.status,
    workItemCount: items.length,
    completedWorkItemCount: done.length,
    scopePoints: items.reduce((total, item) => total + item.estimatePoints, 0),
    completedPoints: done.reduce((total, item) => total + item.estimatePoints, 0),
    daysRemaining: daysBetween(state.now, sprint.endDate),
  };
}

/**
 * A work item as the agent sees it.
 *
 * `blocked`, `daysInStatus` and `overdue` are computed on every read rather
 * than stored, so they stay correct after the agent closes a dependency or
 * moves an item.
 */
export function workItemSummary(state: State, item: WorkItem) {
  const workflowState = workflowStateOf(state, item);

  return {
    id: item.id,
    title: item.title,
    type: item.type,
    status: item.status,
    statusName: workflowState?.name ?? null,
    done: isDone(state, item),
    priority: item.priority,
    assigneeId: item.assigneeId,
    assigneeName: item.assigneeId ? (state.members[item.assigneeId]?.name ?? null) : null,
    projectId: item.projectId,
    projectKey: state.projects[item.projectId]?.key ?? null,
    sprintId: item.sprintId,
    sprintName: item.sprintId ? (state.sprints[item.sprintId]?.name ?? null) : null,
    estimatePoints: item.estimatePoints,
    createdDate: item.createdDate,
    statusEnteredDate: item.statusEnteredDate,
    daysInStatus: daysInStatus(state, item),
    dueDate: item.dueDate,
    overdue: isOverdue(state, item),
    parentId: item.parentId,
    dependsOn: [...item.dependsOn],
    blocked: isBlocked(state, item),
    unresolvedDependencies: unresolvedDependencies(state, item).map((dependency) => dependency.id),
    commentCount: item.comments.length,
  };
}

export function workflowStateSummary(workflowState: WorkflowState) {
  return {
    id: workflowState.id,
    name: workflowState.name,
    order: workflowState.order,
    isDone: workflowState.isDone,
    isBlockedState: workflowState.isBlockedState,
  };
}

export function timeLogSummary(state: State, log: TimeLog) {
  return {
    id: log.id,
    workItemId: log.workItemId,
    workItemTitle: state.workItems[log.workItemId]?.title ?? null,
    memberId: log.memberId,
    memberName: state.members[log.memberId]?.name ?? null,
    date: log.date,
    hours: log.hours,
  };
}

/** Hours logged against one work item, computed on each read. */
export function hoursOnWorkItem(state: State, workItemId: string): number {
  return totalHoursFor(state, timeLogsForWorkItem(state, workItemId));
}
