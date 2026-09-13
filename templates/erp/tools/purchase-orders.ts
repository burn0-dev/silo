import {
  type PurchaseOrder,
  type PurchaseOrderStatus,
  addDays,
  lineRemaining,
  money,
  nextId,
  paymentTermDays,
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
  readOptionalString,
  readString,
  schema,
  toolError,
} from "./contract.js";
import {
  actor,
  assertStatus,
  audit,
  budgetHeadroom,
  commitToBudget,
  createApproval,
  decideApproval,
  purchaseOrderSummary,
  refreshInboundQuantities,
  releaseCommitment,
  requireApproval,
  requireBudget,
  requireProduct,
  requirePurchaseOrder,
  requireQuotation,
  requireRequisition,
  requireUser,
  requireVendor,
  requireWarehouse,
  withinApprovalLimit,
} from "./helpers.js";

const purchaseOrderStatuses: readonly PurchaseOrderStatus[] = [
  "draft",
  "pending_approval",
  "approved",
  "rejected",
  "sent",
  "partially_received",
  "received",
  "closed",
  "cancelled",
];

const TAX_RATE = 0.08;

function recalculateTotals(order: PurchaseOrder): void {
  const subtotal = sumMoney(order.lines.map((line) => line.lineTotal), order.currency);
  order.subtotal = subtotal;
  order.taxAmount = money(subtotal.amount * TAX_RATE, order.currency);
  order.totalAmount = money(subtotal.amount + order.taxAmount.amount, order.currency);
}

