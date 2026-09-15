import {
  type AccountTier,
  contactsForAccount,
  nextId,
  opportunitiesForAccount,
} from "../state.js";
import {
  S,
  defineTool,
  matchesText,
  pagingProperties,
  paginate,
  readEnum,
  readOptionalEnum,
  readOptionalString,
  readString,
  schema,
} from "./contract.js";
import {
  accountSummary,
  assertAssignable,
  actor,
  audit,
  contactSummary,
  opportunitySummary,
  requireAccount,
} from "./helpers.js";

const accountTiers: readonly AccountTier[] = ["enterprise", "mid_market", "smb"];

export const accountTools = [
  defineTool({
    name: "list_accounts",
    description: "List customer accounts, optionally filtered by owner, tier or industry.",
    inputSchema: schema({
      ownerId: S.string("Only accounts owned by this user."),
      tier: S.enumeration("Only accounts in this tier.", accountTiers),
      industry: S.string("Only accounts in this industry."),
      ...pagingProperties,
    }),
    run(state, input) {
      const ownerId = readOptionalString(input, "ownerId");
      const tier = readOptionalEnum(input, "tier", accountTiers);
      const industry = readOptionalString(input, "industry");

      const accounts = Object.values(state.accounts)
        .filter((account) => (ownerId ? account.ownerId === ownerId : true))
        .filter((account) => (tier ? account.tier === tier : true))
        .filter((account) => (industry ? matchesText(account.industry, industry) : true))
        .sort((a, b) => a.id.localeCompare(b.id));

      const page = paginate(accounts, input);

      return { ...page, results: page.results.map((account) => accountSummary(state, account)) };
    },
  }),

  defineTool({
    name: "search_accounts",
    description: "Search accounts by name, industry or website.",
    inputSchema: schema({ query: S.string("Free-text search term."), ...pagingProperties }, [
      "query",
    ]),
    run(state, input) {
      const query = readString(input, "query");

      const accounts = Object.values(state.accounts)
        .filter(
          (account) =>
            matchesText(account.id, query) ||
            matchesText(account.name, query) ||
            matchesText(account.industry, query) ||
            (account.website ? matchesText(account.website, query) : false),
        )
        .sort((a, b) => a.id.localeCompare(b.id));

      const page = paginate(accounts, input);

      return { ...page, results: page.results.map((account) => accountSummary(state, account)) };
    },
  }),

  defineTool({
    name: "get_account",
    description:
      "Get one account with its contacts and every opportunity against it, open and closed.",
    inputSchema: schema({ accountId: S.string("Account ID, e.g. 'ACC-001'.") }, ["accountId"]),
    run(state, input) {
      const account = requireAccount(state, readString(input, "accountId"));

      return {
        ...accountSummary(state, account),
        contacts: contactsForAccount(state, account.id).map((contact) =>
          contactSummary(state, contact),
        ),
        opportunities: opportunitiesForAccount(state, account.id).map((opportunity) =>
          opportunitySummary(state, opportunity),
        ),
      };
    },
  }),

  defineTool({
    name: "create_account",
    description:
      "Create a new account. Use this when a lead's company does not exist yet; check with search_accounts first so you do not create a duplicate.",
    inputSchema: schema(
      {
        name: S.string("Company name."),
        industry: S.string("Industry, e.g. 'Software'."),
        tier: S.enumeration("Account tier.", accountTiers),
        ownerId: S.string("User who will own the account."),
        website: S.string("Website, without the scheme."),
        actorUserId: S.string("User performing the action."),
      },
      ["name", "industry", "tier", "ownerId", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const ownerId = readString(input, "ownerId");
      assertAssignable(state, ownerId);

      const account = {
        id: nextId(state, "ACC"),
        name: readString(input, "name"),
        industry: readString(input, "industry"),
        tier: readEnum(input, "tier", accountTiers),
        ownerId,
        website: readOptionalString(input, "website") ?? null,
        createdDate: state.now,
      };

      state.accounts[account.id] = account;
      audit(state, user.id, "create_account", "account", account.id, `Created ${account.name}.`);

      return { created: accountSummary(state, account) };
    },
  }),

  defineTool({
    name: "update_account",
    description: "Change an account's industry, tier, website or owner.",
    inputSchema: schema(
      {
        accountId: S.string("Account ID."),
        industry: S.string("New industry."),
        tier: S.enumeration("New tier.", accountTiers),
        website: S.string("New website."),
        ownerId: S.string("New owner."),
        actorUserId: S.string("User performing the action."),
      },
      ["accountId", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const account = requireAccount(state, readString(input, "accountId"));

      const industry = readOptionalString(input, "industry");
      const tier = readOptionalEnum(input, "tier", accountTiers);
      const website = readOptionalString(input, "website");
      const ownerId = readOptionalString(input, "ownerId");

      if (industry !== undefined) account.industry = industry;
      if (tier !== undefined) account.tier = tier;
      if (website !== undefined) account.website = website;

      if (ownerId !== undefined) {
        assertAssignable(state, ownerId);
        account.ownerId = ownerId;
      }

      audit(state, user.id, "update_account", "account", account.id, `Updated ${account.name}.`);

      return { updated: accountSummary(state, account) };
    },
  }),
];
