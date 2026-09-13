import {
  type MatchDiscrepancy,
  type ThreeWayMatch,
  type VendorInvoice,
  type VendorInvoiceStatus,
  addDays,
  isOverdue,
  money,
  nextId,
  outstandingAmount,
  paymentTermDays,
  round2,
  sumMoney,
} from "../state.js";
import {
  S,
  defineTool,
  matchesText,
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
  createApproval,
  decideApproval,
  requireApproval,
  requireGoodsReceipt,
  requirePurchaseOrder,
  requireUser,
  requireVendor,
  requireVendorInvoice,
  vendorInvoiceSummary,
  withinApprovalLimit,
} from "./helpers.js";

const invoiceStatuses: readonly VendorInvoiceStatus[] = [
  "draft",
  "pending_match",
  "matched",
  "pending_approval",
  "approved",
  "disputed",
  "partially_paid",
  "paid",
  "rejected",
  "cancelled",
];

const TAX_RATE = 0.08;

const DEFAULT_TOLERANCE = { pricePercent: 2, quantityPercent: 0 };

/**
 * Compares an invoice against its purchase order and posted receipts.
 * Price variance is allowed within tolerance; invoicing more than was received
 * is not.
 */
function runMatch(
  state: Parameters<typeof requirePurchaseOrder>[0],
  invoice: VendorInvoice,
  tolerance: { pricePercent: number; quantityPercent: number },
): MatchDiscrepancy[] {
  const discrepancies: MatchDiscrepancy[] = [];

  if (!invoice.purchaseOrderId) {
    discrepancies.push({
      type: "missing_purchase_order",
      purchaseOrderLineId: null,
      productId: null,
      expected: 0,
      actual: invoice.totalAmount.amount,
      message: "No purchase order is linked to this invoice.",
    });

    return discrepancies;
  }

  const order = requirePurchaseOrder(state, invoice.purchaseOrderId);

  const postedReceipts = Object.values(state.goodsReceipts).filter(
    (receipt) => receipt.purchaseOrderId === order.id && receipt.status === "posted",
  );

  if (postedReceipts.length === 0) {
    discrepancies.push({
      type: "missing_receipt",
      purchaseOrderLineId: null,
      productId: null,
      expected: 0,
      actual: invoice.totalAmount.amount,
      message: `No posted goods receipt exists for ${order.id}.`,
    });
  }

  for (const line of invoice.lines) {
    if (!line.purchaseOrderLineId) continue;

    const orderLine = order.lines.find((candidate) => candidate.id === line.purchaseOrderLineId);

    if (!orderLine) {
      discrepancies.push({
        type: "missing_purchase_order",
        purchaseOrderLineId: line.purchaseOrderLineId,
        productId: line.productId,
        expected: 0,
        actual: line.quantity,
        message: `Invoice line references ${line.purchaseOrderLineId}, which is not on ${order.id}.`,
      });
      continue;
    }

    const receivedForLine = postedReceipts
      .flatMap((receipt) => receipt.lines)
      .filter((receiptLine) => receiptLine.purchaseOrderLineId === orderLine.id)
      .reduce((total, receiptLine) => total + receiptLine.quantityReceived, 0);

    const quantityAllowance = receivedForLine * (1 + tolerance.quantityPercent / 100);

    if (line.quantity > quantityAllowance) {
      discrepancies.push({
        type: "quantity",
        purchaseOrderLineId: orderLine.id,
        productId: line.productId,
        expected: receivedForLine,
        actual: line.quantity,
        message: `Invoiced quantity ${line.quantity} exceeds received quantity ${receivedForLine} on ${order.id}.`,
      });
    }

    const expectedPrice = orderLine.unitPrice.amount;
    const variancePercent =
      expectedPrice === 0
        ? 0
        : ((line.unitPrice.amount - expectedPrice) / expectedPrice) * 100;

    if (variancePercent > tolerance.pricePercent) {
      discrepancies.push({
        type: "price",
        purchaseOrderLineId: orderLine.id,
        productId: line.productId,
        expected: expectedPrice,
        actual: line.unitPrice.amount,
        message: `Invoiced unit price ${line.unitPrice.amount.toFixed(2)} exceeds purchase order price ${expectedPrice.toFixed(2)} by ${variancePercent.toFixed(2)}%.`,
      });
    }
  }

  return discrepancies;
}

