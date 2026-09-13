import {
  type Quotation,
  type QuotationStatus,
  addDays,
  money,
  nextId,
  sumMoney,
} from "../state.js";
import {
  S,
  defineTool,
  pagingProperties,
  paginate,
  readNumber,
  readObjectArray,
  readOptionalEnum,
  readOptionalNumber,
  readOptionalString,
  readString,
  schema,
  toolError,
} from "./contract.js";
import {
  actor,
  assertStatus,
  audit,
  requireProduct,
  requireQuotation,
  requireRfq,
  requireVendor,
} from "./helpers.js";

const quotationStatuses: readonly QuotationStatus[] = [
  "received",
  "under_review",
  "accepted",
  "rejected",
  "expired",
];

/** A quotation is usable only if it is live and still inside its validity date. */
function validity(quotation: Quotation, now: string) {
  const expired = quotation.validUntil < now;
  const openStatus = quotation.status === "received" || quotation.status === "under_review";

  return {
    isValid: openStatus && !expired,
    expired,
    reason: !openStatus
      ? `Status is "${quotation.status}".`
      : expired
        ? `Validity lapsed on ${quotation.validUntil}.`
        : null,
  };
}

export const quotationTools = [
  defineTool({
    name: "list_quotations",
    description: "List quotations, optionally filtered by RFQ, vendor or status.",
    inputSchema: schema({
      rfqId: S.string("Only quotations against this RFQ."),
      vendorId: S.string("Only quotations from this vendor."),
      status: S.enumeration("Only quotations with this status.", quotationStatuses),
      ...pagingProperties,
    }),
    run(state, input) {
      const rfqId = readOptionalString(input, "rfqId");
      const vendorId = readOptionalString(input, "vendorId");
      const status = readOptionalEnum(input, "status", quotationStatuses);

      const quotations = Object.values(state.quotations)
        .filter((quotation) => (rfqId ? quotation.rfqId === rfqId : true))
        .filter((quotation) => (vendorId ? quotation.vendorId === vendorId : true))
        .filter((quotation) => (status ? quotation.status === status : true))
        .sort((a, b) => a.id.localeCompare(b.id));

      const page = paginate(quotations, input);

      return {
        ...page,
        results: page.results.map((quotation) => ({
          id: quotation.id,
          rfqId: quotation.rfqId,
          vendorId: quotation.vendorId,
          status: quotation.status,
          totalAmount: quotation.totalAmount,
          leadTimeDays: quotation.leadTimeDays,
          validUntil: quotation.validUntil,
          isValid: validity(quotation, state.now).isValid,
        })),
      };
    },
  }),

  defineTool({
    name: "get_quotation",
    description: "Get one quotation with its lines and current validity.",
    inputSchema: schema({ quotationId: S.string("Quotation ID, e.g. 'QUO-001'.") }, [
      "quotationId",
    ]),
    run(state, input) {
      const quotation = requireQuotation(state, readString(input, "quotationId"));

      return { ...quotation, validity: validity(quotation, state.now) };
    },
  }),

  defineTool({
    name: "record_quotation",
    description:
      "Record a vendor's response to an RFQ. The vendor must have been invited and the RFQ must be open.",
    inputSchema: schema(
      {
        rfqId: S.string("RFQ ID."),
        vendorId: S.string("Vendor submitting the quotation."),
        lines: S.array(
          "Quoted lines.",
          S.object(
            "Quotation line.",
            {
              productId: S.string("Product ID."),
              quantity: S.integer("Quantity quoted.", { minimum: 1 }),
              unitPrice: S.number("Quoted unit price.", { minimum: 0 }),
            },
            ["productId", "quantity", "unitPrice"],
          ),
        ),
        leadTimeDays: S.integer("Quoted lead time in days.", { minimum: 0 }),
        validUntil: S.string("ISO date the quotation expires."),
        notes: S.string("Vendor notes."),
        actorUserId: S.string("User recording the quotation."),
      },
      ["rfqId", "vendorId", "lines", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const rfq = requireRfq(state, readString(input, "rfqId"));
      const vendor = requireVendor(state, readString(input, "vendorId"));

      assertStatus(rfq.status, ["sent"], `RFQ ${rfq.id}`);

      if (!rfq.invitedVendorIds.includes(vendor.id)) {
        throw toolError(
          "not_allowed",
          `Vendor ${vendor.id} was not invited to ${rfq.id}.`,
          { invitedVendorIds: rfq.invitedVendorIds },
        );
      }

      const duplicate = Object.values(state.quotations).find(
        (quotation) => quotation.rfqId === rfq.id && quotation.vendorId === vendor.id,
      );

      if (duplicate) {
        throw toolError(
          "conflict",
          `Vendor ${vendor.id} already submitted ${duplicate.id} for ${rfq.id}; update it instead.`,
          { quotationId: duplicate.id },
        );
      }

      const id = nextId(state, "QUO");

      const lines = readObjectArray(input, "lines").map((line, index) => {
        const product = requireProduct(state, readString(line, "productId"));
        const quantity = readNumber(line, "quantity", { min: 1, integer: true });
        const unitPrice = readNumber(line, "unitPrice", { min: 0 });

        if (!rfq.lines.some((rfqLine) => rfqLine.productId === product.id)) {
          throw toolError(
            "invalid_input",
            `Product ${product.id} was not requested on ${rfq.id}.`,
          );
        }

        return {
          id: `${id}-L${index + 1}`,
          productId: product.id,
          quantity,
          unitPrice: money(unitPrice, state.company.baseCurrency),
          lineTotal: money(quantity * unitPrice, state.company.baseCurrency),
        };
      });

      const subtotal = sumMoney(lines.map((line) => line.lineTotal), state.company.baseCurrency);

      const quotation: Quotation = {
        id,
        number: id,
        rfqId: rfq.id,
        vendorId: vendor.id,
        status: "received",
        lines,
        subtotal,
        totalAmount: subtotal,
        leadTimeDays: readOptionalNumber(input, "leadTimeDays", { min: 0, integer: true }) ?? vendor.leadTimeDays,
        validUntil: readOptionalString(input, "validUntil") ?? addDays(state.now, 30),
        receivedAt: state.now,
        notes: readOptionalString(input, "notes") ?? "",
      };

      state.quotations[quotation.id] = quotation;

      audit(state, user.id, "quotation.recorded", "quotation", quotation.id, `Recorded ${quotation.id} from ${vendor.name} for ${rfq.id}`);

      return quotation;
    },
  }),

  defineTool({
    name: "update_quotation",
    description:
      "Revise a quotation that has not been accepted or rejected, for example after a vendor re-quotes.",
    inputSchema: schema(
      {
        quotationId: S.string("Quotation ID."),
        leadTimeDays: S.integer("Revised lead time.", { minimum: 0 }),
        validUntil: S.string("Revised validity date."),
        notes: S.string("Revised notes."),
        lines: S.array(
          "Replacement lines.",
          S.object(
            "Quotation line.",
            {
              productId: S.string("Product ID."),
              quantity: S.integer("Quantity quoted.", { minimum: 1 }),
              unitPrice: S.number("Quoted unit price.", { minimum: 0 }),
            },
            ["productId", "quantity", "unitPrice"],
          ),
        ),
        actorUserId: S.string("User performing the action."),
      },
      ["quotationId", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const quotation = requireQuotation(state, readString(input, "quotationId"));

      assertStatus(quotation.status, ["received", "under_review", "expired"], `Quotation ${quotation.id}`);

      const leadTimeDays = readOptionalNumber(input, "leadTimeDays", { min: 0, integer: true });
      if (leadTimeDays !== undefined) quotation.leadTimeDays = leadTimeDays;

      const validUntil = readOptionalString(input, "validUntil");
      if (validUntil) {
        quotation.validUntil = validUntil;
        if (quotation.status === "expired" && validUntil > state.now) {
          quotation.status = "received";
        }
      }

      const notes = readOptionalString(input, "notes");
      if (notes) quotation.notes = notes;

      if (Array.isArray(input["lines"])) {
        quotation.lines = readObjectArray(input, "lines").map((line, index) => {
          const product = requireProduct(state, readString(line, "productId"));
          const quantity = readNumber(line, "quantity", { min: 1, integer: true });
          const unitPrice = readNumber(line, "unitPrice", { min: 0 });

          return {
            id: `${quotation.id}-L${index + 1}`,
            productId: product.id,
            quantity,
            unitPrice: money(unitPrice, state.company.baseCurrency),
            lineTotal: money(quantity * unitPrice, state.company.baseCurrency),
          };
        });

        quotation.subtotal = sumMoney(
          quotation.lines.map((line) => line.lineTotal),
          state.company.baseCurrency,
        );
        quotation.totalAmount = quotation.subtotal;
      }

      audit(state, user.id, "quotation.updated", "quotation", quotation.id, `Updated ${quotation.id}`);

      return quotation;
    },
  }),

  defineTool({
    name: "accept_quotation",
    description:
      "Accept a quotation and award its RFQ. Rejects the competing quotations and refuses to accept an expired one.",
    inputSchema: schema(
      {
        quotationId: S.string("Quotation ID."),
        actorUserId: S.string("User performing the action."),
      },
      ["quotationId", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const quotation = requireQuotation(state, readString(input, "quotationId"));
      const rfq = requireRfq(state, quotation.rfqId);

      assertStatus(quotation.status, ["received", "under_review"], `Quotation ${quotation.id}`);
      assertStatus(rfq.status, ["sent", "closed"], `RFQ ${rfq.id}`);

      const check = validity(quotation, state.now);

      if (!check.isValid) {
        throw toolError(
          "invalid_state",
          `Quotation ${quotation.id} cannot be accepted. ${check.reason ?? ""}`.trim(),
          { validUntil: quotation.validUntil, now: state.now },
        );
      }

      const vendor = requireVendor(state, quotation.vendorId);

      if (vendor.status === "blocked") {
        throw toolError("not_allowed", `Vendor ${vendor.id} is blocked; its quotation cannot be awarded.`);
      }

      quotation.status = "accepted";
      rfq.status = "awarded";
      rfq.awardedQuotationId = quotation.id;
      rfq.closedAt = rfq.closedAt ?? state.now;

      const rejected: string[] = [];

      for (const other of Object.values(state.quotations)) {
        if (other.rfqId !== rfq.id || other.id === quotation.id) continue;
        if (other.status === "received" || other.status === "under_review") {
          other.status = "rejected";
          rejected.push(other.id);
        }
      }

      audit(state, user.id, "quotation.accepted", "quotation", quotation.id, `Accepted ${quotation.id} from ${vendor.name}; awarded ${rfq.id}`);

      return { quotation, rfq, rejectedQuotationIds: rejected };
    },
  }),

  defineTool({
    name: "reject_quotation",
    description: "Reject a single quotation without awarding the RFQ.",
    inputSchema: schema(
      {
        quotationId: S.string("Quotation ID."),
        reason: S.string("Why it is being rejected."),
        actorUserId: S.string("User performing the action."),
      },
      ["quotationId", "reason", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const quotation = requireQuotation(state, readString(input, "quotationId"));
      const reason = readString(input, "reason");

      assertStatus(quotation.status, ["received", "under_review", "expired"], `Quotation ${quotation.id}`);

      quotation.status = "rejected";
      quotation.notes = quotation.notes ? `${quotation.notes} | Rejected: ${reason}` : `Rejected: ${reason}`;

      audit(state, user.id, "quotation.rejected", "quotation", quotation.id, `Rejected ${quotation.id}: ${reason}`);

      return quotation;
    },
  }),

  defineTool({
    name: "compare_quotations",
    description:
      "Compare every quotation on an RFQ side by side, with per-line unit prices, totals, lead times and validity. Invalid quotations are included but flagged.",
    inputSchema: schema({ rfqId: S.string("RFQ ID.") }, ["rfqId"]),
    run(state, input) {
      const rfq = requireRfq(state, readString(input, "rfqId"));

      const quotations = Object.values(state.quotations)
        .filter((quotation) => quotation.rfqId === rfq.id)
        .sort((a, b) => a.totalAmount.amount - b.totalAmount.amount);

      const rows = quotations.map((quotation) => {
        const check = validity(quotation, state.now);

        return {
          quotationId: quotation.id,
          vendorId: quotation.vendorId,
          vendorName: state.vendors[quotation.vendorId]?.name ?? quotation.vendorId,
          status: quotation.status,
          totalAmount: quotation.totalAmount,
          leadTimeDays: quotation.leadTimeDays,
          validUntil: quotation.validUntil,
          isValid: check.isValid,
          invalidReason: check.reason,
          lines: quotation.lines.map((line) => ({
            productId: line.productId,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            lineTotal: line.lineTotal,
          })),
        };
      });

      const valid = rows.filter((row) => row.isValid);
      const cheapestOverall = rows[0];
      const cheapestValid = valid[0];

      return {
        rfqId: rfq.id,
        rfqStatus: rfq.status,
        quotationCount: rows.length,
        validQuotationCount: valid.length,
        cheapestQuotationId: cheapestOverall?.quotationId ?? null,
        cheapestValidQuotationId: cheapestValid?.quotationId ?? null,
        cheapestIsInvalid:
          cheapestOverall !== undefined &&
          cheapestValid !== undefined &&
          cheapestOverall.quotationId !== cheapestValid.quotationId,
        quotations: rows,
      };
    },
  }),

  defineTool({
    name: "find_cheapest_valid_quotation",
    description:
      "Return the cheapest quotation on an RFQ that is still open and inside its validity date, optionally respecting a maximum lead time. Expired and rejected quotations are excluded.",
    inputSchema: schema(
      {
        rfqId: S.string("RFQ ID."),
        maxLeadTimeDays: S.integer("Reject quotations slower than this.", { minimum: 0 }),
      },
      ["rfqId"],
    ),
    run(state, input) {
      const rfq = requireRfq(state, readString(input, "rfqId"));
      const maxLeadTimeDays = readOptionalNumber(input, "maxLeadTimeDays", { min: 0, integer: true });

      const considered = Object.values(state.quotations)
        .filter((quotation) => quotation.rfqId === rfq.id)
        .map((quotation) => {
          const check = validity(quotation, state.now);
          const tooSlow =
            maxLeadTimeDays !== undefined && quotation.leadTimeDays > maxLeadTimeDays;

          return {
            quotationId: quotation.id,
            vendorId: quotation.vendorId,
            totalAmount: quotation.totalAmount,
            leadTimeDays: quotation.leadTimeDays,
            eligible: check.isValid && !tooSlow,
            excludedBecause: !check.isValid
              ? check.reason
              : tooSlow
                ? `Lead time ${quotation.leadTimeDays} days exceeds the ${maxLeadTimeDays}-day limit.`
                : null,
          };
        })
        .sort((a, b) => a.totalAmount.amount - b.totalAmount.amount);

      const winner = considered.find((row) => row.eligible) ?? null;

      return {
        rfqId: rfq.id,
        selected: winner,
        consideredCount: considered.length,
        excluded: considered.filter((row) => !row.eligible),
      };
    },
  }),

  defineTool({
    name: "expire_quotations",
    description:
      "Housekeeping: mark every open quotation whose validity date has passed as expired.",
    inputSchema: schema(
      {
        rfqId: S.string("Limit to one RFQ."),
        actorUserId: S.string("User performing the action."),
      },
      ["actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const rfqId = readOptionalString(input, "rfqId");

      const expired: string[] = [];

      for (const quotation of Object.values(state.quotations)) {
        if (rfqId && quotation.rfqId !== rfqId) continue;
        if (quotation.status !== "received" && quotation.status !== "under_review") continue;
        if (quotation.validUntil >= state.now) continue;

        quotation.status = "expired";
        expired.push(quotation.id);
      }

      if (expired.length > 0) {
        audit(state, user.id, "quotation.expired", "quotation", expired[0]!, `Expired ${expired.length} quotation(s)`);
      }

      return { expiredQuotationIds: expired, count: expired.length };
    },
  }),
];
