import { type ActivityType, nextId } from "../state.js";
import {
  S,
  defineTool,
  pagingProperties,
  paginate,
  readBoolean,
  readDate,
  readEnum,
  readOptionalDate,
  readOptionalEnum,
  readOptionalString,
  readString,
  schema,
  toolError,
} from "./contract.js";
import {
  activitySummary,
  actor,
  assertAssignable,
  audit,
  requireAccount,
  requireActivity,
  requireContact,
  requireLead,
  requireOpportunity,
} from "./helpers.js";

const activityTypes: readonly ActivityType[] = ["call", "email", "meeting", "note"];

const relationTypes = ["lead", "account", "contact", "opportunity"] as const;

type RelationType = (typeof relationTypes)[number];

/** Confirms the related record exists before an activity points at it. */
function assertRelationExists(
  state: Parameters<typeof requireLead>[0],
  type: RelationType,
  id: string,
): void {
  if (type === "lead") requireLead(state, id);
  if (type === "account") requireAccount(state, id);
  if (type === "contact") requireContact(state, id);
  if (type === "opportunity") requireOpportunity(state, id);
}

export const activityTools = [
  defineTool({
    name: "list_activities",
    description:
      "List activities, optionally filtered by owner, what they relate to, or whether they are still open.",
    inputSchema: schema({
      ownerId: S.string("Only activities owned by this user."),
      relatedType: S.enumeration("Only activities against this kind of record.", relationTypes),
      relatedId: S.string("Only activities against this record id."),
      openOnly: S.boolean("Only activities that have not been completed (default false)."),
      type: S.enumeration("Only activities of this type.", activityTypes),
      ...pagingProperties,
    }),
    run(state, input) {
      const ownerId = readOptionalString(input, "ownerId");
      const relatedType = readOptionalEnum(input, "relatedType", relationTypes);
      const relatedId = readOptionalString(input, "relatedId");
      const type = readOptionalEnum(input, "type", activityTypes);
      const openOnly = readBoolean(input, "openOnly", false);

      const activities = Object.values(state.activities)
        .filter((activity) => (ownerId ? activity.ownerId === ownerId : true))
        .filter((activity) => (relatedType ? activity.relatedTo.type === relatedType : true))
        .filter((activity) => (relatedId ? activity.relatedTo.id === relatedId : true))
        .filter((activity) => (type ? activity.type === type : true))
        .filter((activity) => (openOnly ? activity.completedDate === null : true))
        .sort((a, b) => a.id.localeCompare(b.id));

      const page = paginate(activities, input);

      return { ...page, results: page.results.map((activity) => activitySummary(state, activity)) };
    },
  }),

  defineTool({
    name: "get_activity",
    description: "Get one activity.",
    inputSchema: schema({ activityId: S.string("Activity ID, e.g. 'ACT-001'.") }, ["activityId"]),
    run(state, input) {
      const activity = requireActivity(state, readString(input, "activityId"));

      return activitySummary(state, activity);
    },
  }),

  defineTool({
    name: "log_activity",
    description:
      "Record something that already happened — a call made, an email sent, a meeting held, a note taken. Logged activities are complete as of today.",
    inputSchema: schema(
      {
        type: S.enumeration("What kind of activity this was.", activityTypes),
        subject: S.string("Short description."),
        relatedType: S.enumeration("What kind of record it relates to.", relationTypes),
        relatedId: S.string("Id of the related record."),
        ownerId: S.string("User the activity belongs to."),
        notes: S.string("Longer notes."),
        actorUserId: S.string("User performing the action."),
      },
      ["type", "subject", "relatedType", "relatedId", "ownerId", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const ownerId = readString(input, "ownerId");
      assertAssignable(state, ownerId);

      const relatedType = readEnum(input, "relatedType", relationTypes);
      const relatedId = readString(input, "relatedId");
      assertRelationExists(state, relatedType, relatedId);

      const activity = {
        id: nextId(state, "ACT"),
        type: readEnum(input, "type", activityTypes),
        subject: readString(input, "subject"),
        ownerId,
        relatedTo: { type: relatedType, id: relatedId },
        dueDate: state.now,
        completedDate: state.now,
        notes: readOptionalString(input, "notes") ?? null,
      };

      state.activities[activity.id] = activity;
      audit(
        state,
        user.id,
        "log_activity",
        "activity",
        activity.id,
        `Logged ${activity.type} on ${relatedId}.`,
      );

      return { created: activitySummary(state, activity) };
    },
  }),

  defineTool({
    name: "schedule_followup",
    description:
      "Schedule an activity for a future date. It stays open until complete_activity is called on it.",
    inputSchema: schema(
      {
        type: S.enumeration("What kind of activity to schedule.", activityTypes),
        subject: S.string("Short description."),
        relatedType: S.enumeration("What kind of record it relates to.", relationTypes),
        relatedId: S.string("Id of the related record."),
        ownerId: S.string("User the activity belongs to."),
        dueDate: S.string("When it is due, YYYY-MM-DD."),
        notes: S.string("Longer notes."),
        actorUserId: S.string("User performing the action."),
      },
      ["type", "subject", "relatedType", "relatedId", "ownerId", "dueDate", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const ownerId = readString(input, "ownerId");
      assertAssignable(state, ownerId);

      const relatedType = readEnum(input, "relatedType", relationTypes);
      const relatedId = readString(input, "relatedId");
      assertRelationExists(state, relatedType, relatedId);

      const activity = {
        id: nextId(state, "ACT"),
        type: readEnum(input, "type", activityTypes),
        subject: readString(input, "subject"),
        ownerId,
        relatedTo: { type: relatedType, id: relatedId },
        dueDate: readDate(input, "dueDate"),
        completedDate: null,
        notes: readOptionalString(input, "notes") ?? null,
      };

      state.activities[activity.id] = activity;
      audit(
        state,
        user.id,
        "schedule_followup",
        "activity",
        activity.id,
        `Scheduled ${activity.type} on ${relatedId} for ${activity.dueDate}.`,
      );

      return { created: activitySummary(state, activity) };
    },
  }),

  defineTool({
    name: "complete_activity",
    description: "Mark an open activity as done, today by default.",
    inputSchema: schema(
      {
        activityId: S.string("Activity ID."),
        completedDate: S.string("Date it was completed, YYYY-MM-DD. Defaults to today."),
        notes: S.string("Notes to replace the existing ones."),
        actorUserId: S.string("User performing the action."),
      },
      ["activityId", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const activity = requireActivity(state, readString(input, "activityId"));

      if (activity.completedDate !== null) {
        throw toolError(
          "invalid_state",
          `Activity ${activity.id} was already completed on ${activity.completedDate}.`,
        );
      }

      const notes = readOptionalString(input, "notes");

      activity.completedDate = readOptionalDate(input, "completedDate") ?? state.now;
      if (notes !== undefined) activity.notes = notes;

      audit(
        state,
        user.id,
        "complete_activity",
        "activity",
        activity.id,
        `Completed ${activity.id}.`,
      );

      return { updated: activitySummary(state, activity) };
    },
  }),
];
