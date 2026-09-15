import {
  type LeadSource,
  type LeadStatus,
  fullName,
  money,
  nextId,
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
  readEnum,
  readNumber,
  readOptionalEnum,
  readOptionalString,
  readString,
  schema,
  toolError,
} from "./contract.js";
import {
  accountSummary,
  actor,
  assertAssignable,
  audit,
  contactSummary,
  leadSummary,
  opportunitySummary,
  requireAccount,
  requireLead,
  requireStage,
} from "./helpers.js";

const leadStatuses: readonly LeadStatus[] = [
  "new",
  "working",
  "qualified",
  "disqualified",
  "converted",
];

const leadSources: readonly LeadSource[] = [
  "web_form",
  "referral",
  "event",
  "outbound",
  "partner",
  "inbound_call",
];

export const leadTools = [
  defineTool({
    name: "list_leads",
    description: "List leads, optionally filtered by status, owner or source.",
    inputSchema: schema({
      status: S.enumeration("Only leads with this status.", leadStatuses),
      ownerId: S.string("Only leads owned by this user."),
      source: S.enumeration("Only leads from this source.", leadSources),
      ...pagingProperties,
    }),
    run(state, input) {
      const status = readOptionalEnum(input, "status", leadStatuses);
      const ownerId = readOptionalString(input, "ownerId");
      const source = readOptionalEnum(input, "source", leadSources);

      const leads = Object.values(state.leads)
        .filter((lead) => (status ? lead.status === status : true))
        .filter((lead) => (ownerId ? lead.ownerId === ownerId : true))
        .filter((lead) => (source ? lead.source === source : true))
        .sort((a, b) => a.id.localeCompare(b.id));

      const page = paginate(leads, input);

      return { ...page, results: page.results.map((lead) => leadSummary(state, lead)) };
    },
  }),

  defineTool({
    name: "search_leads",
    description: "Search leads by name, company or email.",
    inputSchema: schema({ query: S.string("Free-text search term."), ...pagingProperties }, [
      "query",
    ]),
    run(state, input) {
      const query = readString(input, "query");

      const leads = Object.values(state.leads)
        .filter(
          (lead) =>
            matchesText(lead.id, query) ||
            matchesText(fullName(lead), query) ||
            matchesText(lead.company, query) ||
            matchesText(lead.email, query),
        )
        .sort((a, b) => a.id.localeCompare(b.id));

      const page = paginate(leads, input);

      return { ...page, results: page.results.map((lead) => leadSummary(state, lead)) };
    },
  }),

  defineTool({
    name: "get_lead",
    description:
      "Get one lead, including how long it has been open and, if it was converted, what it became.",
    inputSchema: schema({ leadId: S.string("Lead ID, e.g. 'LEAD-004'.") }, ["leadId"]),
    run(state, input) {
      const lead = requireLead(state, readString(input, "leadId"));

      return leadSummary(state, lead);
    },
  }),

  defineTool({
    name: "create_lead",
    description: "Create a new lead from an inbound enquiry or an outbound prospect.",
    inputSchema: schema(
      {
        firstName: S.string("First name."),
        lastName: S.string("Last name."),
        company: S.string("Company name."),
        email: S.string("Email address."),
        source: S.enumeration("Where the lead came from.", leadSources),
        ownerId: S.string("User who will own the lead."),
        phone: S.string("Phone number."),
        title: S.string("Job title."),
        actorUserId: S.string("User performing the action."),
      },
      ["firstName", "lastName", "company", "email", "source", "ownerId", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const ownerId = readString(input, "ownerId");
      assertAssignable(state, ownerId);

      const lead = {
        id: nextId(state, "LEAD"),
        firstName: readString(input, "firstName"),
        lastName: readString(input, "lastName"),
        company: readString(input, "company"),
        email: readString(input, "email"),
        phone: readOptionalString(input, "phone") ?? null,
        title: readOptionalString(input, "title") ?? null,
        source: readEnum(input, "source", leadSources),
        status: "new" as LeadStatus,
        ownerId,
        createdDate: state.now,
        lastContactedDate: null,
        disqualifyReason: null,
        convertedAccountId: null,
        convertedContactId: null,
        convertedOpportunityId: null,
      };

      state.leads[lead.id] = lead;
      audit(state, user.id, "create_lead", "lead", lead.id, `Created lead ${fullName(lead)}.`);

      return { created: leadSummary(state, lead) };
    },
  }),

  defineTool({
    name: "update_lead",
    description:
      "Change a lead's contact details, owner, or record that it was contacted today.",
    inputSchema: schema(
      {
        leadId: S.string("Lead ID."),
        email: S.string("New email address."),
        phone: S.string("New phone number."),
        title: S.string("New job title."),
        ownerId: S.string("New owner."),
        markContacted: S.boolean("Set the last contacted date to today (default false)."),
        actorUserId: S.string("User performing the action."),
      },
      ["leadId", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const lead = requireLead(state, readString(input, "leadId"));

      const email = readOptionalString(input, "email");
      const phone = readOptionalString(input, "phone");
      const title = readOptionalString(input, "title");
      const ownerId = readOptionalString(input, "ownerId");

      if (email !== undefined) lead.email = email;
      if (phone !== undefined) lead.phone = phone;
      if (title !== undefined) lead.title = title;

      if (ownerId !== undefined) {
        assertAssignable(state, ownerId);
        lead.ownerId = ownerId;
      }

      if (readBoolean(input, "markContacted", false)) {
        lead.lastContactedDate = state.now;
      }

      audit(state, user.id, "update_lead", "lead", lead.id, `Updated lead ${fullName(lead)}.`);

      return { updated: leadSummary(state, lead) };
    },
  }),

  defineTool({
    name: "qualify_lead",
    description:
      "Mark a lead as qualified, meaning it is ready to convert. Only a new or working lead can be qualified.",
    inputSchema: schema(
      {
        leadId: S.string("Lead ID."),
        actorUserId: S.string("User performing the action."),
      },
      ["leadId", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const lead = requireLead(state, readString(input, "leadId"));

      if (lead.status !== "new" && lead.status !== "working") {
        throw toolError(
          "invalid_state",
          `Lead ${lead.id} is ${lead.status}; only a new or working lead can be qualified.`,
        );
      }

      lead.status = "qualified";
      audit(state, user.id, "qualify_lead", "lead", lead.id, `Qualified ${fullName(lead)}.`);

      return { updated: leadSummary(state, lead) };
    },
  }),

  defineTool({
    name: "disqualify_lead",
    description: "Disqualify a lead with a reason. A converted lead cannot be disqualified.",
    inputSchema: schema(
      {
        leadId: S.string("Lead ID."),
        reason: S.string("Why the lead is not worth pursuing."),
        actorUserId: S.string("User performing the action."),
      },
      ["leadId", "reason", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const lead = requireLead(state, readString(input, "leadId"));

      if (lead.status === "converted") {
        throw toolError(
          "invalid_state",
          `Lead ${lead.id} has already been converted and cannot be disqualified.`,
        );
      }

      lead.status = "disqualified";
      lead.disqualifyReason = readString(input, "reason");
      audit(
        state,
        user.id,
        "disqualify_lead",
        "lead",
        lead.id,
        `Disqualified ${fullName(lead)}: ${lead.disqualifyReason}`,
      );

      return { updated: leadSummary(state, lead) };
    },
  }),

  defineTool({
    name: "convert_lead",
    description:
      "Convert a qualified lead into a contact on an account, and usually an opportunity. Pass accountId to attach to an existing account, or leave it out to create one from the lead's company. The lead keeps links to everything the conversion produced.",
    inputSchema: schema(
      {
        leadId: S.string("Lead ID. The lead must be qualified."),
        accountId: S.string("Existing account to convert into. Omitted means create a new one."),
        createOpportunity: S.boolean("Also create an opportunity (default true)."),
        opportunityName: S.string("Name for the new opportunity."),
        amount: S.number("Opportunity amount. Required when creating an opportunity.", {
          minimum: 0,
        }),
        expectedCloseDate: S.string("Expected close date, YYYY-MM-DD."),
        stageId: S.string("Starting stage. Defaults to the first open stage."),
        actorUserId: S.string("User performing the action."),
      },
      ["leadId", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const lead = requireLead(state, readString(input, "leadId"));

      if (lead.status !== "qualified") {
        throw toolError(
          "invalid_state",
          `Lead ${lead.id} is ${lead.status}; only a qualified lead can be converted.`,
        );
      }

      const ownerId = lead.ownerId;
      assertAssignable(state, ownerId);

      const existingAccountId = readOptionalString(input, "accountId");
      const account = existingAccountId
        ? requireAccount(state, existingAccountId)
        : (() => {
            const created = {
              id: nextId(state, "ACC"),
              name: lead.company,
              industry: "Unknown",
              tier: "smb" as const,
              ownerId,
              website: null,
              createdDate: state.now,
            };

            state.accounts[created.id] = created;

            return created;
          })();

      const contact = {
        id: nextId(state, "CON"),
        accountId: account.id,
        firstName: lead.firstName,
        lastName: lead.lastName,
        email: lead.email,
        phone: lead.phone,
        title: lead.title,
        isPrimary: false,
      };

      state.contacts[contact.id] = contact;

      let opportunityId: string | null = null;

      if (readBoolean(input, "createOpportunity", true)) {
        const amount = readNumber(input, "amount", { min: 0 });
        const expectedCloseDate = readDate(input, "expectedCloseDate");
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

        const opportunity = {
          id: nextId(state, "OPP"),
          name: readOptionalString(input, "opportunityName") ?? `${lead.company} opportunity`,
          accountId: account.id,
          primaryContactId: contact.id,
          ownerId,
          stageId: stage.id,
          amount: money(amount),
          expectedCloseDate,
          createdDate: state.now,
          stageEnteredDate: state.now,
          status: "open" as const,
          closedDate: null,
          lostReason: null,
          sourceLeadId: lead.id,
        };

        state.opportunities[opportunity.id] = opportunity;
        opportunityId = opportunity.id;
      }

      lead.status = "converted";
      lead.convertedAccountId = account.id;
      lead.convertedContactId = contact.id;
      lead.convertedOpportunityId = opportunityId;

      audit(
        state,
        user.id,
        "convert_lead",
        "lead",
        lead.id,
        `Converted ${fullName(lead)} into ${account.id} / ${contact.id}${
          opportunityId ? ` / ${opportunityId}` : ""
        }.`,
      );

      return {
        lead: leadSummary(state, lead),
        account: accountSummary(state, account),
        contact: contactSummary(state, contact),
        opportunity: opportunityId
          ? opportunitySummary(state, state.opportunities[opportunityId]!)
          : null,
      };
    },
  }),
];
