import {
  type Customer,
  type CustomerStatus,
  type PaymentTerms,
  isOverdue,
  nextId,
  outstandingAmount,
  subtractMoney,
  sumMoney,
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
  toolError,
} from "./contract.js";
import {
  actor,
  audit,
  customerSummary,
  requireCustomer,
} from "./helpers.js";

const customerStatuses: readonly CustomerStatus[] = [
  "active",
  "inactive",
  "blocked",
  "credit_hold",
];

const paymentTermsValues: readonly PaymentTerms[] = [
  "NET_15",
  "NET_30",
  "NET_45",
  "NET_60",
  "DUE_ON_RECEIPT",
];

export const customerTools = [
  defineTool({
    name: "list_customers",
    description: "List customers, optionally filtered by status or segment.",
    inputSchema: schema({
      status: S.enumeration("Only customers with this status.", customerStatuses),
      segment: S.string("Only customers in this segment."),
      ...pagingProperties,
    }),
    run(state, input) {
      const status = readOptionalEnum(input, "status", customerStatuses);
      const segment = readOptionalString(input, "segment");

      const customers = Object.values(state.customers)
        .filter((customer) => (status ? customer.status === status : true))
        .filter((customer) => (segment ? matchesText(customer.segment, segment) : true))
        .sort((a, b) => a.id.localeCompare(b.id));

      const page = paginate(customers, input);

      return { ...page, results: page.results.map(customerSummary) };
    },
  }),

  defineTool({
    name: "search_customers",
    description: "Search customers by name, code, segment or contact email.",
    inputSchema: schema(
      { query: S.string("Free-text search term."), ...pagingProperties },
      ["query"],
    ),
    run(state, input) {
      const query = readString(input, "query");

      const customers = Object.values(state.customers)
        .filter(
          (customer) =>
            matchesText(customer.name, query) ||
            matchesText(customer.code, query) ||
            matchesText(customer.segment, query) ||
            matchesText(customer.contact.email, query),
        )
        .sort((a, b) => a.id.localeCompare(b.id));

      const page = paginate(customers, input);

      return { ...page, results: page.results.map(customerSummary) };
    },
  }),

  defineTool({
    name: "get_customer",
    description: "Get the full record for one customer.",
    inputSchema: schema({ customerId: S.string("Customer ID, e.g. 'CUS-001'.") }, [
      "customerId",
    ]),
    run(state, input) {
      return requireCustomer(state, readString(input, "customerId"));
    },
  }),

  defineTool({
    name: "create_customer",
    description: "Create a new customer with a credit limit and payment terms.",
    inputSchema: schema(
      {
        name: S.string("Customer name."),
        segment: S.string("Industry segment."),
        creditLimit: S.number("Credit limit in company currency.", { minimum: 0 }),
        paymentTerms: S.enumeration("Agreed payment terms.", paymentTermsValues),
        contactName: S.string("Primary contact name."),
        contactEmail: S.string("Primary contact email."),
        actorUserId: S.string("User performing the action."),
      },
      ["name", "paymentTerms", "contactEmail", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const name = readString(input, "name");

      const duplicate = Object.values(state.customers).find(
        (customer) => customer.name.toLowerCase() === name.toLowerCase(),
      );

      if (duplicate) {
        throw toolError(
          "conflict",
          `A customer named "${name}" already exists as ${duplicate.id}.`,
          { customerId: duplicate.id },
        );
      }

      const emptyAddress = {
        line1: "",
        city: "",
        region: "",
        postalCode: "",
        country: state.company.address.country,
      };

      const customer: Customer = {
        id: nextId(state, "CUS"),
        code: name.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12),
        name,
        status: "active",
        segment: readOptionalString(input, "segment") ?? "general",
        creditLimit: {
          amount: typeof input["creditLimit"] === "number" ? input["creditLimit"] : 0,
          currency: state.company.baseCurrency,
        },
        paymentTerms: readEnum(input, "paymentTerms", paymentTermsValues),
        currency: state.company.baseCurrency,
        contact: {
          name: readOptionalString(input, "contactName") ?? "",
          email: readString(input, "contactEmail"),
          phone: "",
        },
        billingAddress: emptyAddress,
        shippingAddress: { ...emptyAddress },
        createdAt: state.now,
        statusReason: null,
      };

      state.customers[customer.id] = customer;

      audit(state, user.id, "customer.created", "customer", customer.id, `Created customer ${customer.name}`);

      return customer;
    },
  }),

  defineTool({
    name: "update_customer",
    description: "Update customer payment terms, credit limit or contact details.",
    inputSchema: schema(
      {
        customerId: S.string("Customer ID."),
        paymentTerms: S.enumeration("New payment terms.", paymentTermsValues),
        creditLimit: S.number("New credit limit.", { minimum: 0 }),
        contactName: S.string("New contact name."),
        contactEmail: S.string("New contact email."),
        actorUserId: S.string("User performing the action."),
      },
      ["customerId", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const customer = requireCustomer(state, readString(input, "customerId"));
      const changes: Array<{ field: string; from: unknown; to: unknown }> = [];

      const terms = readOptionalEnum(input, "paymentTerms", paymentTermsValues);
      if (terms && terms !== customer.paymentTerms) {
        changes.push({ field: "paymentTerms", from: customer.paymentTerms, to: terms });
        customer.paymentTerms = terms;
      }

      if (typeof input["creditLimit"] === "number") {
        changes.push({ field: "creditLimit", from: customer.creditLimit.amount, to: input["creditLimit"] });
        customer.creditLimit = { amount: input["creditLimit"], currency: customer.currency };
      }

      const contactName = readOptionalString(input, "contactName");
      if (contactName) {
        changes.push({ field: "contact.name", from: customer.contact.name, to: contactName });
        customer.contact.name = contactName;
      }

      const contactEmail = readOptionalString(input, "contactEmail");
      if (contactEmail) {
        changes.push({ field: "contact.email", from: customer.contact.email, to: contactEmail });
        customer.contact.email = contactEmail;
      }

      if (changes.length === 0) {
        throw toolError("invalid_input", "No customer fields were supplied to update.");
      }

      audit(state, user.id, "customer.updated", "customer", customer.id, `Updated ${customer.name}`, changes);

      return customer;
    },
  }),

  defineTool({
    name: "activate_customer",
    description: "Return a customer to active trading, clearing any hold or block.",
    inputSchema: schema(
      { customerId: S.string("Customer ID."), actorUserId: S.string("User performing the action.") },
      ["customerId", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const customer = requireCustomer(state, readString(input, "customerId"));

      if (customer.status === "active") {
        throw toolError("invalid_state", `Customer ${customer.id} is already active.`);
      }

      const previous = customer.status;
      customer.status = "active";
      customer.statusReason = null;

      audit(state, user.id, "customer.activated", "customer", customer.id, `Activated ${customer.name}`, [
        { field: "status", from: previous, to: "active" },
      ]);

      return customer;
    },
  }),

  defineTool({
    name: "block_customer",
    description:
      "Block a customer or place them on credit hold. Neither can have orders fulfilled.",
    inputSchema: schema(
      {
        customerId: S.string("Customer ID."),
        status: S.enumeration("Which restriction to apply.", ["blocked", "credit_hold"]),
        reason: S.string("Why the restriction is being applied."),
        actorUserId: S.string("User performing the action."),
      },
      ["customerId", "status", "reason", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const customer = requireCustomer(state, readString(input, "customerId"));
      const status = readEnum(input, "status", ["blocked", "credit_hold"] as const);
      const reason = readString(input, "reason");

      if (customer.status === status) {
        throw toolError("invalid_state", `Customer ${customer.id} is already ${status}.`);
      }

      const previous = customer.status;
      customer.status = status;
      customer.statusReason = reason;

      audit(state, user.id, `customer.${status}`, "customer", customer.id, `${customer.name}: ${reason}`, [
        { field: "status", from: previous, to: status },
      ]);

      return customer;
    },
  }),

  defineTool({
    name: "get_customer_balance",
    description:
      "Receivable balance for a customer, including overdue amount and remaining credit.",
    inputSchema: schema({ customerId: S.string("Customer ID.") }, ["customerId"]),
    run(state, input) {
      const customer = requireCustomer(state, readString(input, "customerId"));

      const invoices = Object.values(state.customerInvoices).filter(
        (invoice) =>
          invoice.customerId === customer.id &&
          invoice.status !== "cancelled" &&
          invoice.status !== "written_off" &&
          invoice.status !== "draft",
      );

      const outstanding = sumMoney(
        invoices.map((invoice) => outstandingAmount(invoice)),
        customer.currency,
      );

      const overdue = sumMoney(
        invoices
          .filter((invoice) => isOverdue(invoice, state.now))
          .map((invoice) => outstandingAmount(invoice)),
        customer.currency,
      );

      return {
        customerId: customer.id,
        customerName: customer.name,
        status: customer.status,
        openInvoiceCount: invoices.filter((invoice) => invoice.status !== "paid").length,
        totalOutstanding: outstanding,
        overdueOutstanding: overdue,
        creditLimit: customer.creditLimit,
        creditAvailable: subtractMoney(customer.creditLimit, outstanding),
      };
    },
  })

  ];
