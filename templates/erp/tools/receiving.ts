import {
  type DiscrepancyType,
  type GoodsReceipt,
  type ReceivingDiscrepancy,
  lineRemaining,
  nextId,
} from "../state.js";
import {
  S,
  defineTool,
  pagingProperties,
  paginate,
  readEnum,
  readNumber,
  readObjectArray,
  readOptionalString,
  readString,
  schema,
  toolError,
} from "./contract.js";
import {
  actor,
  applyStockChange,
  assertStatus,
  audit,
  recomputePurchaseOrderStatus,
  requireDiscrepancy,
  requireGoodsReceipt,
  requirePurchaseOrder,
  requireWarehouse,
} from "./helpers.js";

const discrepancyTypes: readonly DiscrepancyType[] = [
  "shortage",
  "overage",
  "damage",
  "wrong_item",
];

export const receivingTools = [
  defineTool({
    name: "list_goods_receipts",
    description:
      "List goods receipts, optionally filtered by purchase order, warehouse or status.",
    inputSchema: schema({
      purchaseOrderId: S.string("Only receipts against this purchase order."),
      warehouseId: S.string("Only receipts at this warehouse."),
      status: S.enumeration("Only receipts with this status.", ["draft", "posted", "cancelled"]),
      ...pagingProperties,
    }),
    run(state, input) {
      const purchaseOrderId = readOptionalString(input, "purchaseOrderId");
      const warehouseId = readOptionalString(input, "warehouseId");
      const status = readOptionalString(input, "status");

      const receipts = Object.values(state.goodsReceipts)
        .filter((receipt) => (purchaseOrderId ? receipt.purchaseOrderId === purchaseOrderId : true))
        .filter((receipt) => (warehouseId ? receipt.warehouseId === warehouseId : true))
        .filter((receipt) => (status ? receipt.status === status : true))
        .sort((a, b) => a.id.localeCompare(b.id));

      const page = paginate(receipts, input);

      return {
        ...page,
        results: page.results.map((receipt) => ({
          id: receipt.id,
          purchaseOrderId: receipt.purchaseOrderId,
          warehouseId: receipt.warehouseId,
          status: receipt.status,
          receivedAt: receipt.receivedAt,
          unitsReceived: receipt.lines.reduce((total, line) => total + line.quantityReceived, 0),
        })),
      };
    },
  }),

  defineTool({
    name: "get_goods_receipt",
    description: "Get one goods receipt with its lines and any discrepancies raised.",
    inputSchema: schema({ goodsReceiptId: S.string("Goods receipt ID, e.g. 'GR-001'.") }, [
      "goodsReceiptId",
    ]),
    run(state, input) {
      const receipt = requireGoodsReceipt(state, readString(input, "goodsReceiptId"));

      const discrepancies = Object.values(state.receivingDiscrepancies).filter(
        (discrepancy) => discrepancy.goodsReceiptId === receipt.id,
      );

      return { ...receipt, discrepancies };
    },
  }),

  defineTool({
    name: "list_receipts_for_purchase_order",
    description:
      "Every receipt against a purchase order, with what remains outstanding per line.",
    inputSchema: schema({ purchaseOrderId: S.string("Purchase order ID.") }, [
      "purchaseOrderId",
    ]),
    run(state, input) {
      const order = requirePurchaseOrder(state, readString(input, "purchaseOrderId"));

      const receipts = Object.values(state.goodsReceipts)
        .filter((receipt) => receipt.purchaseOrderId === order.id)
        .sort((a, b) => a.id.localeCompare(b.id));

      return {
        purchaseOrderId: order.id,
        status: order.status,
        receipts: receipts.map((receipt) => ({
          id: receipt.id,
          status: receipt.status,
          receivedAt: receipt.receivedAt,
          lines: receipt.lines,
        })),
        outstandingByLine: order.lines.map((line) => ({
          purchaseOrderLineId: line.id,
          productId: line.productId,
          quantityOrdered: line.quantityOrdered,
          quantityReceived: line.quantityReceived,
          quantityOutstanding: lineRemaining(line),
        })),
      };
    },
  }),

  defineTool({
    name: "receive_goods",
    description:
      "Post a goods receipt against a purchase order. Accepted quantities increase stock at the delivery warehouse; rejected quantities do not. Over-receipt beyond the outstanding quantity is refused. Omit lines to receive everything still outstanding.",
    inputSchema: schema(
      {
        purchaseOrderId: S.string("Purchase order being received."),
        lines: S.array(
          "Lines received. Omit to receive all outstanding quantities.",
          S.object(
            "Receipt line.",
            {
              purchaseOrderLineId: S.string("Purchase order line ID, e.g. 'PO-202-L1'."),
              quantityReceived: S.integer("Units accepted into stock.", { minimum: 0 }),
              quantityRejected: S.integer("Units rejected on arrival.", { minimum: 0 }),
              note: S.string("Line note."),
            },
            ["purchaseOrderLineId", "quantityReceived"],
          ),
        ),
        deliveryNote: S.string("Vendor delivery note reference."),
        actorUserId: S.string("User receiving the goods."),
      },
      ["purchaseOrderId", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const order = requirePurchaseOrder(state, readString(input, "purchaseOrderId"));

      assertStatus(order.status, ["sent", "partially_received"], `Purchase order ${order.id}`);

      const specs = Array.isArray(input["lines"])
        ? readObjectArray(input, "lines").map((line) => ({
            purchaseOrderLineId: readString(line, "purchaseOrderLineId"),
            quantityReceived: readNumber(line, "quantityReceived", { min: 0, integer: true }),
            quantityRejected:
              typeof line["quantityRejected"] === "number"
                ? readNumber(line, "quantityRejected", { min: 0, integer: true })
                : 0,
            note: typeof line["note"] === "string" ? line["note"] : "",
          }))
        : order.lines
            .filter((line) => lineRemaining(line) > 0)
            .map((line) => ({
              purchaseOrderLineId: line.id,
              quantityReceived: lineRemaining(line),
              quantityRejected: 0,
              note: "",
            }));

      if (specs.length === 0) {
        throw toolError("invalid_state", `Nothing is outstanding on ${order.id}.`);
      }

      const id = nextId(state, "GR");
      const receiptLines: GoodsReceipt["lines"] = [];

      for (const [index, spec] of specs.entries()) {
        const orderLine = order.lines.find((line) => line.id === spec.purchaseOrderLineId);

        if (!orderLine) {
          throw toolError(
            "not_found",
            `Line "${spec.purchaseOrderLineId}" is not on ${order.id}.`,
            { validLineIds: order.lines.map((line) => line.id) },
          );
        }

        const totalArriving = spec.quantityReceived + spec.quantityRejected;

        if (totalArriving === 0) {
          throw toolError("invalid_input", `Line ${spec.purchaseOrderLineId} has nothing to receive.`);
        }

        if (spec.quantityReceived > lineRemaining(orderLine)) {
          throw toolError(
            "invalid_input",
            `Cannot receive ${spec.quantityReceived} against ${orderLine.id}: only ${lineRemaining(orderLine)} outstanding of ${orderLine.quantityOrdered}.`,
            {
              outstanding: lineRemaining(orderLine),
              ordered: orderLine.quantityOrdered,
              alreadyReceived: orderLine.quantityReceived,
            },
          );
        }

        receiptLines.push({
          id: `${id}-L${index + 1}`,
          purchaseOrderLineId: orderLine.id,
          productId: orderLine.productId,
          quantityReceived: spec.quantityReceived,
          quantityRejected: spec.quantityRejected,
          note: spec.note,
        });
      }

      const receipt: GoodsReceipt = {
        id,
        number: id,
        purchaseOrderId: order.id,
        warehouseId: order.warehouseId,
        status: "posted",
        lines: receiptLines,
        deliveryNote: readOptionalString(input, "deliveryNote") ?? "",
        receivedByUserId: user.id,
        receivedAt: state.now,
        postedAt: state.now,
        cancelledAt: null,
      };

      state.goodsReceipts[receipt.id] = receipt;

      for (const line of receipt.lines) {
        const orderLine = order.lines.find((candidate) => candidate.id === line.purchaseOrderLineId);
        if (!orderLine) continue;

        orderLine.quantityReceived += line.quantityReceived;
        orderLine.quantityRejected += line.quantityRejected;

        if (line.quantityReceived > 0) {
          applyStockChange(state, {
            productId: line.productId,
            warehouseId: receipt.warehouseId,
            quantityDelta: line.quantityReceived,
            reservedDelta: 0,
            type: "receipt",
            referenceType: "goods_receipt",
            referenceId: receipt.id,
            actorUserId: user.id,
            note: `Received against ${order.id}`,
          });
        }
      }

      recomputePurchaseOrderStatus(state, order);

      audit(state, user.id, "goods_receipt.posted", "goods_receipt", receipt.id, `Posted ${receipt.id} against ${order.id}`);

      return { receipt, purchaseOrderStatus: order.status };
    },
  }),

  defineTool({
    name: "cancel_goods_receipt",
    description:
      "Cancel a posted receipt, reversing its stock movements and the quantities it added to the purchase order. Fails if the receipt has already been invoiced.",
    inputSchema: schema(
      {
        goodsReceiptId: S.string("Goods receipt ID."),
        reason: S.string("Why it is being cancelled."),
        actorUserId: S.string("User performing the action."),
      },
      ["goodsReceiptId", "reason", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const receipt = requireGoodsReceipt(state, readString(input, "goodsReceiptId"));
      const reason = readString(input, "reason");

      assertStatus(receipt.status, ["posted", "draft"], `Goods receipt ${receipt.id}`);

      const linkedInvoice = Object.values(state.vendorInvoices).find(
        (invoice) =>
          invoice.goodsReceiptIds.includes(receipt.id) && invoice.status !== "cancelled",
      );

      if (linkedInvoice) {
        throw toolError(
          "invalid_state",
          `${receipt.id} is referenced by invoice ${linkedInvoice.id} (${linkedInvoice.status}) and cannot be cancelled.`,
          { vendorInvoiceId: linkedInvoice.id },
        );
      }

      const order = requirePurchaseOrder(state, receipt.purchaseOrderId);

      if (receipt.status === "posted") {
        for (const line of receipt.lines) {
          const orderLine = order.lines.find((candidate) => candidate.id === line.purchaseOrderLineId);

          if (orderLine) {
            orderLine.quantityReceived -= line.quantityReceived;
            orderLine.quantityRejected -= line.quantityRejected;
          }

          if (line.quantityReceived > 0) {
            applyStockChange(state, {
              productId: line.productId,
              warehouseId: receipt.warehouseId,
              quantityDelta: -line.quantityReceived,
              reservedDelta: 0,
              type: "return",
              referenceType: "goods_receipt",
              referenceId: receipt.id,
              actorUserId: user.id,
              note: `Reversal of ${receipt.id}: ${reason}`,
            });
          }
        }
      }

      receipt.status = "cancelled";
      receipt.cancelledAt = state.now;

      if (order.status === "received" || order.status === "partially_received") {
        const anyReceived = order.lines.some((line) => line.quantityReceived > 0);
        order.status = anyReceived ? "partially_received" : "sent";
      }

      recomputePurchaseOrderStatus(state, order);

      audit(state, user.id, "goods_receipt.cancelled", "goods_receipt", receipt.id, `Cancelled ${receipt.id}: ${reason}`);

      return { receipt, purchaseOrderStatus: order.status };
    },
  }),

  defineTool({
    name: "report_receiving_discrepancy",
    description:
      "Raise a discrepancy against a receipt line, for example a shortage, damage or wrong item.",
    inputSchema: schema(
      {
        goodsReceiptId: S.string("Goods receipt ID."),
        purchaseOrderLineId: S.string("Purchase order line the discrepancy relates to."),
        type: S.enumeration("Kind of discrepancy.", discrepancyTypes),
        quantityExpected: S.integer("Quantity that should have arrived.", { minimum: 0 }),
        quantityReceived: S.integer("Quantity that actually arrived.", { minimum: 0 }),
        actorUserId: S.string("User reporting the discrepancy."),
      },
      ["goodsReceiptId", "purchaseOrderLineId", "type", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const receipt = requireGoodsReceipt(state, readString(input, "goodsReceiptId"));
      const purchaseOrderLineId = readString(input, "purchaseOrderLineId");
      const order = requirePurchaseOrder(state, receipt.purchaseOrderId);

      const orderLine = order.lines.find((line) => line.id === purchaseOrderLineId);

      if (!orderLine) {
        throw toolError("not_found", `Line "${purchaseOrderLineId}" is not on ${order.id}.`);
      }

      const receiptLine = receipt.lines.find(
        (line) => line.purchaseOrderLineId === purchaseOrderLineId,
      );

      const discrepancy: ReceivingDiscrepancy = {
        id: nextId(state, "DISC"),
        goodsReceiptId: receipt.id,
        purchaseOrderId: order.id,
        purchaseOrderLineId,
        productId: orderLine.productId,
        type: readEnum(input, "type", discrepancyTypes),
        quantityExpected:
          typeof input["quantityExpected"] === "number"
            ? readNumber(input, "quantityExpected", { min: 0, integer: true })
            : orderLine.quantityOrdered,
        quantityReceived:
          typeof input["quantityReceived"] === "number"
            ? readNumber(input, "quantityReceived", { min: 0, integer: true })
            : (receiptLine?.quantityReceived ?? 0),
        status: "open",
        reportedByUserId: user.id,
        reportedAt: state.now,
        resolvedAt: null,
        resolution: null,
      };

      state.receivingDiscrepancies[discrepancy.id] = discrepancy;

      audit(state, user.id, "discrepancy.reported", "discrepancy", discrepancy.id, `Reported ${discrepancy.type} on ${receipt.id}`);

      return discrepancy;
    },
  }),

  defineTool({
    name: "list_receiving_discrepancies",
    description:
      "List receiving discrepancies, optionally filtered by status, purchase order or type.",
    inputSchema: schema({
      status: S.enumeration("Only discrepancies with this status.", ["open", "resolved", "waived"]),
      purchaseOrderId: S.string("Only discrepancies on this purchase order."),
      type: S.enumeration("Only discrepancies of this type.", discrepancyTypes),
      ...pagingProperties,
    }),
    run(state, input) {
      const status = readOptionalString(input, "status");
      const purchaseOrderId = readOptionalString(input, "purchaseOrderId");
      const type = readOptionalString(input, "type");

      const discrepancies = Object.values(state.receivingDiscrepancies)
        .filter((discrepancy) => (status ? discrepancy.status === status : true))
        .filter((discrepancy) => (purchaseOrderId ? discrepancy.purchaseOrderId === purchaseOrderId : true))
        .filter((discrepancy) => (type ? discrepancy.type === type : true))
        .sort((a, b) => a.id.localeCompare(b.id));

      return paginate(discrepancies, input);
    },
  }),

  defineTool({
    name: "get_receiving_discrepancy",
    description: "Get one receiving discrepancy.",
    inputSchema: schema({ discrepancyId: S.string("Discrepancy ID, e.g. 'DISC-001'.") }, [
      "discrepancyId",
    ]),
    run(state, input) {
      return requireDiscrepancy(state, readString(input, "discrepancyId"));
    },
  }),

  defineTool({
    name: "resolve_receiving_discrepancy",
    description:
      "Close a discrepancy, either resolved or waived, recording how it was settled.",
    inputSchema: schema(
      {
        discrepancyId: S.string("Discrepancy ID."),
        outcome: S.enumeration("How it was closed.", ["resolved", "waived"]),
        resolution: S.string("What was agreed, e.g. 'vendor credited the shortage'."),
        actorUserId: S.string("User performing the action."),
      },
      ["discrepancyId", "outcome", "resolution", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const discrepancy = requireDiscrepancy(state, readString(input, "discrepancyId"));
      const outcome = readEnum(input, "outcome", ["resolved", "waived"] as const);
      const resolution = readString(input, "resolution");

      assertStatus(discrepancy.status, ["open"], `Discrepancy ${discrepancy.id}`);

      discrepancy.status = outcome;
      discrepancy.resolvedAt = state.now;
      discrepancy.resolution = resolution;

      audit(state, user.id, `discrepancy.${outcome}`, "discrepancy", discrepancy.id, `${discrepancy.id} ${outcome}: ${resolution}`);

      return discrepancy;
    },
  }),

  defineTool({
    name: "list_pending_deliveries",
    description:
      "What is still expected to arrive, by warehouse, with overdue deliveries flagged.",
    inputSchema: schema({
      warehouseId: S.string("Only this warehouse."),
      ...pagingProperties,
    }),
    run(state, input) {
      const warehouseId = readOptionalString(input, "warehouseId");
      if (warehouseId) requireWarehouse(state, warehouseId);

      const rows = Object.values(state.purchaseOrders)
        .filter((order) => order.status === "sent" || order.status === "partially_received")
        .filter((order) => (warehouseId ? order.warehouseId === warehouseId : true))
        .flatMap((order) =>
          order.lines
            .filter((line) => lineRemaining(line) > 0)
            .map((line) => ({
              purchaseOrderId: order.id,
              purchaseOrderLineId: line.id,
              vendorId: order.vendorId,
              warehouseId: order.warehouseId,
              productId: line.productId,
              quantityOutstanding: lineRemaining(line),
              expectedDate: line.expectedDate,
              isOverdue: line.expectedDate < state.now,
            })),
        )
        .sort((a, b) => a.expectedDate.localeCompare(b.expectedDate));

      return paginate(rows, input);
    },
  }),
];
