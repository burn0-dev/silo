/**
 * Lookup and mutation helpers shared by every tool domain.
 *
 * Anything that changes stock, order status or invoice balances goes through
 * here so the rules live in one place instead of being re-implemented per tool.
 */

import {
  type Approval,
  type AuditEntityType,
  type Budget,
  type Customer,
  type CustomerInvoice,
  type ErpState,
  type Expense,
  type Fulfillment,
  type GoodsReceipt,
  type InventoryMovement,
  type InventoryRecord,
  type Money,
  type Payment,
  type Product,
  type PurchaseOrder,
  type PurchaseRequisition,
  type Quotation,
  type ReceivingDiscrepancy,
  type Rfq,
  type SalesOrder,
  type ThreeWayMatch,
  type User,
  type Vendor,
  type VendorInvoice,
  type Warehouse,
  addMoney,
  availableQuantity,
  inventoryId,
  isZeroMoney,
  lineRemaining,
  money,
  nextId,
  outstandingAmount,
  recordAudit,
  subtractMoney,
} from "../state.js";
import { toolError } from "./contract.js";

function require_<T>(
  collection: Record<string, T>,
  id: string,
  label: string,
): T {
  const value = collection[id];

  if (!value) {
    throw toolError("not_found", `${label} "${id}" was not found.`);
  }

  return value;
}

export const requireVendor = (state: ErpState, id: string): Vendor =>
  require_(state.vendors, id, "Vendor");

export const requireCustomer = (state: ErpState, id: string): Customer =>
  require_(state.customers, id, "Customer");

export const requireProduct = (state: ErpState, id: string): Product =>
  require_(state.products, id, "Product");

export const requireWarehouse = (state: ErpState, id: string): Warehouse =>
  require_(state.warehouses, id, "Warehouse");

export const requireUser = (state: ErpState, id: string): User =>
  require_(state.users, id, "User");

export const requireRequisition = (state: ErpState, id: string): PurchaseRequisition =>
  require_(state.requisitions, id, "Purchase requisition");

export const requireApproval = (state: ErpState, id: string) =>
  require_(state.approvals, id, "Approval");

export const requireRfq = (state: ErpState, id: string): Rfq =>
  require_(state.rfqs, id, "RFQ");

export const requireQuotation = (state: ErpState, id: string): Quotation =>
  require_(state.quotations, id, "Quotation");

export const requirePurchaseOrder = (state: ErpState, id: string): PurchaseOrder =>
  require_(state.purchaseOrders, id, "Purchase order");

export const requireGoodsReceipt = (state: ErpState, id: string): GoodsReceipt =>
  require_(state.goodsReceipts, id, "Goods receipt");

export const requireDiscrepancy = (state: ErpState, id: string): ReceivingDiscrepancy =>
  require_(state.receivingDiscrepancies, id, "Receiving discrepancy");

export const requireVendorInvoice = (state: ErpState, id: string): VendorInvoice =>
  require_(state.vendorInvoices, id, "Vendor invoice");

export const requireMatch = (state: ErpState, id: string): ThreeWayMatch =>
  require_(state.threeWayMatches, id, "Three-way match");

export const requirePayment = (state: ErpState, id: string): Payment =>
  require_(state.payments, id, "Payment");

export const requireSalesOrder = (state: ErpState, id: string): SalesOrder =>
  require_(state.salesOrders, id, "Sales order");

export const requireFulfillment = (state: ErpState, id: string): Fulfillment =>
  require_(state.fulfillments, id, "Fulfillment");

export const requireCustomerInvoice = (state: ErpState, id: string): CustomerInvoice =>
  require_(state.customerInvoices, id, "Customer invoice");

export const requireExpense = (state: ErpState, id: string): Expense =>
  require_(state.expenses, id, "Expense");

export const requireBudget = (state: ErpState, id: string): Budget =>
  require_(state.budgets, id, "Budget");

export function requireInventory(
  state: ErpState,
  productId: string,
  warehouseId: string,
): InventoryRecord {
  const record = state.inventory[inventoryId(productId, warehouseId)];

  if (!record) {
    throw toolError(
      "not_found",
      `No inventory record for product "${productId}" at warehouse "${warehouseId}".`,
    );
  }

  return record;
}

