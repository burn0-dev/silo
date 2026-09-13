import {
  type Fulfillment,
  type SalesOrder,
  type SalesOrderStatus,
  addDays,
  availableQuantity,
  money,
  nextId,
  sumMoney,
  unfulfilledQuantity,
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
  applyStockChange,
  assertStatus,
  audit,
  recomputeSalesOrderStatus,
  requireCustomer,
  requireFulfillment,
  requireInventory,
  requireProduct,
  requireSalesOrder,
  requireWarehouse,
  salesOrderSummary,
} from "./helpers.js";

const salesOrderStatuses: readonly SalesOrderStatus[] = [
  "draft",
  "confirmed",
  "partially_fulfilled",
  "fulfilled",
  "invoiced",
  "cancelled",
  "closed",
];

const TAX_RATE = 0.08;

function recalculateTotals(order: SalesOrder): void {
  const subtotal = sumMoney(order.lines.map((line) => line.lineTotal), order.currency);
  order.subtotal = subtotal;
  order.taxAmount = money(subtotal.amount * TAX_RATE, order.currency);
  order.totalAmount = money(subtotal.amount + order.taxAmount.amount, order.currency);
}

/** Customers on hold or blocked may not have stock committed or shipped. */
function assertCustomerCanTrade(
  state: Parameters<typeof requireCustomer>[0],
  customerId: string,
  action: string,
): void {
  const customer = requireCustomer(state, customerId);

  if (customer.status === "blocked" || customer.status === "credit_hold") {
    throw toolError(
      "not_allowed",
      `Customer ${customer.id} is ${customer.status}: ${customer.statusReason ?? "no reason recorded"}. Cannot ${action}.`,
      { customerStatus: customer.status },
    );
  }
}