export const purchaseOrderTools = [
  defineTool({
    name: "list_purchase_orders",
    description:
      "List purchase orders, optionally filtered by status, vendor or destination warehouse.",
    inputSchema: schema({
      status: S.enumeration("Only orders with this status.", purchaseOrderStatuses),
      vendorId: S.string("Only orders for this vendor."),
      warehouseId: S.string("Only orders delivering to this warehouse."),
      ...pagingProperties,
    }),
    run(state, input) {
      const status = readOptionalEnum(input, "status", purchaseOrderStatuses);
      const vendorId = readOptionalString(input, "vendorId");
      const warehouseId = readOptionalString(input, "warehouseId");

      const orders = Object.values(state.purchaseOrders)
        .filter((order) => (status ? order.status === status : true))
        .filter((order) => (vendorId ? order.vendorId === vendorId : true))
        .filter((order) => (warehouseId ? order.warehouseId === warehouseId : true))
        .sort((a, b) => a.id.localeCompare(b.id));

      const page = paginate(orders, input);

      return { ...page, results: page.results.map(purchaseOrderSummary) };
    },
  }),

  defineTool({
    name: "search_purchase_orders",
    description: "Search purchase orders by ID, vendor name or product on the order.",
    inputSchema: schema(
      { query: S.string("Free-text search term."), ...pagingProperties },
      ["query"],
    ),
    run(state, input) {
      const query = readString(input, "query");

      const orders = Object.values(state.purchaseOrders)
        .filter((order) => {
          const vendor = state.vendors[order.vendorId];

          return (
            matchesText(order.id, query) ||
            (vendor ? matchesText(vendor.name, query) : false) ||
            order.lines.some(
              (line) =>
                matchesText(line.productId, query) || matchesText(line.description, query),
            )
          );
        })
        .sort((a, b) => a.id.localeCompare(b.id));

      const page = paginate(orders, input);

      return { ...page, results: page.results.map(purchaseOrderSummary) };
    },
  }),

  defineTool({
    name: "get_purchase_order",
    description:
      "Get one purchase order with its lines, received and invoiced quantities, and linked documents.",
    inputSchema: schema({ purchaseOrderId: S.string("Purchase order ID, e.g. 'PO-203'.") }, [
      "purchaseOrderId",
    ]),
    run(state, input) {
      const order = requirePurchaseOrder(state, readString(input, "purchaseOrderId"));

      const receipts = Object.values(state.goodsReceipts)
        .filter((receipt) => receipt.purchaseOrderId === order.id)
        .map((receipt) => ({ id: receipt.id, status: receipt.status, receivedAt: receipt.receivedAt }));

      const invoices = Object.values(state.vendorInvoices)
        .filter((invoice) => invoice.purchaseOrderId === order.id)
        .map((invoice) => ({ id: invoice.id, status: invoice.status, totalAmount: invoice.totalAmount }));

      return {
        ...order,
        lines: order.lines.map((line) => ({
          ...line,
          quantityOutstanding: lineRemaining(line),
          quantityUninvoiced: line.quantityReceived - line.quantityInvoiced,
        })),
        goodsReceipts: receipts,
        vendorInvoices: invoices,
      };
    },
  }),

  defineTool({
    name: "create_purchase_order",
    description:
      "Create a draft purchase order. Blocked or inactive vendors are rejected. Optionally link a requisition and quotation.",
    inputSchema: schema(
      {
        vendorId: S.string("Vendor the order is placed with."),
        warehouseId: S.string("Warehouse the goods are delivered to."),
        lines: S.array(
          "Order lines.",
          S.object(
            "Purchase order line.",
            {
              productId: S.string("Product ID."),
              quantity: S.integer("Quantity to order.", { minimum: 1 }),
              unitPrice: S.number("Agreed unit price.", { minimum: 0 }),
            },
            ["productId", "quantity", "unitPrice"],
          ),
        ),
        requisitionId: S.string("Requisition this order fulfils."),
        quotationId: S.string("Quotation this order is based on."),
        budgetId: S.string("Budget to charge."),
        expectedDeliveryDate: S.string("ISO date delivery is expected."),
        actorUserId: S.string("User creating the order."),
      },
      ["vendorId", "warehouseId", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const vendor = requireVendor(state, readString(input, "vendorId"));
      const warehouse = requireWarehouse(state, readString(input, "warehouseId"));

      if (vendor.status === "blocked") {
        throw toolError("not_allowed", `Vendor ${vendor.id} is blocked: ${vendor.statusReason ?? "no reason recorded"}.`);
      }

      if (vendor.status !== "active") {
        throw toolError("not_allowed", `Vendor ${vendor.id} is "${vendor.status}" and cannot receive orders.`);
      }

      const id = nextId(state, "PO");
      const expectedDeliveryDate =
        readOptionalString(input, "expectedDeliveryDate") ?? addDays(state.now, vendor.leadTimeDays);

      const quotationId = readOptionalString(input, "quotationId");
      const quotation = quotationId ? requireQuotation(state, quotationId) : null;

      if (quotation && quotation.vendorId !== vendor.id) {
        throw toolError(
          "invalid_input",
          `Quotation ${quotation.id} belongs to vendor ${quotation.vendorId}, not ${vendor.id}.`,
        );
      }

      const requisitionId = readOptionalString(input, "requisitionId");
      const requisition = requisitionId ? requireRequisition(state, requisitionId) : null;

      const specs = Array.isArray(input["lines"])
        ? readObjectArray(input, "lines")
        : quotation
          ? quotation.lines.map((line) => ({
              productId: line.productId,
              quantity: line.quantity,
              unitPrice: line.unitPrice.amount,
            }))
          : [];

      if (specs.length === 0) {
        throw toolError("invalid_input", "Provide \"lines\", or a quotation to copy lines from.");
      }

      const lines = specs.map((line, index) => {
        const product = requireProduct(state, readString(line, "productId"));
        const quantity = readNumber(line, "quantity", { min: 1, integer: true });
        const unitPrice = readNumber(line, "unitPrice", { min: 0 });

        if (product.status === "discontinued") {
          throw toolError("not_allowed", `Product ${product.id} is discontinued.`);
        }

        return {
          id: `${id}-L${index + 1}`,
          productId: product.id,
          description: product.name,
          quantityOrdered: quantity,
          quantityReceived: 0,
          quantityRejected: 0,
          quantityInvoiced: 0,
          unitPrice: money(unitPrice, state.company.baseCurrency),
          lineTotal: money(quantity * unitPrice, state.company.baseCurrency),
          expectedDate: expectedDeliveryDate,
        };
      });

      const budgetId = readOptionalString(input, "budgetId") ?? requisition?.budgetId ?? null;
      if (budgetId) requireBudget(state, budgetId);

      const order: PurchaseOrder = {
        id,
        number: id,
        vendorId: vendor.id,
        status: "draft",
        lines,
        warehouseId: warehouse.id,
        currency: state.company.baseCurrency,
        subtotal: money(0, state.company.baseCurrency),
        taxAmount: money(0, state.company.baseCurrency),
        totalAmount: money(0, state.company.baseCurrency),
        requisitionId: requisition?.id ?? null,
        quotationId: quotation?.id ?? null,
        budgetId,
        paymentTerms: vendor.paymentTerms,
        createdByUserId: user.id,
        createdAt: state.now,
        approvalId: null,
        approvedAt: null,
        approvedByUserId: null,
        sentAt: null,
        expectedDeliveryDate,
        closedAt: null,
        cancelledAt: null,
        cancelReason: null,
      };

      recalculateTotals(order);
      state.purchaseOrders[order.id] = order;

      if (requisition) {
        requisition.purchaseOrderId = order.id;
        requisition.status = "converted";
      }

      audit(state, user.id, "purchase_order.created", "purchase_order", order.id, `Created ${order.id} for ${vendor.name} (${order.totalAmount.amount})`);

      return order;
    },
  }),

  defineTool({
    name: "update_purchase_order",
    description:
      "Change lines, warehouse or expected delivery on a draft purchase order.",
    inputSchema: schema(
      {
        purchaseOrderId: S.string("Purchase order ID."),
        warehouseId: S.string("New destination warehouse."),
        expectedDeliveryDate: S.string("New expected delivery date."),
        lines: S.array(
          "Replacement lines.",
          S.object(
            "Purchase order line.",
            {
              productId: S.string("Product ID."),
              quantity: S.integer("Quantity to order.", { minimum: 1 }),
              unitPrice: S.number("Agreed unit price.", { minimum: 0 }),
            },
            ["productId", "quantity", "unitPrice"],
          ),
        ),
        actorUserId: S.string("User performing the action."),
      },
      ["purchaseOrderId", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const order = requirePurchaseOrder(state, readString(input, "purchaseOrderId"));

      assertStatus(order.status, ["draft"], `Purchase order ${order.id}`);

      const warehouseId = readOptionalString(input, "warehouseId");
      if (warehouseId) order.warehouseId = requireWarehouse(state, warehouseId).id;

      const expected = readOptionalString(input, "expectedDeliveryDate");
      if (expected) order.expectedDeliveryDate = expected;

      if (Array.isArray(input["lines"])) {
        order.lines = readObjectArray(input, "lines").map((line, index) => {
          const product = requireProduct(state, readString(line, "productId"));
          const quantity = readNumber(line, "quantity", { min: 1, integer: true });
          const unitPrice = readNumber(line, "unitPrice", { min: 0 });

          return {
            id: `${order.id}-L${index + 1}`,
            productId: product.id,
            description: product.name,
            quantityOrdered: quantity,
            quantityReceived: 0,
            quantityRejected: 0,
            quantityInvoiced: 0,
            unitPrice: money(unitPrice, order.currency),
            lineTotal: money(quantity * unitPrice, order.currency),
            expectedDate: order.expectedDeliveryDate,
          };
        });

        recalculateTotals(order);
      }

      audit(state, user.id, "purchase_order.updated", "purchase_order", order.id, `Updated ${order.id}`);

      return order;
    },
  }),

  defineTool({
    name: "submit_purchase_order_for_approval",
    description: "Send a draft purchase order for approval.",
    inputSchema: schema(
      {
        purchaseOrderId: S.string("Purchase order ID."),
        approverUserId: S.string("User who should approve it."),
        actorUserId: S.string("User performing the action."),
      },
      ["purchaseOrderId", "approverUserId", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const order = requirePurchaseOrder(state, readString(input, "purchaseOrderId"));
      const approver = requireUser(state, readString(input, "approverUserId"));

      assertStatus(order.status, ["draft"], `Purchase order ${order.id}`);

      if (order.lines.length === 0) {
        throw toolError("invalid_state", `Purchase order ${order.id} has no lines.`);
      }

      const approval = createApproval(state, {
        entityType: "purchase_order",
        entityId: order.id,
        requestedByUserId: user.id,
        assignedToUserId: approver.id,
        amount: order.totalAmount,
      });

      order.status = "pending_approval";
      order.approvalId = approval.id;

      audit(state, user.id, "purchase_order.submitted", "purchase_order", order.id, `Submitted ${order.id} to ${approver.name}`);

      return { purchaseOrder: order, approval };
    },
  }),

  defineTool({
    name: "approve_purchase_order",
    description:
      "Approve a purchase order awaiting approval. Enforces the approver's limit and commits the amount to the budget.",
    inputSchema: schema(
      {
        purchaseOrderId: S.string("Purchase order ID."),
        approverUserId: S.string("User approving the order."),
        note: S.string("Optional approval note."),
      },
      ["purchaseOrderId", "approverUserId"],
    ),
    run(state, input) {
      const approver = actor(state, readString(input, "approverUserId"));
      const order = requirePurchaseOrder(state, readString(input, "purchaseOrderId"));

      assertStatus(order.status, ["pending_approval"], `Purchase order ${order.id}`);

      if (!withinApprovalLimit(approver, order.totalAmount)) {
        throw toolError(
          "limit_exceeded",
          `${approver.name} has an approval limit of ${approver.approvalLimit?.amount ?? 0}; ${order.id} totals ${order.totalAmount.amount}.`,
          { approvalLimit: approver.approvalLimit?.amount ?? 0, amount: order.totalAmount.amount },
        );
      }

      if (order.budgetId) {
        commitToBudget(requireBudget(state, order.budgetId), order.totalAmount);
      }

      if (order.approvalId) {
        decideApproval(
          state,
          requireApproval(state, order.approvalId),
          "approved",
          approver.id,
          readOptionalString(input, "note"),
        );
      }

      order.status = "approved";
      order.approvedAt = state.now;
      order.approvedByUserId = approver.id;

      audit(state, approver.id, "purchase_order.approved", "purchase_order", order.id, `Approved ${order.id} for ${order.totalAmount.amount}`);

      return order;
    },
  }),

  defineTool({
    name: "reject_purchase_order",
    description: "Reject a purchase order awaiting approval.",
    inputSchema: schema(
      {
        purchaseOrderId: S.string("Purchase order ID."),
        approverUserId: S.string("User rejecting the order."),
        reason: S.string("Why it is being rejected."),
      },
      ["purchaseOrderId", "approverUserId", "reason"],
    ),
    run(state, input) {
      const approver = actor(state, readString(input, "approverUserId"));
      const order = requirePurchaseOrder(state, readString(input, "purchaseOrderId"));
      const reason = readString(input, "reason");

      assertStatus(order.status, ["pending_approval"], `Purchase order ${order.id}`);

      if (order.approvalId) {
        decideApproval(state, requireApproval(state, order.approvalId), "rejected", approver.id, reason);
      }

      order.status = "rejected";

      audit(state, approver.id, "purchase_order.rejected", "purchase_order", order.id, `Rejected ${order.id}: ${reason}`);

      return order;
    },
  }),

  defineTool({
    name: "send_purchase_order",
    description:
      "Send an approved purchase order to the vendor. This is what makes the quantities count as inbound stock.",
    inputSchema: schema(
      { purchaseOrderId: S.string("Purchase order ID."), actorUserId: S.string("User performing the action.") },
      ["purchaseOrderId", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const order = requirePurchaseOrder(state, readString(input, "purchaseOrderId"));

      assertStatus(order.status, ["approved"], `Purchase order ${order.id}`);

      const vendor = requireVendor(state, order.vendorId);

      if (vendor.status === "blocked") {
        throw toolError("not_allowed", `Vendor ${vendor.id} is blocked; ${order.id} cannot be sent.`);
      }

      order.status = "sent";
      order.sentAt = state.now;

      refreshInboundQuantities(state, order.warehouseId);

      audit(state, user.id, "purchase_order.sent", "purchase_order", order.id, `Sent ${order.id} to ${vendor.name}`);

      return order;
    },
  }),

  defineTool({
    name: "cancel_purchase_order",
    description:
      "Cancel a purchase order. Fails once anything has been received against it; releases any budget commitment.",
    inputSchema: schema(
      {
        purchaseOrderId: S.string("Purchase order ID."),
        reason: S.string("Why it is being cancelled."),
        actorUserId: S.string("User performing the action."),
      },
      ["purchaseOrderId", "reason", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const order = requirePurchaseOrder(state, readString(input, "purchaseOrderId"));
      const reason = readString(input, "reason");

      assertStatus(
        order.status,
        ["draft", "pending_approval", "approved", "sent"],
        `Purchase order ${order.id}`,
      );

      const received = order.lines.reduce((total, line) => total + line.quantityReceived, 0);

      if (received > 0) {
        throw toolError(
          "invalid_state",
          `${order.id} already has ${received} unit(s) received and cannot be cancelled.`,
          { receivedUnits: received },
        );
      }

      if (order.budgetId && (order.status === "approved" || order.status === "sent")) {
        releaseCommitment(requireBudget(state, order.budgetId), order.totalAmount);
      }

      if (order.approvalId) {
        const approval = requireApproval(state, order.approvalId);
        if (approval.status === "pending") {
          approval.status = "cancelled";
          approval.decidedAt = state.now;
        }
      }

      order.status = "cancelled";
      order.cancelledAt = state.now;
      order.cancelReason = reason;

      refreshInboundQuantities(state, order.warehouseId);

      audit(state, user.id, "purchase_order.cancelled", "purchase_order", order.id, `Cancelled ${order.id}: ${reason}`);

      return order;
    },
  }),

  defineTool({
    name: "close_purchase_order",
    description:
      "Close a fully received and fully invoiced purchase order, releasing any remaining budget commitment.",
    inputSchema: schema(
      { purchaseOrderId: S.string("Purchase order ID."), actorUserId: S.string("User performing the action.") },
      ["purchaseOrderId", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const order = requirePurchaseOrder(state, readString(input, "purchaseOrderId"));

      assertStatus(order.status, ["received", "partially_received"], `Purchase order ${order.id}`);

      const uninvoiced = order.lines.filter((line) => line.quantityInvoiced < line.quantityReceived);

      if (uninvoiced.length > 0) {
        throw toolError(
          "invalid_state",
          `${order.id} has ${uninvoiced.length} line(s) received but not invoiced.`,
          { lines: uninvoiced.map((line) => line.id) },
        );
      }

      const unresolved = Object.values(state.vendorInvoices).filter(
        (invoice) =>
          invoice.purchaseOrderId === order.id &&
          ["draft", "pending_match", "matched", "pending_approval", "disputed"].includes(
            invoice.status,
          ),
      );

      if (unresolved.length > 0) {
        throw toolError(
          "invalid_state",
          `${order.id} has ${unresolved.length} invoice(s) still open: ${unresolved.map((invoice) => `${invoice.id} (${invoice.status})`).join(", ")}.`,
          { invoices: unresolved.map((invoice) => invoice.id) },
        );
      }

      order.status = "closed";
      order.closedAt = state.now;

      refreshInboundQuantities(state, order.warehouseId);

      audit(state, user.id, "purchase_order.closed", "purchase_order", order.id, `Closed ${order.id}`);

      return order;
    },
  }),

  defineTool({
    name: "list_open_purchase_order_lines",
    description:
      "Lines still awaiting delivery across live purchase orders, with outstanding quantities.",
    inputSchema: schema({
      vendorId: S.string("Only lines for this vendor."),
      warehouseId: S.string("Only lines delivering to this warehouse."),
      productId: S.string("Only lines for this product."),
      ...pagingProperties,
    }),
    run(state, input) {
      const vendorId = readOptionalString(input, "vendorId");
      const warehouseId = readOptionalString(input, "warehouseId");
      const productId = readOptionalString(input, "productId");

      const rows = Object.values(state.purchaseOrders)
        .filter((order) => order.status === "sent" || order.status === "partially_received")
        .filter((order) => (vendorId ? order.vendorId === vendorId : true))
        .filter((order) => (warehouseId ? order.warehouseId === warehouseId : true))
        .flatMap((order) =>
          order.lines
            .filter((line) => lineRemaining(line) > 0)
            .filter((line) => (productId ? line.productId === productId : true))
            .map((line) => ({
              purchaseOrderId: order.id,
              purchaseOrderLineId: line.id,
              vendorId: order.vendorId,
              warehouseId: order.warehouseId,
              productId: line.productId,
              quantityOrdered: line.quantityOrdered,
              quantityReceived: line.quantityReceived,
              quantityOutstanding: lineRemaining(line),
              expectedDate: line.expectedDate,
              isOverdue: line.expectedDate < state.now,
            })),
        )
        .sort((a, b) => a.expectedDate.localeCompare(b.expectedDate));

      return paginate(rows, input);
    },
  }),

  defineTool({
    name: "list_overdue_purchase_orders",
    description:
      "Purchase orders past their expected delivery date with quantities still outstanding.",
    inputSchema: schema({ ...pagingProperties }),
    run(state, input) {
      const rows = Object.values(state.purchaseOrders)
        .filter((order) => order.status === "sent" || order.status === "partially_received")
        .filter((order) => order.expectedDeliveryDate < state.now)
        .filter((order) => order.lines.some((line) => lineRemaining(line) > 0))
        .map((order) => ({
          ...purchaseOrderSummary(order),
          daysOverdue: Math.floor(
            (new Date(state.now).getTime() - new Date(order.expectedDeliveryDate).getTime()) /
              86_400_000,
          ),
          outstandingUnits: order.lines.reduce((total, line) => total + lineRemaining(line), 0),
        }))
        .sort((a, b) => b.daysOverdue - a.daysOverdue);

      return paginate(rows, input);
    },
  }),

  defineTool({
    name: "get_purchase_order_budget_impact",
    description:
      "Show what a purchase order consumes from its budget, and whether the budget can absorb it.",
    inputSchema: schema({ purchaseOrderId: S.string("Purchase order ID.") }, [
      "purchaseOrderId",
    ]),
    run(state, input) {
      const order = requirePurchaseOrder(state, readString(input, "purchaseOrderId"));

      if (!order.budgetId) {
        return { purchaseOrderId: order.id, hasBudget: false, sufficient: false };
      }

      const budget = requireBudget(state, order.budgetId);
      const available = budgetHeadroom(budget);

      return {
        purchaseOrderId: order.id,
        hasBudget: true,
        budgetId: budget.id,
        budgetName: budget.name,
        orderTotal: order.totalAmount,
        allocated: budget.allocatedAmount,
        committed: budget.committedAmount,
        spent: budget.spentAmount,
        available,
        sufficient: order.totalAmount.amount <= available.amount,
        alreadyCommitted: order.status === "approved" || order.status === "sent" || order.status === "partially_received",
      };
    },
  }),

  defineTool({
    name: "get_purchase_order_payment_due_date",
    description:
      "Work out when payment falls due for a purchase order based on the vendor's terms and a given invoice date.",
    inputSchema: schema(
      {
        purchaseOrderId: S.string("Purchase order ID."),
        invoiceDate: S.string("ISO invoice date; defaults to today."),
      },
      ["purchaseOrderId"],
    ),
    run(state, input) {
      const order = requirePurchaseOrder(state, readString(input, "purchaseOrderId"));
      const invoiceDate = readOptionalString(input, "invoiceDate") ?? state.now;
      const days = paymentTermDays(order.paymentTerms);

      return {
        purchaseOrderId: order.id,
        vendorId: order.vendorId,
        paymentTerms: order.paymentTerms,
        invoiceDate,
        termDays: days,
        dueDate: addDays(invoiceDate, days),
      };
    },
  }),
];
