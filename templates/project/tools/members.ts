import {
  type MemberRole,
  isDone,
  loadFor,
  membersForTeam,
  nextId,
  workItemsForAssignee,
} from "../state.js";
import {
  S,
  defineTool,
  matchesText,
  pagingProperties,
  paginate,
  readBoolean,
  readNumber,
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
  audit,
  memberSummary,
  requireMember,
  requireTeam,
  teamSummary,
  workItemSummary,
} from "./helpers.js";

const memberRoles: readonly MemberRole[] = ["engineer", "lead", "manager"];

export const memberTools = [
  defineTool({
    name: "list_members",
    description:
      "List team members with their weekly capacity and how many points they are already committed to. Use this to check whether someone is still active before assigning work to them.",
    inputSchema: schema({
      role: S.enumeration("Only members with this role.", memberRoles),
      teamId: S.string("Only members on this team."),
      activeOnly: S.boolean("Only members who are still active (default false)."),
      overCapacityOnly: S.boolean(
        "Only members whose committed points exceed their weekly capacity (default false).",
      ),
      ...pagingProperties,
    }),
    run(state, input) {
      const role = readOptionalEnum(input, "role", memberRoles);
      const teamId = readOptionalString(input, "teamId");
      const activeOnly = readBoolean(input, "activeOnly", false);
      const overCapacityOnly = readBoolean(input, "overCapacityOnly", false);

      const members = Object.values(state.members)
        .filter((member) => (role ? member.role === role : true))
        .filter((member) => (teamId ? member.teamId === teamId : true))
        .filter((member) => (activeOnly ? member.active : true))
        .filter((member) =>
          overCapacityOnly ? loadFor(state, member.id) > member.weeklyCapacityPoints : true,
        )
        .sort((a, b) => a.id.localeCompare(b.id));

      const page = paginate(members, input);

      return { ...page, results: page.results.map((member) => memberSummary(state, member)) };
    },
  }),

  defineTool({
    name: "search_members",
    description: "Search members by name or email.",
    inputSchema: schema({ query: S.string("Free-text search term."), ...pagingProperties }, [
      "query",
    ]),
    run(state, input) {
      const query = readString(input, "query");

      const members = Object.values(state.members)
        .filter(
          (member) =>
            matchesText(member.id, query) ||
            matchesText(member.name, query) ||
            matchesText(member.email, query),
        )
        .sort((a, b) => a.id.localeCompare(b.id));

      const page = paginate(members, input);

      return { ...page, results: page.results.map((member) => memberSummary(state, member)) };
    },
  }),

  defineTool({
    name: "get_member",
    description:
      "Get one member with their capacity, current load and every work item assigned to them.",
    inputSchema: schema({ memberId: S.string("Member ID, e.g. 'MEM-003'.") }, ["memberId"]),
    run(state, input) {
      const member = requireMember(state, readString(input, "memberId"));
      const assigned = workItemsForAssignee(state, member.id);

      return {
        ...memberSummary(state, member),
        openWorkItemCount: assigned.filter((item) => !isDone(state, item)).length,
        workItems: assigned.map((item) => workItemSummary(state, item)),
      };
    },
  }),

  defineTool({
    name: "create_member",
    description: "Add a member to the organisation.",
    inputSchema: schema(
      {
        name: S.string("Full name."),
        email: S.string("Email address."),
        role: S.enumeration("What they do.", memberRoles),
        weeklyCapacityPoints: S.integer("How many points they can carry in a week.", {
          minimum: 0,
        }),
        teamId: S.string("Team they join."),
        actorMemberId: S.string("Member performing the action."),
      },
      ["name", "email", "role", "weeklyCapacityPoints", "actorMemberId"],
    ),
    run(state, input) {
      const actingMember = actor(state, readString(input, "actorMemberId"));
      const teamId = readOptionalString(input, "teamId");

      if (teamId) requireTeam(state, teamId);

      const member = {
        id: nextId(state, "MEM"),
        name: readString(input, "name"),
        email: readString(input, "email"),
        role: readOptionalEnum(input, "role", memberRoles) ?? "engineer",
        teamId: teamId ?? null,
        weeklyCapacityPoints: readNumber(input, "weeklyCapacityPoints", {
          min: 0,
          integer: true,
        }),
        active: true,
      };

      state.members[member.id] = member;
      audit(state, actingMember.id, "create_member", "member", member.id, `Added ${member.name}.`);

      return { created: memberSummary(state, member) };
    },
  }),

  defineTool({
    name: "update_member",
    description: "Change a member's role, team or weekly capacity.",
    inputSchema: schema(
      {
        memberId: S.string("Member ID."),
        role: S.enumeration("New role.", memberRoles),
        teamId: S.string("New team."),
        weeklyCapacityPoints: S.integer("New weekly capacity in points.", { minimum: 0 }),
        actorMemberId: S.string("Member performing the action."),
      },
      ["memberId", "actorMemberId"],
    ),
    run(state, input) {
      const actingMember = actor(state, readString(input, "actorMemberId"));
      const member = requireMember(state, readString(input, "memberId"));

      const role = readOptionalEnum(input, "role", memberRoles);
      const teamId = readOptionalString(input, "teamId");
      const weeklyCapacityPoints = readOptionalNumber(input, "weeklyCapacityPoints", {
        min: 0,
        integer: true,
      });

      if (role !== undefined) member.role = role;
      if (weeklyCapacityPoints !== undefined) member.weeklyCapacityPoints = weeklyCapacityPoints;

      if (teamId !== undefined) {
        requireTeam(state, teamId);
        member.teamId = teamId;
      }

      audit(
        state,
        actingMember.id,
        "update_member",
        "member",
        member.id,
        `Updated ${member.name}.`,
      );

      return { updated: memberSummary(state, member) };
    },
  }),

  defineTool({
    name: "deactivate_member",
    description:
      "Mark a member as no longer active. Their finished work keeps their name on it, but they can no longer act or be assigned anything, so open work needs rehoming.",
    inputSchema: schema(
      {
        memberId: S.string("Member ID."),
        actorMemberId: S.string("Member performing the action."),
      },
      ["memberId", "actorMemberId"],
    ),
    run(state, input) {
      const actingMember = actor(state, readString(input, "actorMemberId"));
      const member = requireMember(state, readString(input, "memberId"));

      if (!member.active) {
        throw toolError("conflict", `${member.id} (${member.name}) is already deactivated.`);
      }

      member.active = false;
      const openItems = workItemsForAssignee(state, member.id).filter(
        (item) => !isDone(state, item),
      );

      audit(
        state,
        actingMember.id,
        "deactivate_member",
        "member",
        member.id,
        `Deactivated ${member.name} with ${openItems.length} open item(s) still assigned.`,
      );

      return {
        updated: memberSummary(state, member),
        openWorkItemIds: openItems.map((item) => item.id),
      };
    },
  }),

  defineTool({
    name: "reactivate_member",
    description: "Bring a deactivated member back, so they can act and hold work again.",
    inputSchema: schema(
      {
        memberId: S.string("Member ID."),
        actorMemberId: S.string("Member performing the action."),
      },
      ["memberId", "actorMemberId"],
    ),
    run(state, input) {
      const actingMember = actor(state, readString(input, "actorMemberId"));
      const member = requireMember(state, readString(input, "memberId"));

      if (member.active) {
        throw toolError("conflict", `${member.id} (${member.name}) is already active.`);
      }

      member.active = true;
      audit(
        state,
        actingMember.id,
        "reactivate_member",
        "member",
        member.id,
        `Reactivated ${member.name}.`,
      );

      return { updated: memberSummary(state, member) };
    },
  }),

  defineTool({
    name: "list_teams",
    description: "List the teams, with their lead and how many members they hold.",
    inputSchema: schema({ ...pagingProperties }),
    run(state, input) {
      const teams = Object.values(state.teams).sort((a, b) => a.id.localeCompare(b.id));
      const page = paginate(teams, input);

      return { ...page, results: page.results.map((team) => teamSummary(state, team)) };
    },
  }),

  defineTool({
    name: "get_team",
    description: "Get one team with its members and their current load.",
    inputSchema: schema({ teamId: S.string("Team ID, e.g. 'TEAM-001'.") }, ["teamId"]),
    run(state, input) {
      const team = requireTeam(state, readString(input, "teamId"));

      return {
        ...teamSummary(state, team),
        members: membersForTeam(state, team.id).map((member) => memberSummary(state, member)),
      };
    },
  }),

  defineTool({
    name: "create_team",
    description: "Create a team, optionally with a lead.",
    inputSchema: schema(
      {
        name: S.string("Team name."),
        leadId: S.string("Member who will lead it."),
        actorMemberId: S.string("Member performing the action."),
      },
      ["name", "actorMemberId"],
    ),
    run(state, input) {
      const actingMember = actor(state, readString(input, "actorMemberId"));
      const leadId = readOptionalString(input, "leadId");

      if (leadId) assertAssignable(state, leadId);

      const team = {
        id: nextId(state, "TEAM"),
        name: readString(input, "name"),
        leadId: leadId ?? null,
      };

      state.teams[team.id] = team;
      audit(state, actingMember.id, "create_team", "team", team.id, `Created ${team.name}.`);

      return { created: teamSummary(state, team) };
    },
  }),

  defineTool({
    name: "reassign_team_lead",
    description: "Give a team a different active lead.",
    inputSchema: schema(
      {
        teamId: S.string("Team ID."),
        newLeadId: S.string("Member who will lead it."),
        actorMemberId: S.string("Member performing the action."),
      },
      ["teamId", "newLeadId", "actorMemberId"],
    ),
    run(state, input) {
      const actingMember = actor(state, readString(input, "actorMemberId"));
      const team = requireTeam(state, readString(input, "teamId"));
      const newLeadId = readString(input, "newLeadId");
      const newLead = assertAssignable(state, newLeadId);

      if (team.leadId === newLeadId) {
        throw toolError("conflict", `${team.id} is already led by ${newLeadId} (${newLead.name}).`);
      }

      const previous = team.leadId;
      team.leadId = newLeadId;

      audit(
        state,
        actingMember.id,
        "reassign_team_lead",
        "team",
        team.id,
        `Lead changed from ${previous ?? "nobody"} to ${newLeadId}.`,
      );

      return { updated: teamSummary(state, team) };
    },
  }),
];
