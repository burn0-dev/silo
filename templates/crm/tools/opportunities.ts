import {
  type OpportunityStatus,
  STALE_STAGE_DAYS,
  activitiesFor,
  isStale,
  money,
  nextId,
  nextStage,
  stagesInOrder,
} from "../state.js";
import {
  S,
  defineTool,
  matchesText,
  pagingProperties,
  paginate,
  readBoolean,
  readDate,
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
  activitySummary,
  actor,
  assertAssignable,
  assertOpen,
  audit,
  opportunitySummary,
  requireAccount,
  requireContact,
  requireOpportunity,
  requireStage,
  stageSummary,
} from "./helpers.js";

const opportunityStatuses: readonly OpportunityStatus[] = ["open", "won", "lost"];

export const opportunityTools = [
  defineTool({
    name: "list_stages",
    description:
      "List the pipeline stages in order, with the win probability each one carries. Probability lives on the stage, not on the opportunity.",
    inputSchema: schema({}),
    run(state) {
      return { results: stagesInOrder(state).map(stageSummary) };
    },
  }),

  defineTool({
    name: "list_opportunities",
    description:
      "List opportunities, optionally filtered by owner, account, stage, status or staleness.",
    inputSchema: schema({
      ownerId: S.string("Only opportunities owned by this user."),
      accountId: S.string("Only opportunities on this account."),
      stageId: S.string("Only opportunities in this stage."),
      status: S.enumeration("Only opportunities with this status.", opportunityStatuses),
      staleOnly: S.boolean(
        `Only open opportunities that have not moved stage in over ${STALE_STAGE_DAYS} days (default false).`,
      ),
      ...pagingProperties,
    }),
    run(state, input) {
      const ownerId = readOptionalString(input, "ownerId");
      const accountId = readOptionalString(input, "accountId");
      const stageId = readOptionalString(input, "stageId");
      const status = readOptionalEnum(input, "status", opportunityStatuses);
      const staleOnly = readBoolean(input, "staleOnly", false);

      const opportunities = Object.values(state.opportunities)
        .filter((opportunity) => (ownerId ? opportunity.ownerId === ownerId : true))
        .filter((opportunity) => (accountId ? opportunity.accountId === accountId : true))
        .filter((opportunity) => (stageId ? opportunity.stageId === stageId : true))
        .filter((opportunity) => (status ? opportunity.status === status : true))
        .filter((opportunity) =>
          staleOnly ? isStale(state, opportunity, STALE_STAGE_DAYS) : true,
        )
        .sort((a, b) => a.id.localeCompare(b.id));

      const page = paginate(opportunities, input);

      return {
        ...page,
        results: page.results.map((opportunity) => opportunitySummary(state, opportunity)),
      };
    },
  }),

  defineTool({
    name: "search_opportunities",
    description: "Search opportunities by name or by the account they belong to.",
    inputSchema: schema({ query: S.string("Free-text search term."), ...pagingProperties }, [
      "query",
    ]),
    run(state, input) {
      const query = readString(input, "query");

      const opportunities = Object.values(state.opportunities)
        .filter((opportunity) => {
          const account = state.accounts[opportunity.accountId];

          return (
            matchesText(opportunity.id, query) ||
            matchesText(opportunity.name, query) ||
            (account ? matchesText(account.name, query) : false)
          );
        })
        .sort((a, b) => a.id.localeCompare(b.id));

      const page = paginate(opportunities, input);

      return {
        ...page,
        results: page.results.map((opportunity) => opportunitySummary(state, opportunity)),
      };
    },
  }),

  defineTool({
    name: "get_opportunity",
    description:
      "Get one opportunity with its derived probability, weighted amount, days in stage and related activities.",
    inputSchema: schema({ opportunityId: S.string("Opportunity ID, e.g. 'OPP-003'.") }, [
      "opportunityId",
    ]),
    run(state, input) {
      const opportunity = requireOpportunity(state, readString(input, "opportunityId"));

      return {
        ...opportunitySummary(state, opportunity),
        stale: isStale(state, opportunity, STALE_STAGE_DAYS),
        activities: activitiesFor(state, { type: "opportunity", id: opportunity.id }).map(
          (activity) => activitySummary(state, activity),
        ),
      };
    },
  }),

  defineTool({
    name: "create_opportunity",
    description: "Create an opportunity against an existing account.",
    inputSchema: schema(
      {
        name: S.string("Opportunity name."),
        accountId: S.string("Account the opportunity belongs to."),
        ownerId: S.string("User who will own it."),
        amount: S.number("Deal amount.", { minimum: 0 }),
        expectedCloseDate: S.string("Expected close date, YYYY-MM-DD."),
        stageId: S.string("Starting stage. Defaults to the first open stage."),
        primaryContactId: S.string("Primary contact on the deal."),
        actorUserId: S.string("User performing the action."),
      },
      ["name", "accountId", "ownerId", "amount", "expectedCloseDate", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const account = requireAccount(state, readString(input, "accountId"));
      const ownerId = readString(input, "ownerId");
      assertAssignable(state, ownerId);

      const stageId = readOptionalString(input, "stageId");
      const stage = stageId
        ? requireStage(state, stageId)
        : stagesInOrder(state).find((candidate) => !candidate.isClosed);

      if (!stage) {
        throw toolError("invalid_state", "The pipeline has no open stage to start from.");
      }

      if (stage.isClosed) {
        throw toolError(
          "invalid_input",
          `Stage ${stage.id} is a closed stage; a new opportunity cannot start there.`,
        );
      }

      const primaryContactId = readOptionalString(input, "primaryContactId");

      if (primaryContactId) requireContact(state, primaryContactId);

      const opportunity = {
        id: nextId(state, "OPP"),
        name: readString(input, "name"),
        accountId: account.id,
        primaryContactId: primaryContactId ?? null,
        ownerId,
        stageId: stage.id,
        amount: money(readNumber(input, "amount", { min: 0 })),
        expectedCloseDate: readDate(input, "expectedCloseDate"),
        createdDate: state.now,
        stageEnteredDate: state.now,
        status: "open" as const,
        closedDate: null,
        lostReason: null,
        sourceLeadId: null,
      };

      state.opportunities[opportunity.id] = opportunity;
      audit(
        state,
        user.id,
        "create_opportunity",
        "opportunity",
        opportunity.id,
        `Created ${opportunity.name} on ${account.name}.`,
      );

      return { created: opportunitySummary(state, opportunity) };
    },
  }),

  defineTool({
    name: "update_opportunity",
    description:
      "Change an open opportunity's name, amount, expected close date or primary contact. Use set_opportunity_stage to move it through the pipeline.",
    inputSchema: schema(
      {
        opportunityId: S.string("Opportunity ID."),
        name: S.string("New name."),
        amount: S.number("New amount.", { minimum: 0 }),
        expectedCloseDate: S.string("New expected close date, YYYY-MM-DD."),
        primaryContactId: S.string("New primary contact."),
        actorUserId: S.string("User performing the action."),
      },
      ["opportunityId", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const opportunity = requireOpportunity(state, readString(input, "opportunityId"));
      assertOpen(opportunity);

      const name = readOptionalString(input, "name");
      const amount = readOptionalNumber(input, "amount", { min: 0 });
      const expectedCloseDate = readOptionalDate(input, "expectedCloseDate");
      const primaryContactId = readOptionalString(input, "primaryContactId");

      if (name !== undefined) opportunity.name = name;
      if (amount !== undefined) opportunity.amount = money(amount, opportunity.amount.currency);
      if (expectedCloseDate !== undefined) opportunity.expectedCloseDate = expectedCloseDate;

      if (primaryContactId !== undefined) {
        requireContact(state, primaryContactId);
        opportunity.primaryContactId = primaryContactId;
      }

      audit(
        state,
        user.id,
        "update_opportunity",
        "opportunity",
        opportunity.id,
        `Updated ${opportunity.name}.`,
      );

      return { updated: opportunitySummary(state, opportunity) };
    },
  }),

  defineTool({
    name: "set_opportunity_stage",
    description:
      "Move an open opportunity to a specific open stage. Resets the days-in-stage clock. Closed stages are set by close_opportunity_won and close_opportunity_lost instead.",
    inputSchema: schema(
      {
        opportunityId: S.string("Opportunity ID."),
        stageId: S.string("Stage to move into. Must be an open stage."),
        actorUserId: S.string("User performing the action."),
      },
      ["opportunityId", "stageId", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const opportunity = requireOpportunity(state, readString(input, "opportunityId"));
      assertOpen(opportunity);

      const stage = requireStage(state, readString(input, "stageId"));

      if (stage.isClosed) {
        throw toolError(
          "not_allowed",
          `Stage ${stage.id} is a closed stage. Use close_opportunity_won or close_opportunity_lost.`,
        );
      }

      const previous = opportunity.stageId;
      opportunity.stageId = stage.id;
      opportunity.stageEnteredDate = state.now;

      audit(
        state,
        user.id,
        "set_opportunity_stage",
        "opportunity",
        opportunity.id,
        `Moved ${opportunity.id} from ${previous} to ${stage.id}.`,
      );

      return { updated: opportunitySummary(state, opportunity) };
    },
  }),

  defineTool({
    name: "advance_opportunity_stage",
    description:
      "Move an open opportunity to the next open stage in the pipeline. Fails at the last open stage — close it instead.",
    inputSchema: schema(
      {
        opportunityId: S.string("Opportunity ID."),
        actorUserId: S.string("User performing the action."),
      },
      ["opportunityId", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const opportunity = requireOpportunity(state, readString(input, "opportunityId"));
      assertOpen(opportunity);

      const stage = nextStage(state, opportunity.stageId);

      if (!stage) {
        throw toolError(
          "invalid_state",
          `${opportunity.id} is already in the last open stage. Close it won or lost instead.`,
        );
      }

      const previous = opportunity.stageId;
      opportunity.stageId = stage.id;
      opportunity.stageEnteredDate = state.now;

      audit(
        state,
        user.id,
        "advance_opportunity_stage",
        "opportunity",
        opportunity.id,
        `Advanced ${opportunity.id} from ${previous} to ${stage.id}.`,
      );

      return { updated: opportunitySummary(state, opportunity) };
    },
  }),

  defineTool({
    name: "close_opportunity_won",
    description:
      "Close an open opportunity as won. Sets the closed-won stage, the close date and the final amount.",
    inputSchema: schema(
      {
        opportunityId: S.string("Opportunity ID."),
        finalAmount: S.number("Final contracted amount, if it differs from the current amount.", {
          minimum: 0,
        }),
        actorUserId: S.string("User performing the action."),
      },
      ["opportunityId", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const opportunity = requireOpportunity(state, readString(input, "opportunityId"));
      assertOpen(opportunity);

      const wonStage = stagesInOrder(state).find(
        (stage) => stage.isClosed && stage.probability === 100,
      );

      if (!wonStage) {
        throw toolError("invalid_state", "The pipeline has no closed-won stage.");
      }

      const finalAmount = readOptionalNumber(input, "finalAmount", { min: 0 });

      if (finalAmount !== undefined) {
        opportunity.amount = money(finalAmount, opportunity.amount.currency);
      }

      opportunity.stageId = wonStage.id;
      opportunity.stageEnteredDate = state.now;
      opportunity.status = "won";
      opportunity.closedDate = state.now;

      audit(
        state,
        user.id,
        "close_opportunity_won",
        "opportunity",
        opportunity.id,
        `Closed ${opportunity.id} won at ${opportunity.amount.amount}.`,
      );

      return { updated: opportunitySummary(state, opportunity) };
    },
  }),

  defineTool({
    name: "close_opportunity_lost",
    description: "Close an open opportunity as lost, with a reason.",
    inputSchema: schema(
      {
        opportunityId: S.string("Opportunity ID."),
        reason: S.string("Why the deal was lost."),
        actorUserId: S.string("User performing the action."),
      },
      ["opportunityId", "reason", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const opportunity = requireOpportunity(state, readString(input, "opportunityId"));
      assertOpen(opportunity);

      const lostStage = stagesInOrder(state).find(
        (stage) => stage.isClosed && stage.probability === 0,
      );

      if (!lostStage) {
        throw toolError("invalid_state", "The pipeline has no closed-lost stage.");
      }

      opportunity.stageId = lostStage.id;
      opportunity.stageEnteredDate = state.now;
      opportunity.status = "lost";
      opportunity.closedDate = state.now;
      opportunity.lostReason = readString(input, "reason");

      audit(
        state,
        user.id,
        "close_opportunity_lost",
        "opportunity",
        opportunity.id,
        `Closed ${opportunity.id} lost: ${opportunity.lostReason}`,
      );

      return { updated: opportunitySummary(state, opportunity) };
    },
  }),

  defineTool({
    name: "reassign_opportunity",
    description:
      "Move an open opportunity to a different owner. The new owner must be an active user. Use this when a rep leaves and their pipeline needs a home.",
    inputSchema: schema(
      {
        opportunityId: S.string("Opportunity ID."),
        newOwnerId: S.string("User who will take the opportunity over."),
        actorUserId: S.string("User performing the action."),
      },
      ["opportunityId", "newOwnerId", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const opportunity = requireOpportunity(state, readString(input, "opportunityId"));
      assertOpen(opportunity);

      const newOwnerId = readString(input, "newOwnerId");
      const newOwner = assertAssignable(state, newOwnerId);

      if (opportunity.ownerId === newOwnerId) {
        throw toolError(
          "conflict",
          `${opportunity.id} is already owned by ${newOwnerId} (${newOwner.name}).`,
        );
      }

      const previous = opportunity.ownerId;
      opportunity.ownerId = newOwnerId;

      audit(
        state,
        user.id,
        "reassign_opportunity",
        "opportunity",
        opportunity.id,
        `Reassigned ${opportunity.id} from ${previous} to ${newOwnerId}.`,
      );

      return { updated: opportunitySummary(state, opportunity) };
    },
  }),
];
