import {
  type ProjectStatus,
  isDone,
  nextId,
  sprintsForProject,
  workItemsForProject,
} from "../state.js";
import {
  S,
  defineTool,
  matchesText,
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
  assertAssignable,
  audit,
  memberSummary,
  projectSummary,
  requireMember,
  requireProject,
  sprintSummary,
  workItemSummary,
} from "./helpers.js";

const projectStatuses: readonly ProjectStatus[] = ["active", "on_hold", "completed"];

export const projectTools = [
  defineTool({
    name: "list_projects",
    description: "List projects, optionally filtered by status or lead.",
    inputSchema: schema({
      status: S.enumeration("Only projects with this status.", projectStatuses),
      leadId: S.string("Only projects led by this member."),
      ...pagingProperties,
    }),
    run(state, input) {
      const status = readOptionalEnum(input, "status", projectStatuses);
      const leadId = readOptionalString(input, "leadId");

      const projects = Object.values(state.projects)
        .filter((project) => (status ? project.status === status : true))
        .filter((project) => (leadId ? project.leadId === leadId : true))
        .sort((a, b) => a.id.localeCompare(b.id));

      const page = paginate(projects, input);

      return { ...page, results: page.results.map((project) => projectSummary(state, project)) };
    },
  }),

  defineTool({
    name: "search_projects",
    description: "Search projects by name or key.",
    inputSchema: schema({ query: S.string("Free-text search term."), ...pagingProperties }, [
      "query",
    ]),
    run(state, input) {
      const query = readString(input, "query");

      const projects = Object.values(state.projects)
        .filter(
          (project) =>
            matchesText(project.id, query) ||
            matchesText(project.name, query) ||
            matchesText(project.key, query),
        )
        .sort((a, b) => a.id.localeCompare(b.id));

      const page = paginate(projects, input);

      return { ...page, results: page.results.map((project) => projectSummary(state, project)) };
    },
  }),

  defineTool({
    name: "get_project",
    description: "Get one project with its sprints and every work item against it.",
    inputSchema: schema({ projectId: S.string("Project ID, e.g. 'PROJ-001'.") }, ["projectId"]),
    run(state, input) {
      const project = requireProject(state, readString(input, "projectId"));

      return {
        ...projectSummary(state, project),
        sprints: sprintsForProject(state, project.id).map((sprint) =>
          sprintSummary(state, sprint),
        ),
        workItems: workItemsForProject(state, project.id).map((item) =>
          workItemSummary(state, item),
        ),
      };
    },
  }),

  defineTool({
    name: "create_project",
    description: "Start a new project under an active lead.",
    inputSchema: schema(
      {
        name: S.string("Project name."),
        key: S.string("Short project key, e.g. 'ATL'."),
        leadId: S.string("Member who will lead the project."),
        startDate: S.string("Start date, YYYY-MM-DD."),
        targetDate: S.string("Target completion date, YYYY-MM-DD."),
        actorMemberId: S.string("Member performing the action."),
      },
      ["name", "key", "leadId", "startDate", "targetDate", "actorMemberId"],
    ),
    run(state, input) {
      const member = actor(state, readString(input, "actorMemberId"));
      const leadId = readString(input, "leadId");
      assertAssignable(state, leadId);

      const key = readString(input, "key").toUpperCase();

      if (Object.values(state.projects).some((project) => project.key === key)) {
        throw toolError("conflict", `A project with key "${key}" already exists.`);
      }

      const project = {
        id: nextId(state, "PROJ"),
        name: readString(input, "name"),
        key,
        status: "active" as ProjectStatus,
        leadId,
        startDate: readDate(input, "startDate"),
        targetDate: readDate(input, "targetDate"),
      };

      state.projects[project.id] = project;
      audit(state, member.id, "create_project", "project", project.id, `Created ${project.name}.`);

      return { created: projectSummary(state, project) };
    },
  }),

  defineTool({
    name: "update_project",
    description:
      "Change a project's name, target date or status. Use close_project to complete one — it checks the remaining work first.",
    inputSchema: schema(
      {
        projectId: S.string("Project ID."),
        name: S.string("New name."),
        targetDate: S.string("New target date, YYYY-MM-DD."),
        status: S.enumeration("New status. 'completed' is set by close_project.", [
          "active",
          "on_hold",
        ]),
        actorMemberId: S.string("Member performing the action."),
      },
      ["projectId", "actorMemberId"],
    ),
    run(state, input) {
      const member = actor(state, readString(input, "actorMemberId"));
      const project = requireProject(state, readString(input, "projectId"));

      if (project.status === "completed") {
        throw toolError(
          "not_allowed",
          `Project ${project.id} is completed and can no longer be changed.`,
        );
      }

      const name = readOptionalString(input, "name");
      const targetDate = readOptionalString(input, "targetDate");
      const status = readOptionalEnum(input, "status", ["active", "on_hold"] as const);

      if (name !== undefined) project.name = name;
      if (targetDate !== undefined) project.targetDate = readDate(input, "targetDate");
      if (status !== undefined) project.status = status;

      audit(state, member.id, "update_project", "project", project.id, `Updated ${project.name}.`);

      return { updated: projectSummary(state, project) };
    },
  }),

  defineTool({
    name: "close_project",
    description:
      "Mark a project completed. Refuses while any of its work items is still unfinished — finish or drop them first.",
    inputSchema: schema(
      {
        projectId: S.string("Project ID."),
        actorMemberId: S.string("Member performing the action."),
      },
      ["projectId", "actorMemberId"],
    ),
    run(state, input) {
      const member = actor(state, readString(input, "actorMemberId"));
      const project = requireProject(state, readString(input, "projectId"));

      if (project.status === "completed") {
        throw toolError("conflict", `Project ${project.id} is already completed.`);
      }

      const open = workItemsForProject(state, project.id).filter((item) => !isDone(state, item));

      if (open.length > 0) {
        throw toolError(
          "not_allowed",
          `Project ${project.id} still has ${open.length} unfinished work item(s): ${open
            .map((item) => item.id)
            .join(", ")}.`,
          { projectId: project.id, openWorkItemIds: open.map((item) => item.id) },
        );
      }

      project.status = "completed";
      audit(state, member.id, "close_project", "project", project.id, `Closed ${project.name}.`);

      return { updated: projectSummary(state, project) };
    },
  }),

  defineTool({
    name: "reassign_project_lead",
    description: "Hand a project over to a different active member.",
    inputSchema: schema(
      {
        projectId: S.string("Project ID."),
        newLeadId: S.string("Member who will lead it."),
        actorMemberId: S.string("Member performing the action."),
      },
      ["projectId", "newLeadId", "actorMemberId"],
    ),
    run(state, input) {
      const member = actor(state, readString(input, "actorMemberId"));
      const project = requireProject(state, readString(input, "projectId"));
      const newLeadId = readString(input, "newLeadId");
      const newLead = assertAssignable(state, newLeadId);

      if (project.leadId === newLeadId) {
        throw toolError(
          "conflict",
          `${project.id} is already led by ${newLeadId} (${newLead.name}).`,
        );
      }

      const previous = project.leadId;
      project.leadId = newLeadId;

      audit(
        state,
        member.id,
        "reassign_project_lead",
        "project",
        project.id,
        `Lead changed from ${previous} to ${newLeadId}.`,
      );

      return { updated: projectSummary(state, project) };
    },
  }),

  defineTool({
    name: "get_project_lead",
    description: "Get the member leading a project, with their current load and capacity.",
    inputSchema: schema({ projectId: S.string("Project ID.") }, ["projectId"]),
    run(state, input) {
      const project = requireProject(state, readString(input, "projectId"));
      const lead = requireMember(state, project.leadId);

      return { projectId: project.id, lead: memberSummary(state, lead) };
    },
  }),
];
