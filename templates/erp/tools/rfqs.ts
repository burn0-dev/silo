import { type Rfq, type RfqStatus, addDays, nextId } from "../state.js";
import {
  S,
  defineTool,
  pagingProperties,
  paginate,
  readNumber,
  readObjectArray,
  readOptionalEnum,
  readOptionalString,
  readString,
  readStringArray,
  schema,
  toolError,
} from "./contract.js";
import {
  actor,
  assertStatus,
  audit,
  requireProduct,
  requireRfq,
  requireVendor,
} from "./helpers.js";

const rfqStatuses: readonly RfqStatus[] = [
  "draft",
  "sent",
  "closed",
  "awarded",
  "cancelled",
];

const rfqSummary = (rfq: Rfq, quotationCount: number) => ({
  id: rfq.id,
  title: rfq.title,
  status: rfq.status,
  requisitionId: rfq.requisitionId,
  invitedVendorCount: rfq.invitedVendorIds.length,
  quotationCount,
  responseDueDate: rfq.responseDueDate,
  awardedQuotationId: rfq.awardedQuotationId,
});

function countQuotations(
  state: Parameters<typeof requireRfq>[0],
  rfqId: string,
): number {
  return Object.values(state.quotations).filter((quotation) => quotation.rfqId === rfqId).length;
}