export const vendorInvoiceTools = [
  defineTool({
    name: "list_vendor_invoices",
    description:
      "List vendor invoices across all vendors, filtered by status, purchase order or overdue flag.",
    inputSchema: schema({
      status: S.enumeration("Only invoices with this status.", invoiceStatuses),
      vendorId: S.string("Only invoices from this vendor."),
      purchaseOrderId: S.string("Only invoices against this purchase order."),
      overdueOnly: S.boolean("Only invoices past their due date and still owing."),
      ...pagingProperties,
    }),
    run(state, input) {
      const status = readOptionalEnum(input, "status", invoiceStatuses);
      const vendorId = readOptionalString(input, "vendorId");
      const purchaseOrderId = readOptionalString(input, "purchaseOrderId");
      const overdueOnly = input["overdueOnly"] === true;

      const invoices = Object.values(state.vendorInvoices)
        .filter((invoice) => (status ? invoice.status === status : true))
        .filter((invoice) => (vendorId ? invoice.vendorId === vendorId : true))
        .filter((invoice) => (purchaseOrderId ? invoice.purchaseOrderId === purchaseOrderId : true))
        .filter((invoice) => (overdueOnly ? isOverdue(invoice, state.now) : true))
        .sort((a, b) => a.id.localeCompare(b.id));

      const page = paginate(invoices, input);

      return { ...page, results: page.results.map(vendorInvoiceSummary) };
    },
  }),

  defineTool({
    name: "search_vendor_invoices",
    description:
      "Search vendor invoices by internal ID, the vendor's own invoice number, or vendor name.",
    inputSchema: schema(
      { query: S.string("Free-text search term."), ...pagingProperties },
      ["query"],
    ),
    run(state, input) {
      const query = readString(input, "query");

      const invoices = Object.values(state.vendorInvoices)
        .filter((invoice) => {
          const vendor = state.vendors[invoice.vendorId];

          return (
            matchesText(invoice.id, query) ||
            matchesText(invoice.vendorInvoiceNumber, query) ||
            (vendor ? matchesText(vendor.name, query) : false)
          );
        })
        .sort((a, b) => a.id.localeCompare(b.id));

      const page = paginate(invoices, input);

      return { ...page, results: page.results.map(vendorInvoiceSummary) };
    },
  }),

  defineTool({
    name: "get_vendor_invoice",
    description:
      "Get one vendor invoice with its lines, match result, approval and payment history. Start here when an invoice cannot be paid.",
    inputSchema: schema({ vendorInvoiceId: S.string("Invoice ID, e.g. 'VINV-104'.") }, [
      "vendorInvoiceId",
    ]),
    run(state, input) {
      const invoice = requireVendorInvoice(state, readString(input, "vendorInvoiceId"));

      const match = invoice.matchId ? state.threeWayMatches[invoice.matchId] : null;
      const approval = invoice.approvalId ? state.approvals[invoice.approvalId] : null;

      const payments = Object.values(state.payments)
        .filter((payment) => payment.allocations.some((allocation) => allocation.invoiceId === invoice.id))
        .map((payment) => ({
          id: payment.id,
          status: payment.status,
          amount: payment.amount,
          processedAt: payment.processedAt,
          failureReason: payment.failureReason,
        }));

      return {
        ...invoice,
        outstanding: outstandingAmount(invoice),
        isOverdue: isOverdue(invoice, state.now),
        match: match ?? null,
        approval: approval ?? null,
        payments,
      };
    },
  }),

  defineTool({
    name: "create_vendor_invoice",
    description:
      "Register an invoice received from a vendor. Link it to a purchase order and receipts so it can be three-way matched; leave them out only for genuine non-PO spend.",
    inputSchema: schema(
      {
        vendorId: S.string("Vendor that issued the invoice."),
        vendorInvoiceNumber: S.string("The vendor's own invoice number."),
        purchaseOrderId: S.string("Purchase order this invoice bills against."),
        goodsReceiptIds: S.array("Receipts covered by this invoice.", S.string("Goods receipt ID.")),
        lines: S.array(
          "Invoice lines. Omit to bill everything received but not yet invoiced on the purchase order.",
          S.object(
            "Invoice line.",
            {
              purchaseOrderLineId: S.string("Purchase order line being billed."),
              description: S.string("Line description."),
              quantity: S.number("Quantity billed.", { minimum: 0 }),
              unitPrice: S.number("Unit price billed.", { minimum: 0 }),
            },
            ["description", "quantity", "unitPrice"],
          ),
        ),
        invoiceDate: S.string("ISO invoice date; defaults to today."),
        actorUserId: S.string("User registering the invoice."),
      },
      ["vendorId", "vendorInvoiceNumber", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const vendor = requireVendor(state, readString(input, "vendorId"));
      const vendorInvoiceNumber = readString(input, "vendorInvoiceNumber");

      const duplicate = Object.values(state.vendorInvoices).find(
        (invoice) =>
          invoice.vendorId === vendor.id &&
          invoice.vendorInvoiceNumber.toLowerCase() === vendorInvoiceNumber.toLowerCase() &&
          invoice.status !== "cancelled",
      );

      if (duplicate) {
        throw toolError(
          "conflict",
          `Invoice "${vendorInvoiceNumber}" from ${vendor.id} is already registered as ${duplicate.id}.`,
          { vendorInvoiceId: duplicate.id },
        );
      }

      const purchaseOrderId = readOptionalString(input, "purchaseOrderId");
      const order = purchaseOrderId ? requirePurchaseOrder(state, purchaseOrderId) : null;

      if (order && order.vendorId !== vendor.id) {
        throw toolError(
          "invalid_input",
          `${order.id} belongs to vendor ${order.vendorId}, not ${vendor.id}.`,
        );
      }

      if (order && order.status === "cancelled") {
        throw toolError("invalid_state", `${order.id} is cancelled and cannot be invoiced.`);
      }

      const goodsReceiptIds = Array.isArray(input["goodsReceiptIds"])
        ? (input["goodsReceiptIds"] as unknown[]).map((value) =>
            requireGoodsReceipt(state, String(value)).id,
          )
        : order
          ? Object.values(state.goodsReceipts)
              .filter((receipt) => receipt.purchaseOrderId === order.id && receipt.status === "posted")
              .map((receipt) => receipt.id)
          : [];

      const id = nextId(state, "VINV");

      const specs = Array.isArray(input["lines"])
        ? readObjectArray(input, "lines")
        : order
          ? order.lines
              .filter((line) => line.quantityReceived > line.quantityInvoiced)
              .map((line) => ({
                purchaseOrderLineId: line.id,
                description: line.description,
                quantity: line.quantityReceived - line.quantityInvoiced,
                unitPrice: line.unitPrice.amount,
              }))
          : [];

      if (specs.length === 0) {
        throw toolError(
          "invalid_input",
          order
            ? `Nothing is awaiting invoicing on ${order.id}; supply "lines" explicitly.`
            : "Provide \"lines\" for a non-PO invoice.",
        );
      }

      const lines = specs.map((line, index) => {
        const quantity = readNumber(line, "quantity", { min: 0 });
        const unitPrice = readNumber(line, "unitPrice", { min: 0 });
        const purchaseOrderLineId = readOptionalString(line, "purchaseOrderLineId") ?? null;

        if (purchaseOrderLineId && order && !order.lines.some((l) => l.id === purchaseOrderLineId)) {
          throw toolError("not_found", `Line "${purchaseOrderLineId}" is not on ${order.id}.`);
        }

        const orderLine = order?.lines.find((l) => l.id === purchaseOrderLineId);

        return {
          id: `${id}-L${index + 1}`,
          purchaseOrderLineId,
          productId: orderLine?.productId ?? null,
          description: readString(line, "description"),
          quantity,
          unitPrice: money(unitPrice, state.company.baseCurrency),
          lineTotal: money(quantity * unitPrice, state.company.baseCurrency),
        };
      });

      const subtotal = sumMoney(lines.map((line) => line.lineTotal), state.company.baseCurrency);
      const taxAmount = money(subtotal.amount * TAX_RATE, state.company.baseCurrency);
      const invoiceDate = readOptionalString(input, "invoiceDate") ?? state.now;

      const invoice: VendorInvoice = {
        id,
        number: id,
        vendorInvoiceNumber,
        vendorId: vendor.id,
        purchaseOrderId: order?.id ?? null,
        goodsReceiptIds,
        status: "pending_match",
        lines,
        subtotal,
        taxAmount,
        totalAmount: money(subtotal.amount + taxAmount.amount, state.company.baseCurrency),
        amountPaid: money(0, state.company.baseCurrency),
        invoiceDate,
        dueDate: addDays(invoiceDate, paymentTermDays(vendor.paymentTerms)),
        receivedAt: state.now,
        matchId: null,
        approvalId: null,
        approvedAt: null,
        approvedByUserId: null,
        disputeReason: null,
        paidAt: null,
      };

      state.vendorInvoices[invoice.id] = invoice;

      if (order) {
        for (const line of invoice.lines) {
          const orderLine = order.lines.find((candidate) => candidate.id === line.purchaseOrderLineId);
          if (orderLine) orderLine.quantityInvoiced += line.quantity;
        }
      }

      audit(state, user.id, "vendor_invoice.created", "vendor_invoice", invoice.id, `Registered ${invoice.id} from ${vendor.name} for ${invoice.totalAmount.amount}`);

      return invoice;
    },
  }),

  defineTool({
    name: "run_three_way_match",
    description:
      "Match an invoice against its purchase order and posted receipts. Clean matches move the invoice to 'matched'; failures record every discrepancy and leave it blocked.",
    inputSchema: schema(
      {
        vendorInvoiceId: S.string("Invoice ID."),
        pricePercentTolerance: S.number("Allowed price variance percent (default 2).", { minimum: 0 }),
        quantityPercentTolerance: S.number("Allowed quantity variance percent (default 0).", { minimum: 0 }),
        actorUserId: S.string("User running the match."),
      },
      ["vendorInvoiceId", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const invoice = requireVendorInvoice(state, readString(input, "vendorInvoiceId"));

      assertStatus(
        invoice.status,
        ["draft", "pending_match", "matched", "pending_approval", "disputed"],
        `Invoice ${invoice.id}`,
      );

      const tolerance = {
        pricePercent:
          readOptionalNumber(input, "pricePercentTolerance", { min: 0 }) ?? DEFAULT_TOLERANCE.pricePercent,
        quantityPercent:
          readOptionalNumber(input, "quantityPercentTolerance", { min: 0 }) ?? DEFAULT_TOLERANCE.quantityPercent,
      };

      const discrepancies = runMatch(state, invoice, tolerance);

      const match: ThreeWayMatch = {
        id: nextId(state, "MATCH"),
        vendorInvoiceId: invoice.id,
        purchaseOrderId: invoice.purchaseOrderId,
        goodsReceiptIds: invoice.goodsReceiptIds,
        status: discrepancies.length === 0 ? "matched" : "failed",
        discrepancies,
        tolerance,
        runAt: state.now,
        runByUserId: user.id,
      };

      state.threeWayMatches[match.id] = match;
      invoice.matchId = match.id;

      if (match.status === "matched") {
        invoice.status = "matched";
      } else if (invoice.status === "matched") {
        invoice.status = "pending_match";
      }

      audit(state, user.id, `three_way_match.${match.status}`, "three_way_match", match.id, `Match ${match.status} for ${invoice.id}`);

      return match;
    },
  }),

  defineTool({
    name: "get_three_way_match",
    description: "Get a match result, including every discrepancy that blocked it.",
    inputSchema: schema({ matchId: S.string("Match ID, e.g. 'MATCH-004'.") }, ["matchId"]),
    run(state, input) {
      const id = readString(input, "matchId");
      const match = state.threeWayMatches[id];

      if (!match) {
        throw toolError("not_found", `Three-way match "${id}" was not found.`);
      }

      return match;
    },
  }),

  defineTool({
    name: "list_invoice_discrepancies",
    description:
      "Every unresolved match discrepancy across accounts payable, so blocked invoices can be triaged together.",
    inputSchema: schema({ ...pagingProperties }),
    run(state, input) {
      const rows = Object.values(state.vendorInvoices)
        .filter((invoice) => invoice.matchId !== null && invoice.status !== "paid" && invoice.status !== "cancelled")
        .flatMap((invoice) => {
          const match = invoice.matchId ? state.threeWayMatches[invoice.matchId] : undefined;
          if (!match || match.status !== "failed") return [];

          return match.discrepancies.map((discrepancy) => ({
            vendorInvoiceId: invoice.id,
            vendorId: invoice.vendorId,
            invoiceStatus: invoice.status,
            purchaseOrderId: invoice.purchaseOrderId,
            matchId: match.id,
            type: discrepancy.type,
            expected: discrepancy.expected,
            actual: discrepancy.actual,
            message: discrepancy.message,
          }));
        })
        .sort((a, b) => a.vendorInvoiceId.localeCompare(b.vendorInvoiceId));

      return paginate(rows, input);
    },
  }),

  defineTool({
    name: "submit_vendor_invoice_for_approval",
    description:
      "Send a matched invoice for approval. Refuses while the three-way match is failing.",
    inputSchema: schema(
      {
        vendorInvoiceId: S.string("Invoice ID."),
        approverUserId: S.string("User who should approve it."),
        actorUserId: S.string("User performing the action."),
      },
      ["vendorInvoiceId", "approverUserId", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const invoice = requireVendorInvoice(state, readString(input, "vendorInvoiceId"));
      const approver = requireUser(state, readString(input, "approverUserId"));

      assertStatus(invoice.status, ["matched", "pending_match", "draft"], `Invoice ${invoice.id}`);

      const match = invoice.matchId ? state.threeWayMatches[invoice.matchId] : null;

      if (!match) {
        throw toolError(
          "invalid_state",
          `Invoice ${invoice.id} has not been matched; run run_three_way_match first.`,
        );
      }

      if (match.status === "failed") {
        throw toolError(
          "invalid_state",
          `Invoice ${invoice.id} cannot be submitted: match ${match.id} failed with ${match.discrepancies.length} discrepancy(ies).`,
          { discrepancies: match.discrepancies },
        );
      }

      const approval = createApproval(state, {
        entityType: "vendor_invoice",
        entityId: invoice.id,
        requestedByUserId: user.id,
        assignedToUserId: approver.id,
        amount: invoice.totalAmount,
      });

      invoice.status = "pending_approval";
      invoice.approvalId = approval.id;

      audit(state, user.id, "vendor_invoice.submitted", "vendor_invoice", invoice.id, `Submitted ${invoice.id} to ${approver.name}`);

      return { invoice, approval };
    },
  }),

  defineTool({
    name: "approve_vendor_invoice",
    description:
      "Approve an invoice for payment. Blocked by a failing three-way match, an open dispute, or an approver limit that is too low.",
    inputSchema: schema(
      {
        vendorInvoiceId: S.string("Invoice ID."),
        approverUserId: S.string("User approving the invoice."),
        note: S.string("Optional approval note."),
      },
      ["vendorInvoiceId", "approverUserId"],
    ),
    run(state, input) {
      const approver = actor(state, readString(input, "approverUserId"));
      const invoice = requireVendorInvoice(state, readString(input, "vendorInvoiceId"));

      assertStatus(invoice.status, ["pending_approval", "matched"], `Invoice ${invoice.id}`);

      const match = invoice.matchId ? state.threeWayMatches[invoice.matchId] : null;

      if (!match || match.status !== "matched") {
        throw toolError(
          "invalid_state",
          match
            ? `Invoice ${invoice.id} cannot be approved: match ${match.id} failed. ${match.discrepancies.map((d) => d.message).join(" ")}`
            : `Invoice ${invoice.id} has not been three-way matched.`,
          { discrepancies: match?.discrepancies ?? [] },
        );
      }

      if (!withinApprovalLimit(approver, invoice.totalAmount)) {
        throw toolError(
          "limit_exceeded",
          `${approver.name} has an approval limit of ${approver.approvalLimit?.amount ?? 0}; ${invoice.id} totals ${invoice.totalAmount.amount}.`,
          { approvalLimit: approver.approvalLimit?.amount ?? 0, amount: invoice.totalAmount.amount },
        );
      }

      if (invoice.approvalId) {
        decideApproval(
          state,
          requireApproval(state, invoice.approvalId),
          "approved",
          approver.id,
          readOptionalString(input, "note"),
        );
      }

      invoice.status = "approved";
      invoice.approvedAt = state.now;
      invoice.approvedByUserId = approver.id;

      audit(state, approver.id, "vendor_invoice.approved", "vendor_invoice", invoice.id, `Approved ${invoice.id} for ${invoice.totalAmount.amount}`);

      return invoice;
    },
  }),

  defineTool({
    name: "reject_vendor_invoice",
    description: "Reject an invoice outright, for example a duplicate or a billing error.",
    inputSchema: schema(
      {
        vendorInvoiceId: S.string("Invoice ID."),
        approverUserId: S.string("User rejecting the invoice."),
        reason: S.string("Why it is being rejected."),
      },
      ["vendorInvoiceId", "approverUserId", "reason"],
    ),
    run(state, input) {
      const approver = actor(state, readString(input, "approverUserId"));
      const invoice = requireVendorInvoice(state, readString(input, "vendorInvoiceId"));
      const reason = readString(input, "reason");

      assertStatus(
        invoice.status,
        ["pending_approval", "pending_match", "matched", "disputed", "draft"],
        `Invoice ${invoice.id}`,
      );

      if (invoice.approvalId) {
        const approval = requireApproval(state, invoice.approvalId);
        if (approval.status === "pending") {
          decideApproval(state, approval, "rejected", approver.id, reason);
        }
      }

      invoice.status = "rejected";

      if (invoice.purchaseOrderId) {
        const order = requirePurchaseOrder(state, invoice.purchaseOrderId);

        for (const line of invoice.lines) {
          const orderLine = order.lines.find((candidate) => candidate.id === line.purchaseOrderLineId);
          if (orderLine) orderLine.quantityInvoiced = Math.max(0, orderLine.quantityInvoiced - line.quantity);
        }
      }

      audit(state, approver.id, "vendor_invoice.rejected", "vendor_invoice", invoice.id, `Rejected ${invoice.id}: ${reason}`);

      return invoice;
    },
  }),

  defineTool({
    name: "dispute_vendor_invoice",
    description: "Put an invoice into dispute with the vendor while a variance is investigated.",
    inputSchema: schema(
      {
        vendorInvoiceId: S.string("Invoice ID."),
        reason: S.string("What is being disputed."),
        actorUserId: S.string("User raising the dispute."),
      },
      ["vendorInvoiceId", "reason", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const invoice = requireVendorInvoice(state, readString(input, "vendorInvoiceId"));
      const reason = readString(input, "reason");

      assertStatus(
        invoice.status,
        ["pending_match", "matched", "pending_approval", "approved"],
        `Invoice ${invoice.id}`,
      );

      invoice.status = "disputed";
      invoice.disputeReason = reason;

      audit(state, user.id, "vendor_invoice.disputed", "vendor_invoice", invoice.id, `Disputed ${invoice.id}: ${reason}`);

      return invoice;
    },
  }),

  defineTool({
    name: "resolve_vendor_invoice_dispute",
    description:
      "Clear a dispute and return the invoice for matching, recording how it was settled.",
    inputSchema: schema(
      {
        vendorInvoiceId: S.string("Invoice ID."),
        resolution: S.string("How the dispute was settled."),
        actorUserId: S.string("User resolving the dispute."),
      },
      ["vendorInvoiceId", "resolution", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const invoice = requireVendorInvoice(state, readString(input, "vendorInvoiceId"));
      const resolution = readString(input, "resolution");

      assertStatus(invoice.status, ["disputed"], `Invoice ${invoice.id}`);

      invoice.status = "pending_match";
      invoice.disputeReason = null;

      audit(state, user.id, "vendor_invoice.dispute_resolved", "vendor_invoice", invoice.id, `Dispute on ${invoice.id} resolved: ${resolution}`);

      return invoice;
    },
  }),

  defineTool({
    name: "update_vendor_invoice_line",
    description:
      "Correct a quantity or unit price on an invoice line, for example after agreeing a credit with the vendor. Only allowed before approval, and re-running the match is required afterwards.",
    inputSchema: schema(
      {
        vendorInvoiceId: S.string("Invoice ID."),
        lineId: S.string("Invoice line ID, e.g. 'VINV-104-L1'."),
        quantity: S.number("Corrected quantity.", { minimum: 0 }),
        unitPrice: S.number("Corrected unit price.", { minimum: 0 }),
        actorUserId: S.string("User performing the correction."),
      },
      ["vendorInvoiceId", "lineId", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const invoice = requireVendorInvoice(state, readString(input, "vendorInvoiceId"));
      const lineId = readString(input, "lineId");

      assertStatus(
        invoice.status,
        ["draft", "pending_match", "matched", "pending_approval", "disputed"],
        `Invoice ${invoice.id}`,
      );

      const line = invoice.lines.find((candidate) => candidate.id === lineId);

      if (!line) {
        throw toolError("not_found", `Line "${lineId}" is not on ${invoice.id}.`);
      }

      const quantity = readOptionalNumber(input, "quantity", { min: 0 });
      const unitPrice = readOptionalNumber(input, "unitPrice", { min: 0 });

      if (quantity === undefined && unitPrice === undefined) {
        throw toolError("invalid_input", "Supply a corrected quantity, unit price, or both.");
      }

      const previousQuantity = line.quantity;

      if (quantity !== undefined) line.quantity = quantity;
      if (unitPrice !== undefined) line.unitPrice = money(unitPrice, invoice.subtotal.currency);

      line.lineTotal = money(line.quantity * line.unitPrice.amount, invoice.subtotal.currency);

      invoice.subtotal = sumMoney(invoice.lines.map((candidate) => candidate.lineTotal), invoice.subtotal.currency);
      invoice.taxAmount = money(invoice.subtotal.amount * TAX_RATE, invoice.subtotal.currency);
      invoice.totalAmount = money(
        invoice.subtotal.amount + invoice.taxAmount.amount,
        invoice.subtotal.currency,
      );

      if (invoice.purchaseOrderId && line.purchaseOrderLineId && quantity !== undefined) {
        const order = requirePurchaseOrder(state, invoice.purchaseOrderId);
        const orderLine = order.lines.find((candidate) => candidate.id === line.purchaseOrderLineId);

        if (orderLine) {
          orderLine.quantityInvoiced = Math.max(
            0,
            round2(orderLine.quantityInvoiced - previousQuantity + quantity),
          );
        }
      }

      // the previous match no longer describes this invoice
      invoice.matchId = null;
      if (invoice.status === "matched" || invoice.status === "pending_approval") {
        invoice.status = "pending_match";
      }

      audit(state, user.id, "vendor_invoice.line_corrected", "vendor_invoice", invoice.id, `Corrected ${lineId} on ${invoice.id}; re-match required`);

      return invoice;
    },
  }),

  defineTool({
    name: "cancel_vendor_invoice",
    description:
      "Cancel an invoice that has no completed payments, releasing the quantities it had claimed on the purchase order.",
    inputSchema: schema(
      {
        vendorInvoiceId: S.string("Invoice ID."),
        reason: S.string("Why it is being cancelled."),
        actorUserId: S.string("User performing the action."),
      },
      ["vendorInvoiceId", "reason", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const invoice = requireVendorInvoice(state, readString(input, "vendorInvoiceId"));
      const reason = readString(input, "reason");

      if (invoice.status === "cancelled") {
        throw toolError("invalid_state", `Invoice ${invoice.id} is already cancelled.`);
      }

      if (invoice.amountPaid.amount > 0) {
        throw toolError(
          "invalid_state",
          `Invoice ${invoice.id} has ${invoice.amountPaid.amount} paid against it and cannot be cancelled.`,
          { amountPaid: invoice.amountPaid.amount },
        );
      }

      if (invoice.purchaseOrderId) {
        const order = requirePurchaseOrder(state, invoice.purchaseOrderId);

        for (const line of invoice.lines) {
          const orderLine = order.lines.find((candidate) => candidate.id === line.purchaseOrderLineId);
          if (orderLine) orderLine.quantityInvoiced = Math.max(0, orderLine.quantityInvoiced - line.quantity);
        }
      }

      invoice.status = "cancelled";

      audit(state, user.id, "vendor_invoice.cancelled", "vendor_invoice", invoice.id, `Cancelled ${invoice.id}: ${reason}`);

      return invoice;
    },
  }),

  defineTool({
    name: "list_invoices_due_soon",
    description:
      "Approved invoices falling due within a window, for building a payment run. Defaults to the next 7 days.",
    inputSchema: schema({
      withinDays: S.integer("Days ahead to look (default 7).", { minimum: 0, maximum: 365 }),
      includeOverdue: S.boolean("Include invoices already overdue (default true)."),
      ...pagingProperties,
    }),
    run(state, input) {
      const withinDays = readOptionalNumber(input, "withinDays", { min: 0, max: 365, integer: true }) ?? 7;
      const includeOverdue = input["includeOverdue"] !== false;
      const horizon = addDays(state.now, withinDays);

      const rows = Object.values(state.vendorInvoices)
        .filter((invoice) => invoice.status === "approved" || invoice.status === "partially_paid")
        .filter((invoice) => outstandingAmount(invoice).amount > 0)
        .filter((invoice) => {
          if (invoice.dueDate < state.now) return includeOverdue;
          return invoice.dueDate <= horizon;
        })
        .map((invoice) => ({
          ...vendorInvoiceSummary(invoice),
          isOverdue: isOverdue(invoice, state.now),
        }))
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

      return {
        ...paginate(rows, input),
        horizon,
        totalDue: sumMoney(rows.map((row) => row.outstanding), state.company.baseCurrency),
      };
    },
  }),

  defineTool({
    name: "list_overdue_vendor_invoices",
    description: "Invoices past their due date with an amount still outstanding.",
    inputSchema: schema({ ...pagingProperties }),
    run(state, input) {
      const rows = Object.values(state.vendorInvoices)
        .filter((invoice) => isOverdue(invoice, state.now))
        .map((invoice) => ({
          ...vendorInvoiceSummary(invoice),
          daysOverdue: Math.floor(
            (new Date(state.now).getTime() - new Date(invoice.dueDate).getTime()) / 86_400_000,
          ),
        }))
        .sort((a, b) => b.daysOverdue - a.daysOverdue);

      return {
        ...paginate(rows, input),
        totalOverdue: sumMoney(rows.map((row) => row.outstanding), state.company.baseCurrency),
      };
    },
  }),

  defineTool({
    name: "explain_invoice_block",
    description:
      "Explain in one call why an invoice cannot be paid yet: match failures, missing approval, dispute, cancellation or an already-settled balance.",
    inputSchema: schema({ vendorInvoiceId: S.string("Invoice ID.") }, ["vendorInvoiceId"]),
    run(state, input) {
      const invoice = requireVendorInvoice(state, readString(input, "vendorInvoiceId"));
      const blockers: Array<{ code: string; message: string; fixWith: string }> = [];

      if (invoice.status === "cancelled" || invoice.status === "rejected") {
        blockers.push({
          code: "invoice_closed",
          message: `Invoice is ${invoice.status} and can never be paid.`,
          fixWith: "create_vendor_invoice (register a replacement)",
        });
      }

      if (invoice.status === "disputed") {
        blockers.push({
          code: "disputed",
          message: `Invoice is in dispute: ${invoice.disputeReason ?? "no reason recorded"}.`,
          fixWith: "resolve_vendor_invoice_dispute",
        });
      }

      const match = invoice.matchId ? state.threeWayMatches[invoice.matchId] : null;

      if (!match) {
        blockers.push({
          code: "not_matched",
          message: "No three-way match has been run for this invoice.",
          fixWith: "run_three_way_match",
        });
      } else if (match.status === "failed") {
        for (const discrepancy of match.discrepancies) {
          blockers.push({
            code: `match_${discrepancy.type}`,
            message: discrepancy.message,
            fixWith:
              discrepancy.type === "quantity"
                ? "receive_goods (if goods did arrive) or update_vendor_invoice_line"
                : discrepancy.type === "price"
                  ? "update_vendor_invoice_line or dispute_vendor_invoice"
                  : "create_purchase_order / receive_goods",
          });
        }
      }

      if (
        !["approved", "partially_paid", "paid"].includes(invoice.status) &&
        blockers.length === 0
      ) {
        blockers.push({
          code: "not_approved",
          message: `Invoice status is "${invoice.status}"; it has not been approved for payment.`,
          fixWith: "submit_vendor_invoice_for_approval then approve_vendor_invoice",
        });
      }

      if (outstandingAmount(invoice).amount === 0 && invoice.status === "paid") {
        blockers.push({
          code: "already_paid",
          message: "Invoice is already paid in full.",
          fixWith: "",
        });
      }

      return {
        vendorInvoiceId: invoice.id,
        status: invoice.status,
        outstanding: outstandingAmount(invoice),
        payable: blockers.length === 0,
        blockers,
      };
    },
  }),
];
