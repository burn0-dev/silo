/**
 * Project-tracking environment state.
 *
 * The shape of the simulated world, plus pure helpers that read it. No data
 * lives here and nothing here builds a world — that is `environment.ts`.
 *
 * Two things are derived rather than stored, on purpose:
 *
 * - `isBlocked` — a work item is blocked when any of its `dependsOn` items is
 *   not yet done. The agent can close a dependency mid-rollout, so a stored
 *   "blocked" flag would go stale the moment it did.
 * - `loadFor` — a member's assigned, not-done estimate points. The agent
 *   reassigns and closes work items constantly, so this has to be computed on
 *   every read rather than cached on the member record.
 */

export type WorkItemType = "epic" | "story" | "bug" | "task";
export type WorkItemPriority = "low" | "medium" | "high" | "urgent";

export type Comment = {
  id: string;
  authorId: string;
  body: string;
  createdDate: string;
};

export type WorkItem = {
  id: string;
  title: string;
  type: WorkItemType;
  /** Id of a row in `workflowStates`. Done-ness and blocked-ness live there. */
  status: string;
  priority: WorkItemPriority;
  assigneeId: string | null;
  projectId: string;
  sprintId: string | null;
  estimatePoints: number;
  createdDate: string;
  /** When the item entered its current status — staleness reads this. */
  statusEnteredDate: string;
  dueDate: string | null;
  parentId: string | null;
  /** Ids of other work items that must be done before this one can be. */
  dependsOn: string[];
  comments: Comment[];
};

export type WorkflowState = {
  id: string;
  name: string;
  /** Position in the workflow, ascending. */
  order: number;
  isDone: boolean;
  isBlockedState: boolean;
};

export type ProjectStatus = "active" | "on_hold" | "completed";

export type Project = {
  id: string;
  name: string;
  key: string;
  status: ProjectStatus;
  leadId: string;
  startDate: string;
  targetDate: string;
};

export type SprintStatus = "planned" | "active" | "completed";

export type Sprint = {
  id: string;
  name: string;
  projectId: string;
  startDate: string;
  endDate: string;
  status: SprintStatus;
};

export type MemberRole = "engineer" | "lead" | "manager";

export type Member = {
  id: string;
  name: string;
  email: string;
  role: MemberRole;
  teamId: string | null;
  weeklyCapacityPoints: number;
  active: boolean;
};

export type Team = {
  id: string;
  name: string;
  leadId: string | null;
};

export type TimeLog = {
  id: string;
  workItemId: string;
  memberId: string;
  date: string;
  hours: number;
};

export type AuditEvent = {
  id: string;
  at: string;
  actorMemberId: string;
  action: string;
  entityType: string;
  entityId: string;
  detail: string;
};

export type State = {
  /** The simulation clock. Every overdue / staleness judgement reads this. */
  now: string;
  projects: Record<string, Project>;
  workItems: Record<string, WorkItem>;
  sprints: Record<string, Sprint>;
  members: Record<string, Member>;
  teams: Record<string, Team>;
  workflowStates: Record<string, WorkflowState>;
  timeLogs: Record<string, TimeLog>;
  auditLog: AuditEvent[];
  sequences: Record<string, number>;
};

// --- dates -------------------------------------------------------------