export const rfqTools = [
  defineTool({
    name: "list_rfqs",
    description: "List requests for quotation, optionally filtered by status.",
    inputSchema: schema({
      status: S.enumeration("Only RFQs with this status.", rfqStatuses),
      ...pagingProperties,
    }),
    run(state, input) {
      const status = readOptionalEnum(input, "status", rfqStatuses);

      const rfqs = Object.values(state.rfqs)
        .filter((rfq) => (status ? rfq.status === status : true))
        .sort((a, b) => a.id.localeCompare(b.id));

      const page = paginate(rfqs, input);

      return {
        ...page,
        results: page.results.map((rfq) => rfqSummary(rfq, countQuotations(state, rfq.id))),
      };
    },
  }),

  defineTool({
    name: "get_rfq",
    description: "Get one RFQ with its lines, invited vendors and quotations received.",
    inputSchema: schema({ rfqId: S.string("RFQ ID, e.g. 'RFQ-001'.") }, ["rfqId"]),
    run(state, input) {
      const rfq = requireRfq(state, readString(input, "rfqId"));

      const quotations = Object.values(state.quotations)
        .filter((quotation) => quotation.rfqId === rfq.id)
        .map((quotation) => ({
          id: quotation.id,
          vendorId: quotation.vendorId,
          status: quotation.status,
          totalAmount: quotation.totalAmount,
          leadTimeDays: quotation.leadTimeDays,
          validUntil: quotation.validUntil,
        }))
        .sort((a, b) => a.id.localeCompare(b.id));

      return { ...rfq, quotations };
    },
  }),

  defineTool({
    name: "create_rfq",
    description:
      "Create a standalone RFQ that is not tied to a requisition. Starts in draft.",
    inputSchema: schema(
      {
        title: S.string("RFQ title."),
        lines: S.array(
          "Lines to request pricing for.",
          S.object(
            "RFQ line.",
            {
              productId: S.string("Product ID."),
              quantity: S.integer("Quantity required.", { minimum: 1 }),
            },
            ["productId", "quantity"],
          ),
        ),
        vendorIds: S.array("Vendors to invite.", S.string("Vendor ID.")),
        responseDueDate: S.string("ISO date responses are due."),
        actorUserId: S.string("User performing the action."),
      },
      ["title", "lines", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const id = nextId(state, "RFQ");

      const lines = readObjectArray(input, "lines").map((line, index) => ({
        id: `${id}-L${index + 1}`,
        productId: requireProduct(state, readString(line, "productId")).id,
        quantity: readNumber(line, "quantity", { min: 1, integer: true }),
      }));

      const vendorIds = Array.isArray(input["vendorIds"])
        ? readStringArray(input, "vendorIds").map((vendorId) => requireVendor(state, vendorId).id)
        : [];

      const rfq: Rfq = {
        id,
        number: id,
        title: readString(input, "title"),
        status: "draft",
        requisitionId: null,
        lines,
        invitedVendorIds: vendorIds,
        issuedByUserId: user.id,
        createdAt: state.now,
        sentAt: null,
        responseDueDate: readOptionalString(input, "responseDueDate") ?? addDays(state.now, 10),
        closedAt: null,
        awardedQuotationId: null,
      };

      state.rfqs[rfq.id] = rfq;

      audit(state, user.id, "rfq.created", "rfq", rfq.id, `Created ${rfq.id}: ${rfq.title}`);

      return rfq;
    },
  }),

  defineTool({
    name: "add_vendor_to_rfq",
    description: "Invite another vendor to quote. Blocked vendors are rejected.",
    inputSchema: schema(
      {
        rfqId: S.string("RFQ ID."),
        vendorId: S.string("Vendor to invite."),
        actorUserId: S.string("User performing the action."),
      },
      ["rfqId", "vendorId", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const rfq = requireRfq(state, readString(input, "rfqId"));
      const vendor = requireVendor(state, readString(input, "vendorId"));

      assertStatus(rfq.status, ["draft", "sent"], `RFQ ${rfq.id}`);

      if (vendor.status === "blocked") {
        throw toolError("not_allowed", `Vendor ${vendor.id} is blocked and cannot be invited.`);
      }

      if (rfq.invitedVendorIds.includes(vendor.id)) {
        throw toolError("conflict", `Vendor ${vendor.id} is already invited to ${rfq.id}.`);
      }

      rfq.invitedVendorIds.push(vendor.id);

      audit(state, user.id, "rfq.vendor_added", "rfq", rfq.id, `Invited ${vendor.name} to ${rfq.id}`);

      return rfq;
    },
  }),

  defineTool({
    name: "remove_vendor_from_rfq",
    description:
      "Withdraw a vendor's invitation. Fails if that vendor has already submitted a quotation.",
    inputSchema: schema(
      {
        rfqId: S.string("RFQ ID."),
        vendorId: S.string("Vendor to remove."),
        actorUserId: S.string("User performing the action."),
      },
      ["rfqId", "vendorId", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const rfq = requireRfq(state, readString(input, "rfqId"));
      const vendorId = readString(input, "vendorId");

      assertStatus(rfq.status, ["draft", "sent"], `RFQ ${rfq.id}`);

      if (!rfq.invitedVendorIds.includes(vendorId)) {
        throw toolError("not_found", `Vendor ${vendorId} is not invited to ${rfq.id}.`);
      }

      const quotation = Object.values(state.quotations).find(
        (candidate) => candidate.rfqId === rfq.id && candidate.vendorId === vendorId,
      );

      if (quotation) {
        throw toolError(
          "invalid_state",
          `Vendor ${vendorId} already submitted ${quotation.id}; reject the quotation instead.`,
          { quotationId: quotation.id },
        );
      }

      rfq.invitedVendorIds = rfq.invitedVendorIds.filter((id) => id !== vendorId);

      audit(state, user.id, "rfq.vendor_removed", "rfq", rfq.id, `Removed ${vendorId} from ${rfq.id}`);

      return rfq;
    },
  }),

  defineTool({
    name: "send_rfq",
    description: "Issue a draft RFQ to its invited vendors.",
    inputSchema: schema(
      { rfqId: S.string("RFQ ID."), actorUserId: S.string("User performing the action.") },
      ["rfqId", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const rfq = requireRfq(state, readString(input, "rfqId"));

      assertStatus(rfq.status, ["draft"], `RFQ ${rfq.id}`);

      if (rfq.invitedVendorIds.length === 0) {
        throw toolError("invalid_state", `RFQ ${rfq.id} has no invited vendors.`);
      }

      if (rfq.lines.length === 0) {
        throw toolError("invalid_state", `RFQ ${rfq.id} has no lines.`);
      }

      rfq.status = "sent";
      rfq.sentAt = state.now;

      audit(state, user.id, "rfq.sent", "rfq", rfq.id, `Sent ${rfq.id} to ${rfq.invitedVendorIds.length} vendor(s)`);

      return rfq;
    },
  }),

  defineTool({
    name: "close_rfq",
    description:
      "Close an RFQ to further responses. Quotations already received stay available for comparison.",
    inputSchema: schema(
      { rfqId: S.string("RFQ ID."), actorUserId: S.string("User performing the action.") },
      ["rfqId", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const rfq = requireRfq(state, readString(input, "rfqId"));

      assertStatus(rfq.status, ["sent"], `RFQ ${rfq.id}`);

      rfq.status = "closed";
      rfq.closedAt = state.now;

      audit(state, user.id, "rfq.closed", "rfq", rfq.id, `Closed ${rfq.id}`);

      return rfq;
    },
  }),

  defineTool({
    name: "cancel_rfq",
    description: "Cancel an RFQ that has not been awarded.",
    inputSchema: schema(
      {
        rfqId: S.string("RFQ ID."),
        reason: S.string("Why it is being cancelled."),
        actorUserId: S.string("User performing the action."),
      },
      ["rfqId", "reason", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const rfq = requireRfq(state, readString(input, "rfqId"));
      const reason = readString(input, "reason");

      assertStatus(rfq.status, ["draft", "sent", "closed"], `RFQ ${rfq.id}`);

      rfq.status = "cancelled";
      rfq.closedAt = state.now;

      if (rfq.requisitionId) {
        const requisition = state.requisitions[rfq.requisitionId];
        if (requisition && requisition.rfqId === rfq.id) {
          requisition.rfqId = null;
        }
      }

      audit(state, user.id, "rfq.cancelled", "rfq", rfq.id, `Cancelled ${rfq.id}: ${reason}`);

      return rfq;
    },
  }),

  defineTool({
    name: "list_rfq_quotations",
    description: "List every quotation received against one RFQ.",
    inputSchema: schema({ rfqId: S.string("RFQ ID.") }, ["rfqId"]),
    run(state, input) {
      const rfq = requireRfq(state, readString(input, "rfqId"));

      return Object.values(state.quotations)
        .filter((quotation) => quotation.rfqId === rfq.id)
        .sort((a, b) => a.id.localeCompare(b.id));
    },
  }),
];