export const salesOrderTools = [
  defineTool({
    name: "list_sales_orders",
    description: "List sales orders, optionally filtered by status or customer.",
    inputSchema: schema({
      status: S.enumeration("Only orders with this status.", salesOrderStatuses),
      customerId: S.string("Only orders for this customer."),
      ...pagingProperties,
    }),
    run(state, input) {
      const status = readOptionalEnum(input, "status", salesOrderStatuses);
      const customerId = readOptionalString(input, "customerId");

      const orders = Object.values(state.salesOrders)
        .filter((order) => (status ? order.status === status : true))
        .filter((order) => (customerId ? order.customerId === customerId : true))
        .sort((a, b) => a.id.localeCompare(b.id));

      const page = paginate(orders, input);

      return { ...page, results: page.results.map(salesOrderSummary) };
    },
  }),

  defineTool({
    name: "search_sales_orders",
    description: "Search sales orders by ID, customer name or customer PO number.",
    inputSchema: schema(
      { query: S.string("Free-text search term."), ...pagingProperties },
      ["query"],
    ),
    run(state, input) {
      const query = readString(input, "query");

      const orders = Object.values(state.salesOrders)
        .filter((order) => {
          const customer = state.customers[order.customerId];

          return (
            matchesText(order.id, query) ||
            matchesText(order.customerPoNumber, query) ||
            (customer ? matchesText(customer.name, query) : false)
          );
        })
        .sort((a, b) => a.id.localeCompare(b.id));

      const page = paginate(orders, input);

      return { ...page, results: page.results.map(salesOrderSummary) };
    },
  }),

  defineTool({
    name: "get_sales_order",
    description:
      "Get one sales order with per-line reserved and fulfilled quantities, shipments and any invoice.",
    inputSchema: schema({ salesOrderId: S.string("Sales order ID, e.g. 'SO-302'.") }, [
      "salesOrderId",
    ]),
    run(state, input) {
      const order = requireSalesOrder(state, readString(input, "salesOrderId"));

      const shipments = Object.values(state.fulfillments)
        .filter((fulfillment) => fulfillment.salesOrderId === order.id)
        .map((fulfillment) => ({
          id: fulfillment.id,
          status: fulfillment.status,
          warehouseId: fulfillment.warehouseId,
          shippedAt: fulfillment.shippedAt,
        }));

      const invoices = Object.values(state.customerInvoices)
        .filter((invoice) => invoice.salesOrderId === order.id)
        .map((invoice) => ({ id: invoice.id, status: invoice.status, totalAmount: invoice.totalAmount }));

      return {
        ...order,
        lines: order.lines.map((line) => ({
          ...line,
          quantityOutstanding: unfulfilledQuantity(line),
        })),
        fulfillments: shipments,
        customerInvoices: invoices,
      };
    },
  }),

  defineTool({
    name: "create_sales_order",
    description:
      "Create a draft sales order. Blocked customers are refused; customers on credit hold can have an order raised but not reserved or shipped.",
    inputSchema: schema(
      {
        customerId: S.string("Customer placing the order."),
        warehouseId: S.string("Default warehouse to ship from."),
        lines: S.array(
          "Order lines.",
          S.object(
            "Sales order line.",
            {
              productId: S.string("Product ID."),
              quantity: S.integer("Quantity ordered.", { minimum: 1 }),
              unitPrice: S.number("Selling price; defaults to the product list price."),
              warehouseId: S.string("Ship-from warehouse for this line."),
            },
            ["productId", "quantity"],
          ),
        ),
        customerPoNumber: S.string("Customer's own PO reference."),
        requestedDeliveryDate: S.string("ISO date the customer wants delivery."),
        actorUserId: S.string("User creating the order."),
      },
      ["customerId", "warehouseId", "lines", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const customer = requireCustomer(state, readString(input, "customerId"));
      const defaultWarehouse = requireWarehouse(state, readString(input, "warehouseId"));

      if (customer.status === "blocked") {
        throw toolError(
          "not_allowed",
          `Customer ${customer.id} is blocked: ${customer.statusReason ?? "no reason recorded"}.`,
        );
      }

      const id = nextId(state, "SO");

      const lines = readObjectArray(input, "lines").map((line, index) => {
        const product = requireProduct(state, readString(line, "productId"));
        const quantity = readNumber(line, "quantity", { min: 1, integer: true });
        const warehouseId = readOptionalString(line, "warehouseId") ?? defaultWarehouse.id;

        requireWarehouse(state, warehouseId);

        if (product.status === "discontinued") {
          throw toolError("not_allowed", `Product ${product.id} is discontinued and cannot be sold.`);
        }

        const unitPrice =
          typeof line["unitPrice"] === "number"
            ? readNumber(line, "unitPrice", { min: 0 })
            : product.listPrice.amount;

        return {
          id: `${id}-L${index + 1}`,
          productId: product.id,
          quantityOrdered: quantity,
          quantityReserved: 0,
          quantityFulfilled: 0,
          unitPrice: money(unitPrice, state.company.baseCurrency),
          lineTotal: money(quantity * unitPrice, state.company.baseCurrency),
          warehouseId,
        };
      });

      const order: SalesOrder = {
        id,
        number: id,
        customerId: customer.id,
        status: "draft",
        lines,
        currency: state.company.baseCurrency,
        subtotal: money(0, state.company.baseCurrency),
        taxAmount: money(0, state.company.baseCurrency),
        totalAmount: money(0, state.company.baseCurrency),
        customerPoNumber: readOptionalString(input, "customerPoNumber") ?? "",
        orderDate: state.now,
        requestedDeliveryDate: readOptionalString(input, "requestedDeliveryDate") ?? addDays(state.now, 14),
        createdByUserId: user.id,
        confirmedAt: null,
        cancelledAt: null,
        cancelReason: null,
        closedAt: null,
      };

      recalculateTotals(order);
      state.salesOrders[order.id] = order;

      audit(state, user.id, "sales_order.created", "sales_order", order.id, `Created ${order.id} for ${customer.name}`);

      return order;
    },
  }),

  defineTool({
    name: "update_sales_order",
    description: "Change lines or delivery date on a draft sales order.",
    inputSchema: schema(
      {
        salesOrderId: S.string("Sales order ID."),
        requestedDeliveryDate: S.string("New requested delivery date."),
        lines: S.array(
          "Replacement lines.",
          S.object(
            "Sales order line.",
            {
              productId: S.string("Product ID."),
              quantity: S.integer("Quantity ordered.", { minimum: 1 }),
              unitPrice: S.number("Selling price."),
              warehouseId: S.string("Ship-from warehouse."),
            },
            ["productId", "quantity"],
          ),
        ),
        actorUserId: S.string("User performing the action."),
      },
      ["salesOrderId", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const order = requireSalesOrder(state, readString(input, "salesOrderId"));

      assertStatus(order.status, ["draft"], `Sales order ${order.id}`);

      const requested = readOptionalString(input, "requestedDeliveryDate");
      if (requested) order.requestedDeliveryDate = requested;

      if (Array.isArray(input["lines"])) {
        order.lines = readObjectArray(input, "lines").map((line, index) => {
          const product = requireProduct(state, readString(line, "productId"));
          const quantity = readNumber(line, "quantity", { min: 1, integer: true });
          const warehouseId =
            readOptionalString(line, "warehouseId") ?? order.lines[0]?.warehouseId ?? "";

          requireWarehouse(state, warehouseId);

          const unitPrice =
            typeof line["unitPrice"] === "number"
              ? readNumber(line, "unitPrice", { min: 0 })
              : product.listPrice.amount;

          return {
            id: `${order.id}-L${index + 1}`,
            productId: product.id,
            quantityOrdered: quantity,
            quantityReserved: 0,
            quantityFulfilled: 0,
            unitPrice: money(unitPrice, order.currency),
            lineTotal: money(quantity * unitPrice, order.currency),
            warehouseId,
          };
        });

        recalculateTotals(order);
      }

      audit(state, user.id, "sales_order.updated", "sales_order", order.id, `Updated ${order.id}`);

      return order;
    },
  }),

  defineTool({
    name: "confirm_sales_order",
    description:
      "Confirm a draft order so it can be reserved and shipped. Refused for customers who are blocked or on credit hold.",
    inputSchema: schema(
      { salesOrderId: S.string("Sales order ID."), actorUserId: S.string("User performing the action.") },
      ["salesOrderId", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const order = requireSalesOrder(state, readString(input, "salesOrderId"));

      assertStatus(order.status, ["draft"], `Sales order ${order.id}`);
      assertCustomerCanTrade(state, order.customerId, "confirm the order");

      if (order.lines.length === 0) {
        throw toolError("invalid_state", `Sales order ${order.id} has no lines.`);
      }

      order.status = "confirmed";
      order.confirmedAt = state.now;

      audit(state, user.id, "sales_order.confirmed", "sales_order", order.id, `Confirmed ${order.id}`);

      return order;
    },
  }),

  defineTool({
    name: "check_sales_order_stock",
    description:
      "Check, line by line, whether a confirmed order can be shipped from its nominated warehouse, and where the stock is otherwise.",
    inputSchema: schema({ salesOrderId: S.string("Sales order ID.") }, ["salesOrderId"]),
    run(state, input) {
      const order = requireSalesOrder(state, readString(input, "salesOrderId"));

      const lines = order.lines.map((line) => {
        const record = state.inventory[`STK-${line.productId}-${line.warehouseId}`];
        const availableHere = record ? availableQuantity(record) : 0;
        const outstanding = unfulfilledQuantity(line);

        const elsewhere = Object.values(state.inventory)
          .filter(
            (candidate) =>
              candidate.productId === line.productId &&
              candidate.warehouseId !== line.warehouseId &&
              availableQuantity(candidate) > 0,
          )
          .map((candidate) => ({
            warehouseId: candidate.warehouseId,
            quantityAvailable: availableQuantity(candidate),
          }))
          .sort((a, b) => b.quantityAvailable - a.quantityAvailable);

        return {
          salesOrderLineId: line.id,
          productId: line.productId,
          quantityOutstanding: outstanding,
          quantityReserved: line.quantityReserved,
          nominatedWarehouseId: line.warehouseId,
          availableAtNominated: availableHere,
          canShipInFull: availableHere >= outstanding,
          shortfall: Math.max(0, outstanding - availableHere),
          availableElsewhere: elsewhere,
          totalAvailableAcrossWarehouses:
            availableHere + elsewhere.reduce((total, row) => total + row.quantityAvailable, 0),
        };
      });

      return {
        salesOrderId: order.id,
        status: order.status,
        canFulfilInFull: lines.every((line) => line.canShipInFull),
        requiresTransferOrSplit: lines.some(
          (line) => !line.canShipInFull && line.totalAvailableAcrossWarehouses >= line.quantityOutstanding,
        ),
        lines,
      };
    },
  }),

  defineTool({
    name: "reserve_sales_order_stock",
    description:
      "Reserve stock for the outstanding quantities on a confirmed order. Reserves what is available at each line's warehouse.",
    inputSchema: schema(
      { salesOrderId: S.string("Sales order ID."), actorUserId: S.string("User performing the action.") },
      ["salesOrderId", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const order = requireSalesOrder(state, readString(input, "salesOrderId"));

      assertStatus(order.status, ["confirmed", "partially_fulfilled"], `Sales order ${order.id}`);
      assertCustomerCanTrade(state, order.customerId, "reserve stock");

      const results = [];

      for (const line of order.lines) {
        const needed = unfulfilledQuantity(line) - line.quantityReserved;
        if (needed <= 0) continue;

        const record = requireInventory(state, line.productId, line.warehouseId);
        const toReserve = Math.min(needed, availableQuantity(record));

        if (toReserve <= 0) {
          results.push({ salesOrderLineId: line.id, reserved: 0, shortfall: needed });
          continue;
        }

        applyStockChange(state, {
          productId: line.productId,
          warehouseId: line.warehouseId,
          quantityDelta: 0,
          reservedDelta: toReserve,
          type: "reservation",
          referenceType: "sales_order",
          referenceId: order.id,
          actorUserId: user.id,
          note: `Reserved for ${order.id}`,
        });

        line.quantityReserved += toReserve;
        results.push({ salesOrderLineId: line.id, reserved: toReserve, shortfall: needed - toReserve });
      }

      audit(state, user.id, "sales_order.reserved", "sales_order", order.id, `Reserved stock for ${order.id}`);

      return { salesOrderId: order.id, lines: results };
    },
  }),

  defineTool({
    name: "release_sales_order_stock",
    description: "Release all stock currently reserved against a sales order.",
    inputSchema: schema(
      {
        salesOrderId: S.string("Sales order ID."),
        reason: S.string("Why the reservation is being released."),
        actorUserId: S.string("User performing the action."),
      },
      ["salesOrderId", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const order = requireSalesOrder(state, readString(input, "salesOrderId"));
      const reason = readOptionalString(input, "reason") ?? "Reservation released";

      const released = [];

      for (const line of order.lines) {
        if (line.quantityReserved <= 0) continue;

        applyStockChange(state, {
          productId: line.productId,
          warehouseId: line.warehouseId,
          quantityDelta: 0,
          reservedDelta: -line.quantityReserved,
          type: "release",
          referenceType: "sales_order",
          referenceId: order.id,
          actorUserId: user.id,
          note: reason,
        });

        released.push({ salesOrderLineId: line.id, released: line.quantityReserved });
        line.quantityReserved = 0;
      }

      audit(state, user.id, "sales_order.reservation_released", "sales_order", order.id, `Released reservations on ${order.id}: ${reason}`);

      return { salesOrderId: order.id, released };
    },
  }),

  defineTool({
    name: "fulfill_sales_order",
    description:
      "Ship stock against a sales order, creating a fulfillment record. Ships from each line's warehouse unless overridden, which is how an order is filled across multiple sites. Omit lines to ship everything outstanding.",
    inputSchema: schema(
      {
        salesOrderId: S.string("Sales order ID."),
        lines: S.array(
          "Lines to ship. Omit to ship all outstanding quantities.",
          S.object(
            "Shipment line.",
            {
              salesOrderLineId: S.string("Sales order line ID."),
              quantity: S.integer("Units to ship.", { minimum: 1 }),
              warehouseId: S.string("Ship from this warehouse instead of the line's default."),
            },
            ["salesOrderLineId", "quantity"],
          ),
        ),
        carrier: S.string("Carrier name."),
        trackingNumber: S.string("Tracking reference."),
        actorUserId: S.string("User shipping the goods."),
      },
      ["salesOrderId", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const order = requireSalesOrder(state, readString(input, "salesOrderId"));

      assertStatus(order.status, ["confirmed", "partially_fulfilled"], `Sales order ${order.id}`);
      assertCustomerCanTrade(state, order.customerId, "ship the order");

      const specs = Array.isArray(input["lines"])
        ? readObjectArray(input, "lines").map((line) => ({
            salesOrderLineId: readString(line, "salesOrderLineId"),
            quantity: readNumber(line, "quantity", { min: 1, integer: true }),
            warehouseId: readOptionalString(line, "warehouseId"),
          }))
        : order.lines
            .filter((line) => unfulfilledQuantity(line) > 0)
            .map((line) => ({
              salesOrderLineId: line.id,
              quantity: unfulfilledQuantity(line),
              warehouseId: undefined,
            }));

      if (specs.length === 0) {
        throw toolError("invalid_state", `Nothing is outstanding on ${order.id}.`);
      }

      const id = nextId(state, "FUL");
      const shipmentLines: Fulfillment["lines"] = [];
      const warehousesUsed = new Set<string>();

      for (const [index, spec] of specs.entries()) {
        const line = order.lines.find((candidate) => candidate.id === spec.salesOrderLineId);

        if (!line) {
          throw toolError("not_found", `Line "${spec.salesOrderLineId}" is not on ${order.id}.`);
        }

        const outstanding = unfulfilledQuantity(line);

        if (spec.quantity > outstanding) {
          throw toolError(
            "invalid_input",
            `Cannot ship ${spec.quantity} of ${line.productId}: only ${outstanding} outstanding on ${line.id}.`,
            { outstanding },
          );
        }

        const warehouseId = spec.warehouseId ?? line.warehouseId;
        requireWarehouse(state, warehouseId);

        const record = requireInventory(state, line.productId, warehouseId);
        const reservedHere = warehouseId === line.warehouseId ? line.quantityReserved : 0;
        const shippable = availableQuantity(record) + Math.min(reservedHere, spec.quantity);

        if (shippable < spec.quantity) {
          throw toolError(
            "insufficient_stock",
            `Cannot ship ${spec.quantity} of ${line.productId} from ${warehouseId}: ${shippable} available (including ${reservedHere} reserved for this order).`,
            { available: shippable, requested: spec.quantity },
          );
        }

        const releaseFromReservation = Math.min(reservedHere, spec.quantity);

        applyStockChange(state, {
          productId: line.productId,
          warehouseId,
          quantityDelta: -spec.quantity,
          reservedDelta: -releaseFromReservation,
          type: "issue",
          referenceType: "fulfillment",
          referenceId: id,
          actorUserId: user.id,
          note: `Shipped against ${order.id}`,
        });

        line.quantityFulfilled += spec.quantity;
        line.quantityReserved -= releaseFromReservation;
        warehousesUsed.add(warehouseId);

        shipmentLines.push({
          id: `${id}-L${index + 1}`,
          salesOrderLineId: line.id,
          productId: line.productId,
          quantity: spec.quantity,
        });
      }

      const fulfillment: Fulfillment = {
        id,
        number: id,
        salesOrderId: order.id,
        warehouseId: [...warehousesUsed][0] ?? order.lines[0]?.warehouseId ?? "",
        status: "shipped",
        lines: shipmentLines,
        carrier: readOptionalString(input, "carrier") ?? "",
        trackingNumber: readOptionalString(input, "trackingNumber") ?? "",
        shippedByUserId: user.id,
        shippedAt: state.now,
        deliveredAt: null,
      };

      state.fulfillments[fulfillment.id] = fulfillment;

      recomputeSalesOrderStatus(order);

      audit(state, user.id, "fulfillment.shipped", "fulfillment", fulfillment.id, `Shipped ${fulfillment.id} against ${order.id}`);

      return { fulfillment, salesOrderStatus: order.status, warehousesUsed: [...warehousesUsed] };
    },
  }),

  defineTool({
    name: "mark_fulfillment_delivered",
    description: "Record that a shipment reached the customer.",
    inputSchema: schema(
      { fulfillmentId: S.string("Fulfillment ID."), actorUserId: S.string("User performing the action.") },
      ["fulfillmentId", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const fulfillment = requireFulfillment(state, readString(input, "fulfillmentId"));

      assertStatus(fulfillment.status, ["shipped"], `Fulfillment ${fulfillment.id}`);

      fulfillment.status = "delivered";
      fulfillment.deliveredAt = state.now;

      audit(state, user.id, "fulfillment.delivered", "fulfillment", fulfillment.id, `${fulfillment.id} delivered`);

      return fulfillment;
    },
  }),

  defineTool({
    name: "list_fulfillments",
    description: "List shipments, optionally for one sales order or warehouse.",
    inputSchema: schema({
      salesOrderId: S.string("Only shipments for this order."),
      warehouseId: S.string("Only shipments from this warehouse."),
      ...pagingProperties,
    }),
    run(state, input) {
      const salesOrderId = readOptionalString(input, "salesOrderId");
      const warehouseId = readOptionalString(input, "warehouseId");

      const fulfillments = Object.values(state.fulfillments)
        .filter((fulfillment) => (salesOrderId ? fulfillment.salesOrderId === salesOrderId : true))
        .filter((fulfillment) => (warehouseId ? fulfillment.warehouseId === warehouseId : true))
        .sort((a, b) => a.id.localeCompare(b.id));

      return paginate(fulfillments, input);
    },
  }),

  defineTool({
    name: "cancel_sales_order",
    description:
      "Cancel a sales order, releasing any reservations. Fails once anything has shipped.",
    inputSchema: schema(
      {
        salesOrderId: S.string("Sales order ID."),
        reason: S.string("Why it is being cancelled."),
        actorUserId: S.string("User performing the action."),
      },
      ["salesOrderId", "reason", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const order = requireSalesOrder(state, readString(input, "salesOrderId"));
      const reason = readString(input, "reason");

      assertStatus(order.status, ["draft", "confirmed"], `Sales order ${order.id}`);

      const shipped = order.lines.reduce((total, line) => total + line.quantityFulfilled, 0);

      if (shipped > 0) {
        throw toolError(
          "invalid_state",
          `${order.id} already has ${shipped} unit(s) shipped and cannot be cancelled.`,
        );
      }

      for (const line of order.lines) {
        if (line.quantityReserved <= 0) continue;

        applyStockChange(state, {
          productId: line.productId,
          warehouseId: line.warehouseId,
          quantityDelta: 0,
          reservedDelta: -line.quantityReserved,
          type: "release",
          referenceType: "sales_order",
          referenceId: order.id,
          actorUserId: user.id,
          note: `Order cancelled: ${reason}`,
        });

        line.quantityReserved = 0;
      }

      order.status = "cancelled";
      order.cancelledAt = state.now;
      order.cancelReason = reason;

      audit(state, user.id, "sales_order.cancelled", "sales_order", order.id, `Cancelled ${order.id}: ${reason}`);

      return order;
    },
  }),

  defineTool({
    name: "list_unfulfilled_sales_orders",
    description:
      "Confirmed orders with quantities still to ship, flagging those past their requested delivery date.",
    inputSchema: schema({ ...pagingProperties }),
    run(state, input) {
      const rows = Object.values(state.salesOrders)
        .filter((order) => order.status === "confirmed" || order.status === "partially_fulfilled")
        .filter((order) => order.lines.some((line) => unfulfilledQuantity(line) > 0))
        .map((order) => ({
          ...salesOrderSummary(order),
          unitsOutstanding: order.lines.reduce((total, line) => total + unfulfilledQuantity(line), 0),
          isLate: order.requestedDeliveryDate < state.now,
          customerStatus: state.customers[order.customerId]?.status,
        }))
        .sort((a, b) => a.requestedDeliveryDate.localeCompare(b.requestedDeliveryDate));

      return paginate(rows, input);
    },
  }),
];