export function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from.slice(0, 10)}T00:00:00.000Z`);
  const end = Date.parse(`${to.slice(0, 10)}T00:00:00.000Z`);

  return Math.round((end - start) / 86_400_000);
}

export function ageInDays(state: State, createdDate: string): number {
  return daysBetween(createdDate, state.now);
}

// --- workflow ------------------------------------------------------------

export function workflowStatesInOrder(state: State): WorkflowState[] {
  return Object.values(state.workflowStates).sort((a, b) => a.order - b.order);
}

/** The workflow state a work item is in. Null for a dangling status id. */
export function workflowStateOf(state: State, item: WorkItem): WorkflowState | null {
  return state.workflowStates[item.status] ?? null;
}

export function isDone(state: State, item: WorkItem): boolean {
  return workflowStateOf(state, item)?.isDone ?? false;
}

/**
 * A work item is blocked when any dependency has not reached a done state.
 *
 * Always computed, never stored: the agent can close a dependency mid-rollout,
 * and a cached flag would then be wrong until something else recalculated it.
 */
export function isBlocked(state: State, item: WorkItem): boolean {
  return item.dependsOn.some((depId) => {
    const dependency = state.workItems[depId];

    return dependency ? !isDone(state, dependency) : false;
  });
}

export function unresolvedDependencies(state: State, item: WorkItem): WorkItem[] {
  return item.dependsOn
    .map((depId) => state.workItems[depId])
    .filter((dependency): dependency is WorkItem => !!dependency && !isDone(state, dependency));
}

export function daysInStatus(state: State, item: WorkItem): number {
  return daysBetween(item.statusEnteredDate, state.now);
}

/** A work item with a due date that has passed and is not yet done. */
export function isOverdue(state: State, item: WorkItem): boolean {
  return !isDone(state, item) && item.dueDate !== null && daysBetween(item.dueDate, state.now) > 0;
}

// --- lookups ---------------------------------------------------------------

export function workItemsForProject(state: State, projectId: string): WorkItem[] {
  return Object.values(state.workItems)
    .filter((item) => item.projectId === projectId)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function workItemsForSprint(state: State, sprintId: string): WorkItem[] {
  return Object.values(state.workItems)
    .filter((item) => item.sprintId === sprintId)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function workItemsForAssignee(state: State, assigneeId: string): WorkItem[] {
  return Object.values(state.workItems)
    .filter((item) => item.assigneeId === assigneeId)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function sprintsForProject(state: State, projectId: string): Sprint[] {
  return Object.values(state.sprints)
    .filter((sprint) => sprint.projectId === projectId)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}

export function timeLogsForWorkItem(state: State, workItemId: string): TimeLog[] {
  return Object.values(state.timeLogs)
    .filter((log) => log.workItemId === workItemId)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function timeLogsForMember(state: State, memberId: string): TimeLog[] {
  return Object.values(state.timeLogs)
    .filter((log) => log.memberId === memberId)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function membersForTeam(state: State, teamId: string): Member[] {
  return Object.values(state.members)
    .filter((member) => member.teamId === teamId)
    .sort((a, b) => a.id.localeCompare(b.id));
}

// --- capacity ----------------------------------------------------------

/**
 * A member's assigned, not-yet-done estimate points.
 *
 * A helper rather than a field: assignment and closing both change it, and a
 * stored copy would be wrong the instant either happened.
 */
export function loadFor(state: State, memberId: string): number {
  return workItemsForAssignee(state, memberId)
    .filter((item) => !isDone(state, item))
    .reduce((total, item) => total + item.estimatePoints, 0);
}

/** How far over weekly capacity this member's current load sits (0 if not over). */
export function overCapacityBy(state: State, memberId: string, extraPoints = 0): number {
  const member = state.members[memberId];
  if (!member) return 0;

  return Math.max(0, loadFor(state, memberId) + extraPoints - member.weeklyCapacityPoints);
}

// --- reporting -----------------------------------------------------------

/** Points completed for a sprint: the estimate of every done item assigned to it. */
export function velocityForSprint(state: State, sprintId: string): number {
  return workItemsForSprint(state, sprintId)
    .filter((item) => isDone(state, item))
    .reduce((total, item) => total + item.estimatePoints, 0);
}

/** Total scope for a sprint, done or not — what burndown measures against. */
export function scopeForSprint(state: State, sprintId: string): number {
  return workItemsForSprint(state, sprintId).reduce((total, item) => total + item.estimatePoints, 0);
}

export function totalHoursFor(state: State, logs: TimeLog[]): number {
  return round1(logs.reduce((total, log) => total + log.hours, 0));
}

export function round1(value: number): number {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

// --- ids and audit ---------------------------------------------------------

export function formatId(prefix: string, value: number, pad = 3): string {
  return `${prefix}-${String(value).padStart(pad, "0")}`;
}

/** Next id in a sequence, advancing the counter stored in state. */
export function nextId(state: State, prefix: string, pad = 3): string {
  const next = (state.sequences[prefix] ?? 0) + 1;
  state.sequences[prefix] = next;

  return formatId(prefix, next, pad);
}

export function indexById<T extends { id: string }>(rows: T[]): Record<string, T> {
  return Object.fromEntries(rows.map((row) => [row.id, row]));
}

export function recordAudit(
  state: State,
  event: Omit<AuditEvent, "id" | "at">,
): AuditEvent {
  const entry: AuditEvent = { id: nextId(state, "AUD", 4), at: state.now, ...event };
  state.auditLog.push(entry);

  return entry;
}
