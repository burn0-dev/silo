import {
  type WorkItemPriority,
  type WorkItemType,
  isBlocked,
  isDone,
  isOverdue,
  nextId,
  timeLogsForWorkItem,
  workflowStatesInOrder,
} from "../state.js";
import {
  S,
  defineTool,
  matchesText,
  pagingProperties,
  paginate,
  readBoolean,
  readDate,
  readEnum,
  readNumber,
  readOptionalDate,
  readOptionalEnum,
  readOptionalNumber,
  readOptionalString,
  readString,
  schema,
  toolError,
} from "./contract.js";
import {
  actor,
  assertAssignable,
  assertDependenciesResolved,
  assertWithinCapacity,
  audit,
  hoursOnWorkItem,
  requireMember,
  requireProject,
  requireSprint,
  requireWorkItem,
  requireWorkflowState,
  timeLogSummary,
  workItemSummary,
  workflowStateSummary,
} from "./helpers.js";

const workItemTypes: readonly WorkItemType[] = ["epic", "story", "bug", "task"];

const workItemPriorities: readonly WorkItemPriority[] = ["low", "medium", "high", "urgent"];

export const workItemTools = [
  defineTool({
    name: "list_workflow_states",
    description:
      "List the workflow states in order. Whether a state counts as finished (isDone) or as an explicit blocked column (isBlockedState) is recorded here, not on the work item.",
    inputSchema: schema({}),
    run(state) {
      return { results: workflowStatesInOrder(state).map(workflowStateSummary) };
    },
  }),

  defineTool({
    name: "list_work_items",
    description:
      "List work items, optionally filtered by project, sprint, assignee, status, type, priority, or whether they are blocked, overdue or unfinished.",
    inputSchema: schema({
      projectId: S.string("Only items in this project."),
      sprintId: S.string("Only items in this sprint."),
      assigneeId: S.string("Only items assigned to this member."),
      unassigned: S.boolean("Only items with no assignee (default false)."),
      status: S.string("Only items in this workflow state id."),
      type: S.enumeration("Only items of this type.", workItemTypes),
      priority: S.enumeration("Only items at this priority.", workItemPriorities),
      openOnly: S.boolean("Only items that are not in a done state (default false)."),
      blockedOnly: S.boolean(
        "Only items with at least one unfinished dependency (default false).",
      ),
      overdueOnly: S.boolean("Only unfinished items whose due date has passed (default false)."),
      ...pagingProperties,
    }),
    run(state, input) {
      const projectId = readOptionalString(input, "projectId");
      const sprintId = readOptionalString(input, "sprintId");
      const assigneeId = readOptionalString(input, "assigneeId");
      const status = readOptionalString(input, "status");
      const type = readOptionalEnum(input, "type", workItemTypes);
      const priority = readOptionalEnum(input, "priority", workItemPriorities);
      const unassigned = readBoolean(input, "unassigned", false);
      const openOnly = readBoolean(input, "openOnly", false);
      const blockedOnly = readBoolean(input, "blockedOnly", false);
      const overdueOnly = readBoolean(input, "overdueOnly", false);

      const items = Object.values(state.workItems)
        .filter((item) => (projectId ? item.projectId === projectId : true))
        .filter((item) => (sprintId ? item.sprintId === sprintId : true))
        .filter((item) => (assigneeId ? item.assigneeId === assigneeId : true))
        .filter((item) => (unassigned ? item.assigneeId === null : true))
        .filter((item) => (status ? item.status === status : true))
        .filter((item) => (type ? item.type === type : true))
        .filter((item) => (priority ? item.priority === priority : true))
        .filter((item) => (openOnly ? !isDone(state, item) : true))
        .filter((item) => (blockedOnly ? isBlocked(state, item) : true))
        .filter((item) => (overdueOnly ? isOverdue(state, item) : true))
        .sort((a, b) => a.id.localeCompare(b.id));

      const page = paginate(items, input);

      return { ...page, results: page.results.map((item) => workItemSummary(state, item)) };
    },
  }),

  defineTool({
    name: "search_work_items",
    description: "Search work items by id or title.",
    inputSchema: schema({ query: S.string("Free-text search term."), ...pagingProperties }, [
      "query",
    ]),
    run(state, input) {
      const query = readString(input, "query");

      const items = Object.values(state.workItems)
        .filter((item) => matchesText(item.id, query) || matchesText(item.title, query))
        .sort((a, b) => a.id.localeCompare(b.id));

      const page = paginate(items, input);

      return { ...page, results: page.results.map((item) => workItemSummary(state, item)) };
    },
  }),

  defineTool({
    name: "get_work_item",
    description:
      "Get one work item with its comments, children, time logged and the dependencies still holding it up.",
    inputSchema: schema({ workItemId: S.string("Work item ID, e.g. 'WI-004'.") }, ["workItemId"]),
    run(state, input) {
      const item = requireWorkItem(state, readString(input, "workItemId"));

      return {
        ...workItemSummary(state, item),
        comments: item.comments.map((comment) => ({
          ...comment,
          authorName: state.members[comment.authorId]?.name ?? null,
        })),
        children: Object.values(state.workItems)
          .filter((child) => child.parentId === item.id)
          .map((child) => child.id)
          .sort(),
        hoursLogged: hoursOnWorkItem(state, item.id),
        timeLogs: timeLogsForWorkItem(state, item.id).map((log) => timeLogSummary(state, log)),
      };
    },
  }),

  defineTool({
    name: "create_work_item",
    description:
      "Create a work item in a project. It starts in the first workflow state unless another one is given.",
    inputSchema: schema(
      {
        title: S.string("Short description of the work."),
        type: S.enumeration("What kind of work this is.", workItemTypes),
        projectId: S.string("Project it belongs to."),
        estimatePoints: S.integer("Estimate in story points.", { minimum: 0 }),
        priority: S.enumeration("Priority (default medium).", workItemPriorities),
        assigneeId: S.string("Member to assign it to. Capacity is checked."),
        sprintId: S.string("Sprint to put it in."),
        status: S.string("Starting workflow state id."),
        dueDate: S.string("Due date, YYYY-MM-DD."),
        parentId: S.string("Parent work item, usually an epic."),
        actorMemberId: S.string("Member performing the action."),
      },
      ["title", "type", "projectId", "estimatePoints", "actorMemberId"],
    ),
    run(state, input) {
      const member = actor(state, readString(input, "actorMemberId"));
      const project = requireProject(state, readString(input, "projectId"));

      if (project.status === "completed") {
        throw toolError(
          "not_allowed",
          `Project ${project.id} is completed; no new work can be added to it.`,
        );
      }

      const statusId = readOptionalString(input, "status");
      const workflowState = statusId
        ? requireWorkflowState(state, statusId)
        : workflowStatesInOrder(state)[0];

      if (!workflowState) {
        throw toolError("invalid_state", "The workflow has no states to start from.");
      }

      const estimatePoints = readNumber(input, "estimatePoints", { min: 0, integer: true });
      const assigneeId = readOptionalString(input, "assigneeId");

      if (assigneeId) {
        const assignee = assertAssignable(state, assigneeId);

        if (!workflowState.isDone) assertWithinCapacity(state, assignee, estimatePoints);
      }

      const sprintId = readOptionalString(input, "sprintId");

      if (sprintId) {
        const sprint = requireSprint(state, sprintId);

        if (sprint.projectId !== project.id) {
          throw toolError(
            "invalid_input",
            `Sprint ${sprint.id} belongs to ${sprint.projectId}, not to ${project.id}.`,
          );
        }
      }

      const parentId = readOptionalString(input, "parentId");

      if (parentId) requireWorkItem(state, parentId);

      const item = {
        id: nextId(state, "WI"),
        title: readString(input, "title"),
        type: readEnum(input, "type", workItemTypes),
        status: workflowState.id,
        priority: readOptionalEnum(input, "priority", workItemPriorities) ?? "medium",
        assigneeId: assigneeId ?? null,
        projectId: project.id,
        sprintId: sprintId ?? null,
        estimatePoints,
        createdDate: state.now,
        statusEnteredDate: state.now,
        dueDate: readOptionalDate(input, "dueDate") ?? null,
        parentId: parentId ?? null,
        dependsOn: [],
        comments: [],
      };

      state.workItems[item.id] = item;
      audit(state, member.id, "create_work_item", "work_item", item.id, `Created ${item.title}.`);

      return { created: workItemSummary(state, item) };
    },
  }),

  defineTool({
    name: "update_work_item",
    description:
      "Change a work item's title, type, priority, estimate, due date or parent. Status, assignee and sprint have their own tools because each carries a rule.",
    inputSchema: schema(
      {
        workItemId: S.string("Work item ID."),
        title: S.string("New title."),
        type: S.enumeration("New type.", workItemTypes),
        priority: S.enumeration("New priority.", workItemPriorities),
        estimatePoints: S.integer("New estimate in story points.", { minimum: 0 }),
        dueDate: S.string("New due date, YYYY-MM-DD."),
        parentId: S.string("New parent work item."),
        actorMemberId: S.string("Member performing the action."),
      },
      ["workItemId", "actorMemberId"],
    ),
    run(state, input) {
      const member = actor(state, readString(input, "actorMemberId"));
      const item = requireWorkItem(state, readString(input, "workItemId"));

      const title = readOptionalString(input, "title");
      const type = readOptionalEnum(input, "type", workItemTypes);
      const priority = readOptionalEnum(input, "priority", workItemPriorities);
      const estimatePoints = readOptionalNumber(input, "estimatePoints", {
        min: 0,
        integer: true,
      });
      const dueDate = readOptionalDate(input, "dueDate");
      const parentId = readOptionalString(input, "parentId");

      if (title !== undefined) item.title = title;
      if (type !== undefined) item.type = type;
      if (priority !== undefined) item.priority = priority;
      if (dueDate !== undefined) item.dueDate = dueDate;

      if (estimatePoints !== undefined) {
        if (item.assigneeId && !isDone(state, item)) {
          const assignee = requireMember(state, item.assigneeId);
          const delta = estimatePoints - item.estimatePoints;

          if (delta > 0) assertWithinCapacity(state, assignee, delta);
        }

        item.estimatePoints = estimatePoints;
      }

      if (parentId !== undefined) {
        if (parentId === item.id) {
          throw toolError("invalid_input", "A work item cannot be its own parent.");
        }

        requireWorkItem(state, parentId);
        item.parentId = parentId;
      }

      audit(state, member.id, "update_work_item", "work_item", item.id, `Updated ${item.title}.`);

      return { updated: workItemSummary(state, item) };
    },
  }),

  defineTool({
    name: "assign_work_item",
    description:
      "Assign an unfinished work item to an active member. Refuses when the item's estimate would push that member past their weekly capacity — check member_load first to find someone with room.",
    inputSchema: schema(
      {
        workItemId: S.string("Work item ID."),
        assigneeId: S.string("Member who will do the work."),
        actorMemberId: S.string("Member performing the action."),
      },
      ["workItemId", "assigneeId", "actorMemberId"],
    ),
    run(state, input) {
      const member = actor(state, readString(input, "actorMemberId"));
      const item = requireWorkItem(state, readString(input, "workItemId"));

      if (isDone(state, item)) {
        throw toolError("not_allowed", `${item.id} is done and no longer needs an assignee.`);
      }

      const assigneeId = readString(input, "assigneeId");
      const assignee = assertAssignable(state, assigneeId);

      if (item.assigneeId === assigneeId) {
        throw toolError("conflict", `${item.id} is already assigned to ${assigneeId}.`);
      }

      assertWithinCapacity(state, assignee, item.estimatePoints);

      const previous = item.assigneeId;
      item.assigneeId = assigneeId;

      audit(
        state,
        member.id,
        "assign_work_item",
        "work_item",
        item.id,
        `Assigned ${item.id} from ${previous ?? "nobody"} to ${assigneeId}.`,
      );

      return { updated: workItemSummary(state, item) };
    },
  }),

  defineTool({
    name: "unassign_work_item",
    description: "Take a work item off whoever holds it, freeing their capacity.",
    inputSchema: schema(
      {
        workItemId: S.string("Work item ID."),
        actorMemberId: S.string("Member performing the action."),
      },
      ["workItemId", "actorMemberId"],
    ),
    run(state, input) {
      const member = actor(state, readString(input, "actorMemberId"));
      const item = requireWorkItem(state, readString(input, "workItemId"));

      if (item.assigneeId === null) {
        throw toolError("conflict", `${item.id} has no assignee.`);
      }

      const previous = item.assigneeId;
      item.assigneeId = null;

      audit(
        state,
        member.id,
        "unassign_work_item",
        "work_item",
        item.id,
        `Unassigned ${item.id} from ${previous}.`,
      );

      return { updated: workItemSummary(state, item) };
    },
  }),

  defineTool({
    name: "set_work_item_status",
    description:
      "Move a work item to another workflow state. Moving into a done state is refused while any dependency is still unfinished — close the dependency first. Resets the days-in-status clock.",
    inputSchema: schema(
      {
        workItemId: S.string("Work item ID."),
        status: S.string("Workflow state id to move into, from list_workflow_states."),
        actorMemberId: S.string("Member performing the action."),
      },
      ["workItemId", "status", "actorMemberId"],
    ),
    run(state, input) {
      const member = actor(state, readString(input, "actorMemberId"));
      const item = requireWorkItem(state, readString(input, "workItemId"));
      const workflowState = requireWorkflowState(state, readString(input, "status"));

      if (item.status === workflowState.id) {
        throw toolError("conflict", `${item.id} is already in ${workflowState.name}.`);
      }

      if (workflowState.isDone) assertDependenciesResolved(state, item);

      const previous = item.status;
      item.status = workflowState.id;
      item.statusEnteredDate = state.now;

      audit(
        state,
        member.id,
        "set_work_item_status",
        "work_item",
        item.id,
        `Moved ${item.id} from ${previous} to ${workflowState.id}.`,
      );

      return { updated: workItemSummary(state, item) };
    },
  }),

  defineTool({
    name: "add_work_item_dependency",
    description:
      "Record that a work item cannot finish until another one does. Self-references and duplicates are refused.",
    inputSchema: schema(
      {
        workItemId: S.string("The item that is held up."),
        dependsOnId: S.string("The item it waits for."),
        actorMemberId: S.string("Member performing the action."),
      },
      ["workItemId", "dependsOnId", "actorMemberId"],
    ),
    run(state, input) {
      const member = actor(state, readString(input, "actorMemberId"));
      const item = requireWorkItem(state, readString(input, "workItemId"));
      const dependency = requireWorkItem(state, readString(input, "dependsOnId"));

      if (item.id === dependency.id) {
        throw toolError("invalid_input", "A work item cannot depend on itself.");
      }

      if (item.dependsOn.includes(dependency.id)) {
        throw toolError("conflict", `${item.id} already depends on ${dependency.id}.`);
      }

      if (dependency.dependsOn.includes(item.id)) {
        throw toolError(
          "not_allowed",
          `${dependency.id} already depends on ${item.id}; this would create a cycle.`,
        );
      }

      item.dependsOn.push(dependency.id);

      audit(
        state,
        member.id,
        "add_work_item_dependency",
        "work_item",
        item.id,
        `${item.id} now depends on ${dependency.id}.`,
      );

      return { updated: workItemSummary(state, item) };
    },
  }),

  defineTool({
    name: "remove_work_item_dependency",
    description: "Drop a dependency that no longer applies.",
    inputSchema: schema(
      {
        workItemId: S.string("The item that was held up."),
        dependsOnId: S.string("The dependency to remove."),
        actorMemberId: S.string("Member performing the action."),
      },
      ["workItemId", "dependsOnId", "actorMemberId"],
    ),
    run(state, input) {
      const member = actor(state, readString(input, "actorMemberId"));
      const item = requireWorkItem(state, readString(input, "workItemId"));
      const dependsOnId = readString(input, "dependsOnId");

      if (!item.dependsOn.includes(dependsOnId)) {
        throw toolError("not_found", `${item.id} does not depend on ${dependsOnId}.`);
      }

      item.dependsOn = item.dependsOn.filter((candidate) => candidate !== dependsOnId);

      audit(
        state,
        member.id,
        "remove_work_item_dependency",
        "work_item",
        item.id,
        `${item.id} no longer depends on ${dependsOnId}.`,
      );

      return { updated: workItemSummary(state, item) };
    },
  }),

  defineTool({
    name: "add_comment",
    description:
      "Add a comment to a work item. Comments live on the item itself and are returned by get_work_item.",
    inputSchema: schema(
      {
        workItemId: S.string("Work item ID."),
        body: S.string("What to say."),
        actorMemberId: S.string("Member writing the comment."),
      },
      ["workItemId", "body", "actorMemberId"],
    ),
    run(state, input) {
      const member = actor(state, readString(input, "actorMemberId"));
      const item = requireWorkItem(state, readString(input, "workItemId"));

      const comment = {
        id: nextId(state, "CMT"),
        authorId: member.id,
        body: readString(input, "body"),
        createdDate: state.now,
      };

      item.comments.push(comment);
      audit(state, member.id, "add_comment", "work_item", item.id, `Commented on ${item.id}.`);

      return { workItemId: item.id, created: comment, commentCount: item.comments.length };
    },
  }),

  defineTool({
    name: "list_comments",
    description: "List the comments on a work item, oldest first.",
    inputSchema: schema({ workItemId: S.string("Work item ID.") }, ["workItemId"]),
    run(state, input) {
      const item = requireWorkItem(state, readString(input, "workItemId"));

      return {
        workItemId: item.id,
        count: item.comments.length,
        results: item.comments.map((comment) => ({
          ...comment,
          authorName: state.members[comment.authorId]?.name ?? null,
        })),
      };
    },
  }),

  defineTool({
    name: "move_work_item_to_sprint",
    description:
      "Put a work item into a sprint. The sprint must belong to the same project, and a completed sprint cannot take new work.",
    inputSchema: schema(
      {
        workItemId: S.string("Work item ID."),
        sprintId: S.string("Sprint to move it into."),
        actorMemberId: S.string("Member performing the action."),
      },
      ["workItemId", "sprintId", "actorMemberId"],
    ),
    run(state, input) {
      const member = actor(state, readString(input, "actorMemberId"));
      const item = requireWorkItem(state, readString(input, "workItemId"));
      const sprint = requireSprint(state, readString(input, "sprintId"));

      if (sprint.projectId !== item.projectId) {
        throw toolError(
          "invalid_input",
          `Sprint ${sprint.id} belongs to ${sprint.projectId}, but ${item.id} belongs to ${item.projectId}.`,
        );
      }

      if (sprint.status === "completed") {
        throw toolError(
          "not_allowed",
          `Sprint ${sprint.id} is completed and cannot take new work.`,
        );
      }

      const previous = item.sprintId;
      item.sprintId = sprint.id;

      audit(
        state,
        member.id,
        "move_work_item_to_sprint",
        "work_item",
        item.id,
        `Moved ${item.id} from ${previous ?? "the backlog"} to ${sprint.id}.`,
      );

      return { updated: workItemSummary(state, item) };
    },
  }),

  defineTool({
    name: "remove_work_item_from_sprint",
    description: "Pull a work item out of its sprint and back into the backlog.",
    inputSchema: schema(
      {
        workItemId: S.string("Work item ID."),
        actorMemberId: S.string("Member performing the action."),
      },
      ["workItemId", "actorMemberId"],
    ),
    run(state, input) {
      const member = actor(state, readString(input, "actorMemberId"));
      const item = requireWorkItem(state, readString(input, "workItemId"));

      if (item.sprintId === null) {
        throw toolError("conflict", `${item.id} is not in a sprint.`);
      }

      const previous = item.sprintId;
      item.sprintId = null;

      audit(
        state,
        member.id,
        "remove_work_item_from_sprint",
        "work_item",
        item.id,
        `Removed ${item.id} from ${previous}.`,
      );

      return { updated: workItemSummary(state, item) };
    },
  }),

  defineTool({
    name: "set_work_item_due_date",
    description: "Set or clear a work item's due date. Overdue is judged against the simulation date.",
    inputSchema: schema(
      {
        workItemId: S.string("Work item ID."),
        dueDate: S.string("New due date, YYYY-MM-DD. Omit with clear=true to remove it."),
        clear: S.boolean("Remove the due date instead of setting one (default false)."),
        actorMemberId: S.string("Member performing the action."),
      },
      ["workItemId", "actorMemberId"],
    ),
    run(state, input) {
      const member = actor(state, readString(input, "actorMemberId"));
      const item = requireWorkItem(state, readString(input, "workItemId"));
      const clear = readBoolean(input, "clear", false);

      if (clear) {
        item.dueDate = null;
      } else {
        item.dueDate = readDate(input, "dueDate");
      }

      audit(
        state,
        member.id,
        "set_work_item_due_date",
        "work_item",
        item.id,
        `Due date for ${item.id} set to ${item.dueDate ?? "none"}.`,
      );

      return { updated: workItemSummary(state, item) };
    },
  }),
];
