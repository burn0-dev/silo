import { contactsForAccount, fullName, nextId } from "../state.js";
import {
  S,
  defineTool,
  matchesText,
  pagingProperties,
  paginate,
  readBoolean,
  readOptionalString,
  readString,
  schema,
  toolError,
} from "./contract.js";
import {
  actor,
  audit,
  contactSummary,
  requireAccount,
  requireContact,
} from "./helpers.js";

export const contactTools = [
  defineTool({
    name: "list_contacts",
    description: "List contacts, optionally filtered by account or primary flag.",
    inputSchema: schema({
      accountId: S.string("Only contacts on this account."),
      primaryOnly: S.boolean("Only primary contacts (default false)."),
      ...pagingProperties,
    }),
    run(state, input) {
      const accountId = readOptionalString(input, "accountId");
      const primaryOnly = readBoolean(input, "primaryOnly", false);

      const contacts = Object.values(state.contacts)
        .filter((contact) => (accountId ? contact.accountId === accountId : true))
        .filter((contact) => (primaryOnly ? contact.isPrimary : true))
        .sort((a, b) => a.id.localeCompare(b.id));

      const page = paginate(contacts, input);

      return { ...page, results: page.results.map((contact) => contactSummary(state, contact)) };
    },
  }),

  defineTool({
    name: "search_contacts",
    description: "Search contacts by name, email or job title.",
    inputSchema: schema({ query: S.string("Free-text search term."), ...pagingProperties }, [
      "query",
    ]),
    run(state, input) {
      const query = readString(input, "query");

      const contacts = Object.values(state.contacts)
        .filter(
          (contact) =>
            matchesText(contact.id, query) ||
            matchesText(fullName(contact), query) ||
            matchesText(contact.email, query) ||
            (contact.title ? matchesText(contact.title, query) : false),
        )
        .sort((a, b) => a.id.localeCompare(b.id));

      const page = paginate(contacts, input);

      return { ...page, results: page.results.map((contact) => contactSummary(state, contact)) };
    },
  }),

  defineTool({
    name: "get_contact",
    description: "Get one contact with the account they belong to.",
    inputSchema: schema({ contactId: S.string("Contact ID, e.g. 'CON-001'.") }, ["contactId"]),
    run(state, input) {
      const contact = requireContact(state, readString(input, "contactId"));

      return contactSummary(state, contact);
    },
  }),

  defineTool({
    name: "create_contact",
    description:
      "Create a contact, optionally attached to an account. Marking one primary demotes the account's existing primary contact.",
    inputSchema: schema(
      {
        firstName: S.string("First name."),
        lastName: S.string("Last name."),
        email: S.string("Email address."),
        accountId: S.string("Account to attach the contact to."),
        phone: S.string("Phone number."),
        title: S.string("Job title."),
        isPrimary: S.boolean("Make this the account's primary contact (default false)."),
        actorUserId: S.string("User performing the action."),
      },
      ["firstName", "lastName", "email", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const accountId = readOptionalString(input, "accountId") ?? null;
      const isPrimary = readBoolean(input, "isPrimary", false);

      if (accountId) requireAccount(state, accountId);

      if (isPrimary && !accountId) {
        throw toolError("invalid_input", "A primary contact must belong to an account.");
      }

      if (isPrimary && accountId) {
        for (const existing of contactsForAccount(state, accountId)) {
          existing.isPrimary = false;
        }
      }

      const contact = {
        id: nextId(state, "CON"),
        accountId,
        firstName: readString(input, "firstName"),
        lastName: readString(input, "lastName"),
        email: readString(input, "email"),
        phone: readOptionalString(input, "phone") ?? null,
        title: readOptionalString(input, "title") ?? null,
        isPrimary,
      };

      state.contacts[contact.id] = contact;
      audit(
        state,
        user.id,
        "create_contact",
        "contact",
        contact.id,
        `Created ${fullName(contact)}.`,
      );

      return { created: contactSummary(state, contact) };
    },
  }),

  defineTool({
    name: "update_contact",
    description: "Change a contact's email, phone or job title.",
    inputSchema: schema(
      {
        contactId: S.string("Contact ID."),
        email: S.string("New email address."),
        phone: S.string("New phone number."),
        title: S.string("New job title."),
        actorUserId: S.string("User performing the action."),
      },
      ["contactId", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const contact = requireContact(state, readString(input, "contactId"));

      const email = readOptionalString(input, "email");
      const phone = readOptionalString(input, "phone");
      const title = readOptionalString(input, "title");

      if (email !== undefined) contact.email = email;
      if (phone !== undefined) contact.phone = phone;
      if (title !== undefined) contact.title = title;

      audit(
        state,
        user.id,
        "update_contact",
        "contact",
        contact.id,
        `Updated ${fullName(contact)}.`,
      );

      return { updated: contactSummary(state, contact) };
    },
  }),

  defineTool({
    name: "link_contact_to_account",
    description:
      "Attach a contact to an account, or move them to a different one. Use this for contacts created without an account.",
    inputSchema: schema(
      {
        contactId: S.string("Contact ID."),
        accountId: S.string("Account to attach the contact to."),
        makePrimary: S.boolean("Also make them the account's primary contact (default false)."),
        actorUserId: S.string("User performing the action."),
      },
      ["contactId", "accountId", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const contact = requireContact(state, readString(input, "contactId"));
      const account = requireAccount(state, readString(input, "accountId"));
      const makePrimary = readBoolean(input, "makePrimary", false);

      if (makePrimary) {
        for (const existing of contactsForAccount(state, account.id)) {
          existing.isPrimary = false;
        }
      }

      contact.accountId = account.id;
      if (makePrimary) contact.isPrimary = true;

      audit(
        state,
        user.id,
        "link_contact_to_account",
        "contact",
        contact.id,
        `Linked ${fullName(contact)} to ${account.name}.`,
      );

      return { updated: contactSummary(state, contact) };
    },
  }),
];
