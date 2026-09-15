import {
  type SprintStatus,
  isDone,
  nextId,
  sprintsForProject,
  workItemsForSprint,
} from "../state.js";
import {
  S,
  defineTool,
  pagingProperties,
  paginate,
  readDate,
  readOptionalEnum,
  readOptionalString,
  readString,
  schema,
  toolError,
} from "./contract.js";
import {
  actor,
  audit,
  requireProject,
  requireSprint,
  sprintSummary,
  workItemSummary,
} from "./helpers.js";

const sprintStatuses: readonly SprintStatus[] = ["planned", "active", "completed"];

export const sprintTools = [
  defineTool({
    name: "list_sprints",
    description: "List sprints, optionally filtered by project or status, earliest start first.",
    inputSchema: schema({
      projectId: S.string("Only sprints in this project."),
      status: S.enumeration("Only sprints with this status.", sprintStatuses),
      ...pagingProperties,
    }),
    run(state, input) {
      const projectId = readOptionalString(input, "projectId");
      const status = readOptionalEnum(input, "status", sprintStatuses);

      const sprints = Object.values(state.sprints)
        .filter((sprint) => (projectId ? sprint.projectId === projectId : true))
        .filter((sprint) => (status ? sprint.status === status : true))
        .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id));

      const page = paginate(sprints, input);

      return { ...page, results: page.results.map((sprint) => sprintSummary(state, sprint)) };
    },
  }),

  defineTool({
    name: "get_sprint",
    description:
      "Get one sprint with every work item in it, how many points are done and how many remain.",
    inputSchema: schema({ sprintId: S.string("Sprint ID, e.g. 'SPR-002'.") }, ["sprintId"]),
    run(state, input) {
      const sprint = requireSprint(state, readString(input, "sprintId"));
      const items = workItemsForSprint(state, sprint.id);

      return {
        ...sprintSummary(state, sprint),
        remainingPoints: items
          .filter((item) => !isDone(state, item))
          .reduce((total, item) => total + item.estimatePoints, 0),
        workItems: items.map((item) => workItemSummary(state, item)),
      };
    },
  }),

  defineTool({
    name: "create_sprint",
    description: "Plan a new sprint for a project. It starts in the planned state.",
    inputSchema: schema(
      {
        name: S.string("Sprint name."),
        projectId: S.string("Project the sprint belongs to."),
        startDate: S.string("Start date, YYYY-MM-DD."),
        endDate: S.string("End date, YYYY-MM-DD."),
        actorMemberId: S.string("Member performing the action."),
      },
      ["name", "projectId", "startDate", "endDate", "actorMemberId"],
    ),
    run(state, input) {
      const member = actor(state, readString(input, "actorMemberId"));
      const project = requireProject(state, readString(input, "projectId"));

      const startDate = readDate(input, "startDate");
      const endDate = readDate(input, "endDate");

      if (endDate < startDate) {
        throw toolError("invalid_input", "A sprint cannot end before it starts.");
      }

      const sprint = {
        id: nextId(state, "SPR"),
        name: readString(input, "name"),
        projectId: project.id,
        startDate,
        endDate,
        status: "planned" as SprintStatus,
      };

      state.sprints[sprint.id] = sprint;
      audit(state, member.id, "create_sprint", "sprint", sprint.id, `Created ${sprint.name}.`);

      return { created: sprintSummary(state, sprint) };
    },
  }),

  defineTool({
    name: "start_sprint",
    description:
      "Start a planned sprint. A project can only have one sprint running at a time, so finish the current one first.",
    inputSchema: schema(
      {
        sprintId: S.string("Sprint ID."),
        actorMemberId: S.string("Member performing the action."),
      },
      ["sprintId", "actorMemberId"],
    ),
    run(state, input) {
      const member = actor(state, readString(input, "actorMemberId"));
      const sprint = requireSprint(state, readString(input, "sprintId"));

      if (sprint.status !== "planned") {
        throw toolError(
          "invalid_state",
          `Sprint ${sprint.id} is ${sprint.status}; only a planned sprint can be started.`,
        );
      }

      const running = sprintsForProject(state, sprint.projectId).find(
        (candidate) => candidate.status === "active",
      );

      if (running) {
        throw toolError(
          "not_allowed",
          `Sprint ${running.id} (${running.name}) is still running on ${sprint.projectId}; complete it first.`,
          { activeSprintId: running.id },
        );
      }

      sprint.status = "active";
      audit(state, member.id, "start_sprint", "sprint", sprint.id, `Started ${sprint.name}.`);

      return { updated: sprintSummary(state, sprint) };
    },
  }),

  defineTool({
    name: "complete_sprint",
    description:
      "Close out a running sprint. Unfinished work stays attached to it — that is what makes carry-over visible afterwards.",
    inputSchema: schema(
      {
        sprintId: S.string("Sprint ID."),
        actorMemberId: S.string("Member performing the action."),
      },
      ["sprintId", "actorMemberId"],
    ),
    run(state, input) {
      const member = actor(state, readString(input, "actorMemberId"));
      const sprint = requireSprint(state, readString(input, "sprintId"));

      if (sprint.status !== "active") {
        throw toolError(
          "invalid_state",
          `Sprint ${sprint.id} is ${sprint.status}; only a running sprint can be completed.`,
        );
      }

      const items = workItemsForSprint(state, sprint.id);
      const carriedOver = items.filter((item) => !isDone(state, item));

      sprint.status = "completed";
      audit(
        state,
        member.id,
        "complete_sprint",
        "sprint",
        sprint.id,
        `Completed ${sprint.name} with ${carriedOver.length} item(s) unfinished.`,
      );

      return {
        updated: sprintSummary(state, sprint),
        carriedOver: carriedOver.map((item) => item.id),
      };
    },
  }),
];