/** Creates the record on first use so receipts into a new bin are possible. */
export function ensureInventory(
  state: ErpState,
  productId: string,
  warehouseId: string,
): InventoryRecord {
  requireProduct(state, productId);
  requireWarehouse(state, warehouseId);

  const id = inventoryId(productId, warehouseId);
  const existing = state.inventory[id];

  if (existing) {
    return existing;
  }

  const created: InventoryRecord = {
    id,
    productId,
    warehouseId,
    quantityOnHand: 0,
    quantityReserved: 0,
    quantityInbound: 0,
    binLocation: "UNASSIGNED",
    reorderPoint: null,
    lastCountedAt: null,
  };

  state.inventory[id] = created;

  return created;
}

export function assertStatus<T extends string>(
  actual: T,
  allowed: readonly T[],
  label: string,
): void {
  if (!allowed.includes(actual)) {
    throw toolError(
      "invalid_state",
      `${label} is "${actual}"; expected one of: ${allowed.join(", ")}.`,
      { current: actual, allowed: [...allowed] },
    );
  }
}

export type StockChange = {
  productId: string;
  warehouseId: string;
  quantityDelta: number;
  reservedDelta: number;
  type: InventoryMovement["type"];
  referenceType: InventoryMovement["referenceType"];
  referenceId: string | null;
  actorUserId: string;
  note?: string;
};

/**
 * The single write path for stock. Rejects any change that would drive on-hand
 * or reserved negative, or reserve more than is physically available, then
 * records the movement.
 */
export function applyStockChange(
  state: ErpState,
  change: StockChange,
): { record: InventoryRecord; movement: InventoryMovement } {
  const record = ensureInventory(state, change.productId, change.warehouseId);

  const nextOnHand = record.quantityOnHand + change.quantityDelta;
  const nextReserved = record.quantityReserved + change.reservedDelta;

  if (nextOnHand < 0) {
    throw toolError(
      "insufficient_stock",
      `Cannot move ${Math.abs(change.quantityDelta)} of ${change.productId} out of ${change.warehouseId}: only ${record.quantityOnHand} on hand.`,
      { onHand: record.quantityOnHand, requested: Math.abs(change.quantityDelta) },
    );
  }

  if (nextReserved < 0) {
    throw toolError(
      "invalid_state",
      `Cannot release ${Math.abs(change.reservedDelta)} of ${change.productId} at ${change.warehouseId}: only ${record.quantityReserved} reserved.`,
      { reserved: record.quantityReserved },
    );
  }

  if (nextReserved > nextOnHand) {
    throw toolError(
      "insufficient_stock",
      `Cannot reserve ${change.reservedDelta} of ${change.productId} at ${change.warehouseId}: ${availableQuantity(record)} available.`,
      { available: availableQuantity(record), requested: change.reservedDelta },
    );
  }

  record.quantityOnHand = nextOnHand;
  record.quantityReserved = nextReserved;

  const movement: InventoryMovement = {
    id: nextId(state, "MOV"),
    type: change.type,
    productId: change.productId,
    warehouseId: change.warehouseId,
    quantityDelta: change.quantityDelta,
    reservedDelta: change.reservedDelta,
    referenceType: change.referenceType,
    referenceId: change.referenceId,
    occurredAt: state.now,
    actorUserId: change.actorUserId,
    note: change.note ?? "",
  };

  state.inventoryMovements[movement.id] = movement;

  return { record, movement };
}

/** Recalculates inbound quantities for one warehouse from live purchase orders. */
export function refreshInboundQuantities(state: ErpState, warehouseId: string): void {
  const expected = new Map<string, number>();

  for (const po of Object.values(state.purchaseOrders)) {
    if (po.warehouseId !== warehouseId) continue;
    if (po.status !== "sent" && po.status !== "partially_received") continue;

    for (const line of po.lines) {
      const outstanding = lineRemaining(line);
      if (outstanding <= 0) continue;
      expected.set(line.productId, (expected.get(line.productId) ?? 0) + outstanding);
    }
  }

  for (const record of Object.values(state.inventory)) {
    if (record.warehouseId !== warehouseId) continue;
    record.quantityInbound = expected.get(record.productId) ?? 0;
  }

  for (const [productId, quantity] of expected) {
    const record = ensureInventory(state, productId, warehouseId);
    record.quantityInbound = quantity;
  }
}

