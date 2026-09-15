/**
 * Read-only rollups over the plan.
 *
 * Everything here is computed from the live world on each call. Nothing is
 * cached and nothing is stored, so a report taken after the agent has closed a
 * dependency or reassigned an item reflects the change.
 */

import {
  daysBetween,
  daysInStatus,
  isBlocked,
  isDone,
  isOverdue,
  loadFor,
  timeLogsForWorkItem,
  totalHoursFor,
  unresolvedDependencies,
  velocityForSprint,
  workItemsForSprint,
} from "../state.js";
import {
  S,
  defineTool,
  readBoolean,
  readOptionalString,
  readString,
  schema,
} from "./contract.js";
import { requireMember, requireProject, requireSprint } from "./helpers.js";

export const reportingTools = [
  defineTool({
    name: "sprint_burndown",
    description:
      "Where a sprint stands: total scope, points completed, points remaining, and how many days are left against the simulation date.",
    inputSchema: schema({ sprintId: S.string("Sprint ID.") }, ["sprintId"]),
    run(state, input) {
      const sprint = requireSprint(state, readString(input, "sprintId"));
      const items = workItemsForSprint(state, sprint.id);
      const done = items.filter((item) => isDone(state, item));
      const remaining = items.filter((item) => !isDone(state, item));

      const scopePoints = items.reduce((total, item) => total + item.estimatePoints, 0);
      const completedPoints = done.reduce((total, item) => total + item.estimatePoints, 0);

      return {
        sprintId: sprint.id,
        name: sprint.name,
        projectId: sprint.projectId,
        status: sprint.status,
        startDate: sprint.startDate,
        endDate: sprint.endDate,
        daysRemaining: daysBetween(state.now, sprint.endDate),
        scopePoints,
        completedPoints,
        remainingPoints: scopePoints - completedPoints,
        percentComplete:
          scopePoints === 0 ? null : Math.round((completedPoints / scopePoints) * 1000) / 10,
        remainingWorkItems: remaining.map((item) => ({
          id: item.id,
          title: item.title,
          status: item.status,
          statusName: state.workflowStates[item.status]?.name ?? null,
          assigneeId: item.assigneeId,
          estimatePoints: item.estimatePoints,
          blocked: isBlocked(state, item),
        })),
      };
    },
  }),

  defineTool({
    name: "member_load",
    description:
      "Committed points against weekly capacity for each member, with how much room is left. Load counts every unfinished item assigned to them, so it moves as work is assigned or closed.",
    inputSchema: schema({
      teamId: S.string("Restrict to one team."),
      activeOnly: S.boolean("Only members who are still active (default false)."),
    }),
    run(state, input) {
      const teamId = readOptionalString(input, "teamId");
      const activeOnly = readBoolean(input, "activeOnly", false);

      const members = Object.values(state.members)
        .filter((member) => (teamId ? member.teamId === teamId : true))
        .filter((member) => (activeOnly ? member.active : true))
        .sort((a, b) => a.id.localeCompare(b.id));

      return {
        teamId: teamId ?? null,
        activeOnly,
        results: members.map((member) => {
          const load = loadFor(state, member.id);

          return {
            memberId: member.id,
            name: member.name,
            role: member.role,
            teamId: member.teamId,
            active: member.active,
            weeklyCapacityPoints: member.weeklyCapacityPoints,
            assignedPoints: load,
            remainingCapacityPoints: member.weeklyCapacityPoints - load,
            overCapacityBy: Math.max(0, load - member.weeklyCapacityPoints),
            utilisationPercent:
              member.weeklyCapacityPoints === 0
                ? null
                : Math.round((load / member.weeklyCapacityPoints) * 1000) / 10,
          };
        }),
      };
    },
  }),

  defineTool({
    name: "blocked_items",
    description:
      "Work items held up by a dependency that is not finished, longest-stuck first. Blocked-ness is computed from the dependencies themselves, not from a stored flag.",
    inputSchema: schema({
      projectId: S.string("Restrict to one project."),
    }),
    run(state, input) {
      const projectId = readOptionalString(input, "projectId");

      if (projectId) requireProject(state, projectId);

      const rows = Object.values(state.workItems)
        .filter((item) => isBlocked(state, item))
        .filter((item) => (projectId ? item.projectId === projectId : true))
        .sort((a, b) => daysInStatus(state, b) - daysInStatus(state, a) || a.id.localeCompare(b.id));

      const byProject = new Map<string, number>();

      for (const item of rows) {
        byProject.set(item.projectId, (byProject.get(item.projectId) ?? 0) + 1);
      }

      return {
        projectId: projectId ?? null,
        count: rows.length,
        blockedPoints: rows.reduce((total, item) => total + item.estimatePoints, 0),
        countByProject: [...byProject.entries()]
          .map(([id, count]) => ({
            projectId: id,
            projectName: state.projects[id]?.name ?? null,
            count,
          }))
          .sort((a, b) => b.count - a.count || a.projectId.localeCompare(b.projectId)),
        workItems: rows.map((item) => ({
          id: item.id,
          title: item.title,
          projectId: item.projectId,
          assigneeId: item.assigneeId,
          assigneeName: item.assigneeId ? (state.members[item.assigneeId]?.name ?? null) : null,
          estimatePoints: item.estimatePoints,
          daysInStatus: daysInStatus(state, item),
          blockedBy: unresolvedDependencies(state, item).map((dependency) => dependency.id),
        })),
      };
    },
  }),

  defineTool({
    name: "overdue_items",
    description:
      "Unfinished work items whose due date has passed, most overdue first. Optionally restrict to items held by members who are still active.",
    inputSchema: schema({
      projectId: S.string("Restrict to one project."),
      activeAssigneesOnly: S.boolean(
        "Only items assigned to a member who is still active (default false).",
      ),
    }),
    run(state, input) {
      const projectId = readOptionalString(input, "projectId");
      const activeAssigneesOnly = readBoolean(input, "activeAssigneesOnly", false);

      if (projectId) requireProject(state, projectId);

      const rows = Object.values(state.workItems)
        .filter((item) => isOverdue(state, item))
        .filter((item) => (projectId ? item.projectId === projectId : true))
        .filter((item) =>
          activeAssigneesOnly
            ? !!item.assigneeId && (state.members[item.assigneeId]?.active ?? false)
            : true,
        )
        .sort(
          (a, b) =>
            daysBetween(a.dueDate ?? state.now, state.now) -
              daysBetween(b.dueDate ?? state.now, state.now) || a.id.localeCompare(b.id),
        )
        .reverse();

      const byAssignee = new Map<string, number>();

      for (const item of rows) {
        const key = item.assigneeId ?? "unassigned";
        byAssignee.set(key, (byAssignee.get(key) ?? 0) + 1);
      }

      return {
        projectId: projectId ?? null,
        activeAssigneesOnly,
        count: rows.length,
        overduePoints: rows.reduce((total, item) => total + item.estimatePoints, 0),
        countByAssignee: [...byAssignee.entries()]
          .map(([memberId, count]) => ({
            memberId,
            name: state.members[memberId]?.name ?? null,
            active: state.members[memberId]?.active ?? null,
            count,
          }))
          .sort((a, b) => b.count - a.count || a.memberId.localeCompare(b.memberId)),
        workItems: rows.map((item) => ({
          id: item.id,
          title: item.title,
          projectId: item.projectId,
          assigneeId: item.assigneeId,
          assigneeName: item.assigneeId ? (state.members[item.assigneeId]?.name ?? null) : null,
          assigneeActive: item.assigneeId
            ? (state.members[item.assigneeId]?.active ?? null)
            : null,
          estimatePoints: item.estimatePoints,
          dueDate: item.dueDate,
          daysOverdue: item.dueDate ? daysBetween(item.dueDate, state.now) : null,
        })),
      };
    },
  }),

  defineTool({
    name: "velocity_report",
    description:
      "Points delivered per sprint, earliest first. Velocity counts the estimate of every done item in the sprint, so carry-over shows up as the gap between scope and delivered.",
    inputSchema: schema({
      projectId: S.string("Restrict to one project."),
      completedOnly: S.boolean("Only sprints that have been completed (default false)."),
    }),
    run(state, input) {
      const projectId = readOptionalString(input, "projectId");
      const completedOnly = readBoolean(input, "completedOnly", false);

      if (projectId) requireProject(state, projectId);

      const sprints = Object.values(state.sprints)
        .filter((sprint) => (projectId ? sprint.projectId === projectId : true))
        .filter((sprint) => (completedOnly ? sprint.status === "completed" : true))
        .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id));

      const rows = sprints.map((sprint) => {
        const items = workItemsForSprint(state, sprint.id);
        const unfinished = items.filter((item) => !isDone(state, item));
        const delivered = velocityForSprint(state, sprint.id);

        return {
          sprintId: sprint.id,
          name: sprint.name,
          projectId: sprint.projectId,
          status: sprint.status,
          startDate: sprint.startDate,
          endDate: sprint.endDate,
          scopePoints: items.reduce((total, item) => total + item.estimatePoints, 0),
          deliveredPoints: delivered,
          carriedOverPoints: unfinished.reduce((total, item) => total + item.estimatePoints, 0),
          carriedOverWorkItemIds: unfinished.map((item) => item.id),
        };
      });

      const completed = rows.filter((row) => row.status === "completed");

      return {
        projectId: projectId ?? null,
        completedOnly,
        count: rows.length,
        averageDeliveredPoints:
          completed.length === 0
            ? null
            : Math.round(
                (completed.reduce((total, row) => total + row.deliveredPoints, 0) /
                  completed.length) *
                  10,
              ) / 10,
        sprints: rows,
      };
    },
  }),

  defineTool({
    name: "project_time_report",
    description:
      "Hours logged against a project, in total and per work item, with who logged them.",
    inputSchema: schema({ projectId: S.string("Project ID.") }, ["projectId"]),
    run(state, input) {
      const project = requireProject(state, readString(input, "projectId"));

      const items = Object.values(state.workItems)
        .filter((item) => item.projectId === project.id)
        .sort((a, b) => a.id.localeCompare(b.id));

      const logs = items.flatMap((item) => timeLogsForWorkItem(state, item.id));
      const byMember = new Map<string, number>();

      for (const log of logs) {
        byMember.set(log.memberId, (byMember.get(log.memberId) ?? 0) + log.hours);
      }

      return {
        projectId: project.id,
        name: project.name,
        totalHours: totalHoursFor(state, logs),
        byMember: [...byMember.entries()]
          .map(([memberId, hours]) => ({
            memberId,
            name: state.members[memberId]?.name ?? null,
            hours: Math.round(hours * 10) / 10,
          }))
          .sort((a, b) => a.memberId.localeCompare(b.memberId)),
        byWorkItem: items
          .map((item) => ({
            workItemId: item.id,
            title: item.title,
            hours: totalHoursFor(state, timeLogsForWorkItem(state, item.id)),
          }))
          .filter((row) => row.hours > 0),
      };
    },
  }),

  defineTool({
    name: "workload_forecast",
    description:
      "Unfinished points per project, split by whether they are blocked, overdue, unassigned or held by a member who is no longer active.",
    inputSchema: schema({}),
    run(state) {
      const projects = Object.values(state.projects).sort((a, b) => a.id.localeCompare(b.id));

      return {
        results: projects.map((project) => {
          const open = Object.values(state.workItems)
            .filter((item) => item.projectId === project.id)
            .filter((item) => !isDone(state, item));

          const points = (items: typeof open) =>
            items.reduce((total, item) => total + item.estimatePoints, 0);

          return {
            projectId: project.id,
            name: project.name,
            status: project.status,
            openCount: open.length,
            openPoints: points(open),
            blockedPoints: points(open.filter((item) => isBlocked(state, item))),
            overduePoints: points(open.filter((item) => isOverdue(state, item))),
            unassignedPoints: points(open.filter((item) => item.assigneeId === null)),
            inactiveAssigneePoints: points(
              open.filter(
                (item) =>
                  !!item.assigneeId && !(state.members[item.assigneeId]?.active ?? false),
              ),
            ),
          };
        }),
      };
    },
  }),

  defineTool({
    name: "member_capacity_check",
    description:
      "Whether a member could take on a given number of extra points without going over their weekly capacity. Use this before assigning work.",
    inputSchema: schema(
      {
        memberId: S.string("Member ID."),
        additionalPoints: S.integer("Points you want to add to their plate.", { minimum: 0 }),
      },
      ["memberId", "additionalPoints"],
    ),
    run(state, input) {
      const member = requireMember(state, readString(input, "memberId"));
      const additionalPoints = Number(input["additionalPoints"] ?? 0);
      const load = loadFor(state, member.id);

      return {
        memberId: member.id,
        name: member.name,
        active: member.active,
        weeklyCapacityPoints: member.weeklyCapacityPoints,
        assignedPoints: load,
        additionalPoints,
        wouldFit: member.active && load + additionalPoints <= member.weeklyCapacityPoints,
        remainingCapacityPoints: member.weeklyCapacityPoints - load,
      };
    },
  }),
];
