import {
  isDone,
  nextId,
  timeLogsForMember,
  timeLogsForWorkItem,
  totalHoursFor,
} from "../state.js";
import {
  S,
  defineTool,
  pagingProperties,
  paginate,
  readDate,
  readNumber,
  readOptionalDate,
  readOptionalString,
  readString,
  schema,
  toolError,
} from "./contract.js";
import {
  actor,
  audit,
  hoursOnWorkItem,
  requireMember,
  requireWorkItem,
  timeLogSummary,
} from "./helpers.js";

export const timeTools = [
  defineTool({
    name: "log_time",
    description:
      "Record hours worked on a work item by a member, on a given day. Time can only be logged against work that is not finished.",
    inputSchema: schema(
      {
        workItemId: S.string("Work item the time was spent on."),
        memberId: S.string("Member who did the work."),
        hours: S.number("Hours worked, greater than zero.", { minimum: 0.1, maximum: 24 }),
        date: S.string("Day the work happened, YYYY-MM-DD. Defaults to today."),
        actorMemberId: S.string("Member performing the action."),
      },
      ["workItemId", "memberId", "hours", "actorMemberId"],
    ),
    run(state, input) {
      const actingMember = actor(state, readString(input, "actorMemberId"));
      const item = requireWorkItem(state, readString(input, "workItemId"));
      const member = requireMember(state, readString(input, "memberId"));

      if (isDone(state, item)) {
        throw toolError("not_allowed", `${item.id} is done; time cannot be logged against it.`);
      }

      const log = {
        id: nextId(state, "TL"),
        workItemId: item.id,
        memberId: member.id,
        date: readOptionalDate(input, "date") ?? state.now,
        hours: readNumber(input, "hours", { min: 0.1, max: 24 }),
      };

      state.timeLogs[log.id] = log;
      audit(
        state,
        actingMember.id,
        "log_time",
        "time_log",
        log.id,
        `${member.name} logged ${log.hours}h on ${item.id}.`,
      );

      return { created: timeLogSummary(state, log), hoursOnWorkItem: hoursOnWorkItem(state, item.id) };
    },
  }),

  defineTool({
    name: "list_time_logs",
    description:
      "List time logs, optionally filtered by work item, member or date range, with the total hours they add up to.",
    inputSchema: schema({
      workItemId: S.string("Only time logged against this work item."),
      memberId: S.string("Only time logged by this member."),
      from: S.string("Only logs on or after this date, YYYY-MM-DD."),
      to: S.string("Only logs on or before this date, YYYY-MM-DD."),
      ...pagingProperties,
    }),
    run(state, input) {
      const workItemId = readOptionalString(input, "workItemId");
      const memberId = readOptionalString(input, "memberId");
      const from = readOptionalDate(input, "from");
      const to = readOptionalDate(input, "to");

      if (workItemId) requireWorkItem(state, workItemId);
      if (memberId) requireMember(state, memberId);

      const logs = Object.values(state.timeLogs)
        .filter((log) => (workItemId ? log.workItemId === workItemId : true))
        .filter((log) => (memberId ? log.memberId === memberId : true))
        .filter((log) => (from ? log.date >= from : true))
        .filter((log) => (to ? log.date <= to : true))
        .sort((a, b) => a.id.localeCompare(b.id));

      const page = paginate(logs, input);

      return {
        ...page,
        totalHours: totalHoursFor(state, logs),
        results: page.results.map((log) => timeLogSummary(state, log)),
      };
    },
  }),

  defineTool({
    name: "update_time_log",
    description: "Correct the hours or date on a time log that was entered wrongly.",
    inputSchema: schema(
      {
        timeLogId: S.string("Time log ID, e.g. 'TL-004'."),
        hours: S.number("Corrected hours.", { minimum: 0.1, maximum: 24 }),
        date: S.string("Corrected date, YYYY-MM-DD."),
        actorMemberId: S.string("Member performing the action."),
      },
      ["timeLogId", "actorMemberId"],
    ),
    run(state, input) {
      const actingMember = actor(state, readString(input, "actorMemberId"));
      const logId = readString(input, "timeLogId");
      const log = state.timeLogs[logId];

      if (!log) {
        throw toolError("not_found", `Time log "${logId}" was not found.`);
      }

      const hours = input["hours"] === undefined ? undefined : readNumber(input, "hours", {
        min: 0.1,
        max: 24,
      });

      if (hours !== undefined) log.hours = hours;
      if (input["date"] !== undefined) log.date = readDate(input, "date");

      audit(
        state,
        actingMember.id,
        "update_time_log",
        "time_log",
        log.id,
        `Corrected ${log.id} to ${log.hours}h on ${log.date}.`,
      );

      return { updated: timeLogSummary(state, log) };
    },
  }),

  defineTool({
    name: "member_time_summary",
    description: "Total hours one member has logged, with the work items they logged them against.",
    inputSchema: schema({ memberId: S.string("Member ID.") }, ["memberId"]),
    run(state, input) {
      const member = requireMember(state, readString(input, "memberId"));
      const logs = timeLogsForMember(state, member.id);
      const byWorkItem = new Map<string, number>();

      for (const log of logs) {
        byWorkItem.set(log.workItemId, (byWorkItem.get(log.workItemId) ?? 0) + log.hours);
      }

      return {
        memberId: member.id,
        name: member.name,
        totalHours: totalHoursFor(state, logs),
        byWorkItem: [...byWorkItem.entries()]
          .map(([workItemId, hours]) => ({
            workItemId,
            title: state.workItems[workItemId]?.title ?? null,
            hours: Math.round(hours * 10) / 10,
          }))
          .sort((a, b) => a.workItemId.localeCompare(b.workItemId)),
      };
    },
  }),

  defineTool({
    name: "work_item_time_summary",
    description: "Total hours logged against one work item, broken down by who logged them.",
    inputSchema: schema({ workItemId: S.string("Work item ID.") }, ["workItemId"]),
    run(state, input) {
      const item = requireWorkItem(state, readString(input, "workItemId"));
      const logs = timeLogsForWorkItem(state, item.id);
      const byMember = new Map<string, number>();

      for (const log of logs) {
        byMember.set(log.memberId, (byMember.get(log.memberId) ?? 0) + log.hours);
      }

      return {
        workItemId: item.id,
        title: item.title,
        totalHours: totalHoursFor(state, logs),
        byMember: [...byMember.entries()]
          .map(([memberId, hours]) => ({
            memberId,
            name: state.members[memberId]?.name ?? null,
            hours: Math.round(hours * 10) / 10,
          }))
          .sort((a, b) => a.memberId.localeCompare(b.memberId)),
      };
    },
  }),
];