export function recomputePurchaseOrderStatus(
  state: ErpState,
  order: PurchaseOrder,
): void {
  if (order.status === "cancelled" || order.status === "closed") {
    return;
  }

  const anyReceived = order.lines.some(
    (line) => line.quantityReceived > 0 || line.quantityRejected > 0,
  );
  const allReceived = order.lines.every((line) => lineRemaining(line) === 0);

  if (allReceived) {
    order.status = "received";
  } else if (anyReceived) {
    order.status = "partially_received";
  }

  refreshInboundQuantities(state, order.warehouseId);
}

export function recomputeSalesOrderStatus(order: SalesOrder): void {
  if (order.status === "cancelled" || order.status === "closed" || order.status === "draft") {
    return;
  }

  const anyFulfilled = order.lines.some((line) => line.quantityFulfilled > 0);
  const allFulfilled = order.lines.every(
    (line) => line.quantityFulfilled >= line.quantityOrdered,
  );

  if (allFulfilled) {
    order.status = "fulfilled";
  } else if (anyFulfilled) {
    order.status = "partially_fulfilled";
  }
}

/** Applies a payment amount to an invoice and moves its status accordingly. */
export function applyPaymentToInvoice(
  invoice: VendorInvoice | CustomerInvoice,
  amount: Money,
  paidAt: string,
): void {
  const remaining = outstandingAmount(invoice);

  if (amount.amount > remaining.amount) {
    throw toolError(
      "invalid_input",
      `Payment of ${amount.amount} exceeds the ${remaining.amount} outstanding on ${invoice.id}.`,
      { outstanding: remaining.amount },
    );
  }

  invoice.amountPaid = addMoney(invoice.amountPaid, amount);

  if (isZeroMoney(outstandingAmount(invoice))) {
    invoice.status = "paid";
    invoice.paidAt = paidAt;
  } else {
    invoice.status = "partially_paid";
  }
}

export function createApproval(
  state: ErpState,
  spec: {
    entityType: Approval["entityType"];
    entityId: string;
    requestedByUserId: string;
    assignedToUserId: string;
    amount: Money | null;
    note?: string;
  },
): Approval {
  const approval: Approval = {
    id: nextId(state, "APR"),
    entityType: spec.entityType,
    entityId: spec.entityId,
    status: "pending",
    requestedByUserId: spec.requestedByUserId,
    assignedToUserId: spec.assignedToUserId,
    amount: spec.amount,
    requestedAt: state.now,
    decidedAt: null,
    decidedByUserId: null,
    notes: spec.note ? [spec.note] : [],
  };

  state.approvals[approval.id] = approval;

  return approval;
}

export function decideApproval(
  state: ErpState,
  approval: Approval,
  decision: "approved" | "rejected",
  decidedByUserId: string,
  note?: string,
): Approval {
  if (approval.status !== "pending") {
    throw toolError(
      "invalid_state",
      `Approval ${approval.id} was already ${approval.status}.`,
      { current: approval.status },
    );
  }

  approval.status = decision;
  approval.decidedAt = state.now;
  approval.decidedByUserId = decidedByUserId;

  if (note) {
    approval.notes.push(note);
  }

  return approval;
}

export function audit(
  state: ErpState,
  actorUserId: string,
  action: string,
  entityType: AuditEntityType,
  entityId: string,
  summary: string,
  changes: Array<{ field: string; from: unknown; to: unknown }> = [],
): void {
  recordAudit(state, {
    actorUserId,
    action,
    entityType,
    entityId,
    summary,
    changes,
  });
}

/** Resolves and validates the acting user; every mutating tool takes one. */
export function actor(state: ErpState, userId: string): User {
  const user = requireUser(state, userId);

  if (!user.isActive) {
    throw toolError("not_allowed", `User "${userId}" is not active.`);
  }

  return user;
}

export function withinApprovalLimit(user: User, amount: Money): boolean {
  if (user.approvalLimit === null) {
    return false;
  }

  return amount.amount <= user.approvalLimit.amount;
}

