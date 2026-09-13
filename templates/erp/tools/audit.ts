import type { AuditEntityType } from "../state.js";
import {
  S,
  defineTool,
  matchesText,
  pagingProperties,
  paginate,
  readOptionalEnum,
  readOptionalNumber,
  readOptionalString,
  readString,
  schema,
} from "./contract.js";
import { requireUser } from "./helpers.js";

const entityTypes: readonly AuditEntityType[] = [
  "company",
  "vendor",
  "customer",
  "product",
  "warehouse",
  "inventory",
  "requisition",
  "approval",
  "rfq",
  "quotation",
  "purchase_order",
  "goods_receipt",
  "discrepancy",
  "vendor_invoice",
  "three_way_match",
  "payment",
  "sales_order",
  "fulfillment",
  "customer_invoice",
  "expense",
  "budget",
];

export const auditTools = [
  defineTool({
    name: "list_audit_events",
    description:
      "List audit events, most recent first, optionally filtered by entity type, actor, action or date range.",
    inputSchema: schema({
      entityType: S.enumeration("Only events about this kind of document.", entityTypes),
      actorUserId: S.string("Only events by this user."),
      action: S.string("Only events whose action contains this text, e.g. 'approved'."),
      fromDate: S.string("ISO lower bound."),
      toDate: S.string("ISO upper bound."),
      ...pagingProperties,
    }),
    run(state, input) {
      const entityType = readOptionalEnum(input, "entityType", entityTypes);
      const actorUserId = readOptionalString(input, "actorUserId");
      const action = readOptionalString(input, "action");
      const fromDate = readOptionalString(input, "fromDate") ?? "0000-01-01";
      const toDate = readOptionalString(input, "toDate") ?? "9999-12-31";

      const events = state.auditLog
        .filter((event) => (entityType ? event.entityType === entityType : true))
        .filter((event) => (actorUserId ? event.actorUserId === actorUserId : true))
        .filter((event) => (action ? matchesText(event.action, action) : true))
        .filter((event) => event.at >= fromDate && event.at <= toDate)
        .slice()
        .sort((a, b) => b.at.localeCompare(a.at));

      return paginate(events, input);
    },
  }),

  defineTool({
    name: "get_entity_history",
    description:
      "Full audit trail for one document, oldest first. Use this to reconstruct what happened to an invoice, order or requisition.",
    inputSchema: schema({ entityId: S.string("Document ID, e.g. 'PO-203'.") }, ["entityId"]),
    run(state, input) {
      const entityId = readString(input, "entityId");

      const events = state.auditLog
        .filter((event) => event.entityId === entityId)
        .slice()
        .sort((a, b) => a.at.localeCompare(b.at));

      return {
        entityId,
        eventCount: events.length,
        firstSeen: events[0]?.at ?? null,
        lastSeen: events[events.length - 1]?.at ?? null,
        events,
      };
    },
  }),

  defineTool({
    name: "get_user_activity",
    description: "What one user has done, most recent first.",
    inputSchema: schema(
      { userId: S.string("User ID."), ...pagingProperties },
      ["userId"],
    ),
    run(state, input) {
      const user = requireUser(state, readString(input, "userId"));

      const events = state.auditLog
        .filter((event) => event.actorUserId === user.id)
        .slice()
        .sort((a, b) => b.at.localeCompare(a.at));

      const byAction = new Map<string, number>();
      for (const event of events) {
        byAction.set(event.action, (byAction.get(event.action) ?? 0) + 1);
      }

      return {
        userId: user.id,
        name: user.name,
        role: user.role,
        ...paginate(events, input),
        actionCounts: [...byAction.entries()]
          .map(([action, count]) => ({ action, count }))
          .sort((a, b) => b.count - a.count),
      };
    },
  }),

  defineTool({
    name: "get_recent_changes",
    description:
      "The most recent activity across the whole business, for catching up on what has changed.",
    inputSchema: schema({
      limit: S.integer("How many events to return (default 20).", { minimum: 1, maximum: 200 }),
    }),
    run(state, input) {
      const limit = readOptionalNumber(input, "limit", { min: 1, max: 200, integer: true }) ?? 20;

      return {
        asOf: state.now,
        events: state.auditLog
          .slice()
          .sort((a, b) => b.at.localeCompare(a.at))
          .slice(0, limit),
      };
    },
  }),
];
