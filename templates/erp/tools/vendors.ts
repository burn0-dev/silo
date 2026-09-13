import {
  type PaymentTerms,
  type Vendor,
  type VendorStatus,
  nextId,
  outstandingAmount,
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
  readOptionalNumber,
  readOptionalString,
  readString,
  schema,
  toolError,
} from "./contract.js";
import {
  actor,
  audit,
  requireVendor,
  vendorSummary,
} from "./helpers.js";

const vendorStatuses: readonly VendorStatus[] = [
  "active",
  "inactive",
  "blocked",
  "pending_approval",
];

const paymentTermsValues: readonly PaymentTerms[] = [
  "NET_15",
  "NET_30",
  "NET_45",
  "NET_60",
  "DUE_ON_RECEIPT",
];

export const vendorTools = [
  defineTool({
    name: "list_vendors",
    description:
      "List vendors, optionally filtered by status, category or preferred flag.",
    inputSchema: schema({
      status: S.enumeration("Only vendors with this status.", vendorStatuses),
      category: S.string("Only vendors supplying this category, e.g. 'bearings'."),
      preferredOnly: S.boolean("Only vendors flagged as preferred suppliers."),
      ...pagingProperties,
    }),
    run(state, input) {
      const status = readOptionalEnum(input, "status", vendorStatuses);
      const category = readOptionalString(input, "category");
      const preferredOnly = input["preferredOnly"] === true;

      const vendors = Object.values(state.vendors)
        .filter((vendor) => (status ? vendor.status === status : true))
        .filter((vendor) =>
          category
            ? vendor.categories.some((value) => matchesText(value, category))
            : true,
        )
        .filter((vendor) => (preferredOnly ? vendor.isPreferred : true))
        .sort((a, b) => a.id.localeCompare(b.id));

      const page = paginate(vendors, input);

      return { ...page, results: page.results.map(vendorSummary) };
    },
  }),

  defineTool({
    name: "search_vendors",
    description: "Search vendors by name, code, category or contact email.",
    inputSchema: schema(
      { query: S.string("Free-text search term."), ...pagingProperties },
      ["query"],
    ),
    run(state, input) {
      const query = readString(input, "query");

      const vendors = Object.values(state.vendors)
        .filter(
          (vendor) =>
            matchesText(vendor.name, query) ||
            matchesText(vendor.code, query) ||
            matchesText(vendor.contact.email, query) ||
            vendor.categories.some((category) => matchesText(category, query)),
        )
        .sort((a, b) => a.id.localeCompare(b.id));

      const page = paginate(vendors, input);

      return { ...page, results: page.results.map(vendorSummary) };
    },
  }),

  defineTool({
    name: "get_vendor",
    description: "Get the full record for one vendor.",
    inputSchema: schema({ vendorId: S.string("Vendor ID, e.g. 'VEN-001'.") }, [
      "vendorId",
    ]),
    run(state, input) {
      return requireVendor(state, readString(input, "vendorId"));
    },
  }),

  defineTool({
    name: "create_vendor",
    description:
      "Create a new vendor. New vendors start in 'pending_approval' until qualified.",
    inputSchema: schema(
      {
        name: S.string("Vendor legal or trading name."),
        categories: S.array("Supply categories.", S.string("Category name.")),
        paymentTerms: S.enumeration("Agreed payment terms.", paymentTermsValues),
        contactName: S.string("Primary contact name."),
        contactEmail: S.string("Primary contact email."),
        contactPhone: S.string("Primary contact phone."),
        leadTimeDays: S.integer("Typical lead time in days.", { minimum: 0 }),
        actorUserId: S.string("User performing the action."),
      },
      ["name", "paymentTerms", "contactEmail", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const name = readString(input, "name");

      const duplicate = Object.values(state.vendors).find(
        (vendor) => vendor.name.toLowerCase() === name.toLowerCase(),
      );

      if (duplicate) {
        throw toolError(
          "conflict",
          `A vendor named "${name}" already exists as ${duplicate.id}.`,
          { vendorId: duplicate.id },
        );
      }

      const categories = Array.isArray(input["categories"])
        ? (input["categories"] as unknown[]).map((value) => String(value))
        : [];

      const vendor: Vendor = {
        id: nextId(state, "VEN"),
        code: name.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10),
        name,
        status: "pending_approval",
        categories,
        paymentTerms: readEnum(input, "paymentTerms", paymentTermsValues),
        currency: state.company.baseCurrency,
        contact: {
          name: readOptionalString(input, "contactName") ?? "",
          email: readString(input, "contactEmail"),
          phone: readOptionalString(input, "contactPhone") ?? "",
        },
        address: {
          line1: "",
          city: "",
          region: "",
          postalCode: "",
          country: state.company.address.country,
        },
        taxId: "",
        rating: 0,
        leadTimeDays: readOptionalNumber(input, "leadTimeDays", { min: 0, integer: true }) ?? 14,
        isPreferred: false,
        createdAt: state.now,
        statusReason: "Awaiting supplier qualification.",
      };

      state.vendors[vendor.id] = vendor;

      audit(state, user.id, "vendor.created", "vendor", vendor.id, `Created vendor ${vendor.name}`);

      return vendor;
    },
  }),

  defineTool({
    name: "update_vendor",
    description:
      "Update vendor details such as payment terms, lead time, contact or preferred flag.",
    inputSchema: schema(
      {
        vendorId: S.string("Vendor ID."),
        paymentTerms: S.enumeration("New payment terms.", paymentTermsValues),
        leadTimeDays: S.integer("New lead time in days.", { minimum: 0 }),
        contactName: S.string("New primary contact name."),
        contactEmail: S.string("New primary contact email."),
        contactPhone: S.string("New primary contact phone."),
        isPreferred: S.boolean("Whether this is a preferred supplier."),
        actorUserId: S.string("User performing the action."),
      },
      ["vendorId", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const vendor = requireVendor(state, readString(input, "vendorId"));
      const changes: Array<{ field: string; from: unknown; to: unknown }> = [];

      const terms = readOptionalEnum(input, "paymentTerms", paymentTermsValues);
      if (terms && terms !== vendor.paymentTerms) {
        changes.push({ field: "paymentTerms", from: vendor.paymentTerms, to: terms });
        vendor.paymentTerms = terms;
      }

      const leadTime = readOptionalNumber(input, "leadTimeDays", { min: 0, integer: true });
      if (leadTime !== undefined && leadTime !== vendor.leadTimeDays) {
        changes.push({ field: "leadTimeDays", from: vendor.leadTimeDays, to: leadTime });
        vendor.leadTimeDays = leadTime;
      }

      const contactName = readOptionalString(input, "contactName");
      if (contactName) {
        changes.push({ field: "contact.name", from: vendor.contact.name, to: contactName });
        vendor.contact.name = contactName;
      }

      const contactEmail = readOptionalString(input, "contactEmail");
      if (contactEmail) {
        changes.push({ field: "contact.email", from: vendor.contact.email, to: contactEmail });
        vendor.contact.email = contactEmail;
      }

      const contactPhone = readOptionalString(input, "contactPhone");
      if (contactPhone) {
        changes.push({ field: "contact.phone", from: vendor.contact.phone, to: contactPhone });
        vendor.contact.phone = contactPhone;
      }

      if (typeof input["isPreferred"] === "boolean" && input["isPreferred"] !== vendor.isPreferred) {
        changes.push({ field: "isPreferred", from: vendor.isPreferred, to: input["isPreferred"] });
        vendor.isPreferred = input["isPreferred"];
      }

      if (changes.length === 0) {
        throw toolError("invalid_input", "No vendor fields were supplied to update.");
      }

      audit(state, user.id, "vendor.updated", "vendor", vendor.id, `Updated ${vendor.name}`, changes);

      return vendor;
    },
  }),

  defineTool({
    name: "activate_vendor",
    description: "Activate a vendor so it can receive purchase orders.",
    inputSchema: schema(
      { vendorId: S.string("Vendor ID."), actorUserId: S.string("User performing the action.") },
      ["vendorId", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const vendor = requireVendor(state, readString(input, "vendorId"));

      if (vendor.status === "active") {
        throw toolError("invalid_state", `Vendor ${vendor.id} is already active.`);
      }

      const previous = vendor.status;
      vendor.status = "active";
      vendor.statusReason = null;

      audit(state, user.id, "vendor.activated", "vendor", vendor.id, `Activated ${vendor.name}`, [
        { field: "status", from: previous, to: "active" },
      ]);

      return vendor;
    },
  }),

  defineTool({
    name: "block_vendor",
    description:
      "Block a vendor. Blocked vendors cannot be issued new purchase orders.",
    inputSchema: schema(
      {
        vendorId: S.string("Vendor ID."),
        reason: S.string("Why the vendor is being blocked."),
        actorUserId: S.string("User performing the action."),
      },
      ["vendorId", "reason", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const vendor = requireVendor(state, readString(input, "vendorId"));
      const reason = readString(input, "reason");

      if (vendor.status === "blocked") {
        throw toolError("invalid_state", `Vendor ${vendor.id} is already blocked.`);
      }

      const previous = vendor.status;
      vendor.status = "blocked";
      vendor.statusReason = reason;

      audit(state, user.id, "vendor.blocked", "vendor", vendor.id, `Blocked ${vendor.name}: ${reason}`, [
        { field: "status", from: previous, to: "blocked" },
      ]);

      return vendor;
    },
  }),

  defineTool({
    name: "get_vendor_balance",
    description:
      "Outstanding payable balance for a vendor, split by invoice status.",
    inputSchema: schema({ vendorId: S.string("Vendor ID.") }, ["vendorId"]),
    run(state, input) {
      const vendor = requireVendor(state, readString(input, "vendorId"));

      const invoices = Object.values(state.vendorInvoices).filter(
        (invoice) =>
          invoice.vendorId === vendor.id &&
          invoice.status !== "cancelled" &&
          invoice.status !== "rejected",
      );

      const outstanding = invoices.map((invoice) => outstandingAmount(invoice));
      const overdue = invoices
        .filter((invoice) => invoice.dueDate < state.now && invoice.status !== "paid")
        .map((invoice) => outstandingAmount(invoice));

      return {
        vendorId: vendor.id,
        vendorName: vendor.name,
        openInvoiceCount: invoices.filter((invoice) => invoice.status !== "paid").length,
        totalOutstanding: sumMoney(outstanding, vendor.currency),
        overdueOutstanding: sumMoney(overdue, vendor.currency),
        currency: vendor.currency,
      };
    },
  })

  ];