export function budgetHeadroom(budget: Budget): Money {
  return subtractMoney(
    subtractMoney(budget.allocatedAmount, budget.committedAmount),
    budget.spentAmount,
  );
}

export function commitToBudget(budget: Budget, amount: Money): void {
  const headroom = budgetHeadroom(budget);

  if (amount.amount > headroom.amount) {
    throw toolError(
      "limit_exceeded",
      `Budget ${budget.id} has ${headroom.amount} available; cannot commit ${amount.amount}.`,
      { available: headroom.amount, requested: amount.amount },
    );
  }

  budget.committedAmount = addMoney(budget.committedAmount, amount);
}

export function releaseCommitment(budget: Budget, amount: Money): void {
  const released = Math.min(amount.amount, budget.committedAmount.amount);
  budget.committedAmount = subtractMoney(
    budget.committedAmount,
    money(released, budget.currency),
  );
}

// --- compact projections for list tools ------------------------------------

export const vendorSummary = (vendor: Vendor) => ({
  id: vendor.id,
  name: vendor.name,
  status: vendor.status,
  paymentTerms: vendor.paymentTerms,
  categories: vendor.categories,
  leadTimeDays: vendor.leadTimeDays,
  isPreferred: vendor.isPreferred,
});

export const customerSummary = (customer: Customer) => ({
  id: customer.id,
  name: customer.name,
  status: customer.status,
  segment: customer.segment,
  paymentTerms: customer.paymentTerms,
  creditLimit: customer.creditLimit,
});

export const productSummary = (product: Product) => ({
  id: product.id,
  sku: product.sku,
  name: product.name,
  category: product.category,
  uom: product.uom,
  status: product.status,
  listPrice: product.listPrice,
  standardCost: product.standardCost,
});

export const inventorySummary = (state: ErpState, record: InventoryRecord) => ({
  productId: record.productId,
  warehouseId: record.warehouseId,
  quantityOnHand: record.quantityOnHand,
  quantityReserved: record.quantityReserved,
  quantityAvailable: availableQuantity(record),
  quantityInbound: record.quantityInbound,
  reorderPoint: record.reorderPoint ?? state.products[record.productId]?.reorderPoint ?? 0,
  binLocation: record.binLocation,
});

export const purchaseOrderSummary = (order: PurchaseOrder) => ({
  id: order.id,
  vendorId: order.vendorId,
  status: order.status,
  warehouseId: order.warehouseId,
  totalAmount: order.totalAmount,
  expectedDeliveryDate: order.expectedDeliveryDate,
  lineCount: order.lines.length,
});

export const vendorInvoiceSummary = (invoice: VendorInvoice) => ({
  id: invoice.id,
  vendorId: invoice.vendorId,
  vendorInvoiceNumber: invoice.vendorInvoiceNumber,
  status: invoice.status,
  purchaseOrderId: invoice.purchaseOrderId,
  totalAmount: invoice.totalAmount,
  amountPaid: invoice.amountPaid,
  outstanding: outstandingAmount(invoice),
  dueDate: invoice.dueDate,
});

export const customerInvoiceSummary = (invoice: CustomerInvoice) => ({
  id: invoice.id,
  customerId: invoice.customerId,
  status: invoice.status,
  salesOrderId: invoice.salesOrderId,
  totalAmount: invoice.totalAmount,
  amountPaid: invoice.amountPaid,
  outstanding: outstandingAmount(invoice),
  dueDate: invoice.dueDate,
});

export const salesOrderSummary = (order: SalesOrder) => ({
  id: order.id,
  customerId: order.customerId,
  status: order.status,
  totalAmount: order.totalAmount,
  orderDate: order.orderDate,
  requestedDeliveryDate: order.requestedDeliveryDate,
  lineCount: order.lines.length,
});

export const requisitionSummary = (requisition: PurchaseRequisition) => ({
  id: requisition.id,
  requesterUserId: requisition.requesterUserId,
  departmentId: requisition.departmentId,
  status: requisition.status,
  estimatedTotal: requisition.estimatedTotal,
  budgetId: requisition.budgetId,
  createdAt: requisition.createdAt,
});
