/**
 * ERP state model.
 *
 * Conventions:
 * - IDs are stable, human-readable strings ("PO-203", "VEN-001").
 * - Relationships are expressed as IDs, never nested objects.
 * - Money always carries a currency and is rounded to 2 decimals on creation.
 * - Timestamps are ISO-8601 strings; `state.now` is the simulated clock, so
 *   nothing in this environment reads the real system time.
 * - Derived values (available stock, overdue, budget headroom) are computed by
 *   helpers rather than stored, so they cannot drift after a mutation.
 */

export type Currency = "USD" | "EUR" | "GBP";

export type Money = {
  amount: number;
  currency: Currency;
};

export type UnitOfMeasure = "each" | "box" | "case" | "kg" | "litre" | "metre";

export type PaymentTerms =
  | "NET_15"
  | "NET_30"
  | "NET_45"
  | "NET_60"
  | "DUE_ON_RECEIPT";

export type UserRole =
  | "admin"
  | "requester"
  | "procurement_officer"
  | "procurement_manager"
  | "warehouse_operator"
  | "warehouse_manager"
  | "ap_clerk"
  | "ap_manager"
  | "finance_controller"
  | "sales_rep"
  | "sales_manager";

export type Address = {
  line1: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
};

export type Contact = {
  name: string;
  email: string;
  phone: string;
};

export type Company = {
  id: string;
  name: string;
  legalName: string;
  taxId: string;
  baseCurrency: Currency;
  fiscalYear: string;
  fiscalYearStart: string;
  address: Address;
};

export type Department = {
  id: string;
  code: string;
  name: string;
  managerUserId: string;
  costCenter: string;
};

export type User = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  departmentId: string;
  approvalLimit: Money | null;
  isActive: boolean;
};

export type VendorStatus = "active" | "inactive" | "blocked" | "pending_approval";

export type Vendor = {
  id: string;
  code: string;
  name: string;
  status: VendorStatus;
  categories: string[];
  paymentTerms: PaymentTerms;
  currency: Currency;
  contact: Contact;
  address: Address;
  taxId: string;
  rating: number;
  leadTimeDays: number;
  isPreferred: boolean;
  createdAt: string;
  statusReason: string | null;
};

export type CustomerStatus = "active" | "inactive" | "blocked" | "credit_hold";

export type Customer = {
  id: string;
  code: string;
  name: string;
  status: CustomerStatus;
  segment: string;
  creditLimit: Money;
  paymentTerms: PaymentTerms;
  currency: Currency;
  contact: Contact;
  billingAddress: Address;
  shippingAddress: Address;
  createdAt: string;
  statusReason: string | null;
};

export type ProductStatus = "active" | "discontinued" | "draft";

export type Product = {
  id: string;
  sku: string;
  name: string;
  category: string;
  uom: UnitOfMeasure;
  standardCost: Money;
  listPrice: Money;
  status: ProductStatus;
  reorderPoint: number;
  reorderQuantity: number;
  leadTimeDays: number;
  preferredVendorIds: string[];
  isStocked: boolean;
};

export type WarehouseType = "distribution" | "production" | "retail" | "overflow";

export type Warehouse = {
  id: string;
  code: string;
  name: string;
  type: WarehouseType;
  address: Address;
  managerUserId: string;
  isActive: boolean;
};

export type InventoryRecord = {
  id: string;
  productId: string;
  warehouseId: string;
  quantityOnHand: number;
  quantityReserved: number;
  quantityInbound: number;
  binLocation: string;
  reorderPoint: number | null;
  lastCountedAt: string | null;
};

export type InventoryMovementType =
  | "receipt"
  | "issue"
  | "transfer_out"
  | "transfer_in"
  | "adjustment"
  | "reservation"
  | "release"
  | "return";

export type InventoryReferenceType =
  | "goods_receipt"
  | "sales_order"
  | "fulfillment"
  | "transfer"
  | "adjustment"
  | "manual";

export type InventoryMovement = {
  id: string;
  type: InventoryMovementType;
  productId: string;
  warehouseId: string;
  quantityDelta: number;
  reservedDelta: number;
  referenceType: InventoryReferenceType;
  referenceId: string | null;
  occurredAt: string;
  actorUserId: string;
  note: string;
};

export type RequisitionStatus =
  | "draft"
  | "submitted"
  | "pending_approval"
  | "approved"
  | "rejected"
  | "cancelled"
  | "converted";

export type RequisitionLine = {
  id: string;
  productId: string;
  quantity: number;
  estimatedUnitPrice: Money;
  neededBy: string;
};

export type PurchaseRequisition = {
  id: string;
  number: string;
  requesterUserId: string;
  departmentId: string;
  status: RequisitionStatus;
  lines: RequisitionLine[];
  justification: string;
  estimatedTotal: Money;
  budgetId: string | null;
  createdAt: string;
  submittedAt: string | null;
  decidedAt: string | null;
  approvalId: string | null;
  rfqId: string | null;
  purchaseOrderId: string | null;
};

export type ApprovalEntityType =
  | "requisition"
  | "purchase_order"
  | "vendor_invoice"
  | "payment"
  | "expense";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "cancelled";

export type Approval = {
  id: string;
  entityType: ApprovalEntityType;
  entityId: string;
  status: ApprovalStatus;
  requestedByUserId: string;
  assignedToUserId: string;
  amount: Money | null;
  requestedAt: string;
  decidedAt: string | null;
  decidedByUserId: string | null;
  notes: string[];
};

export type RfqStatus = "draft" | "sent" | "closed" | "awarded" | "cancelled";

export type RfqLine = {
  id: string;
  productId: string;
  quantity: number;
};

export type Rfq = {
  id: string;
  number: string;
  title: string;
  status: RfqStatus;
  requisitionId: string | null;
  lines: RfqLine[];
  invitedVendorIds: string[];
  issuedByUserId: string;
  createdAt: string;
  sentAt: string | null;
  responseDueDate: string;
  closedAt: string | null;
  awardedQuotationId: string | null;
};

export type QuotationStatus =
  | "received"
  | "under_review"
  | "accepted"
  | "rejected"
  | "expired";

export type QuotationLine = {
  id: string;
  productId: string;
  quantity: number;
  unitPrice: Money;
  lineTotal: Money;
};

export type Quotation = {
  id: string;
  number: string;
  rfqId: string;
  vendorId: string;
  status: QuotationStatus;
  lines: QuotationLine[];
  subtotal: Money;
  totalAmount: Money;
  leadTimeDays: number;
  validUntil: string;
  receivedAt: string;
  notes: string;
};

export type PurchaseOrderStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "rejected"
  | "sent"
  | "partially_received"
  | "received"
  | "closed"
  | "cancelled";

export type PurchaseOrderLine = {
  id: string;
  productId: string;
  description: string;
  quantityOrdered: number;
  quantityReceived: number;
  quantityRejected: number;
  quantityInvoiced: number;
  unitPrice: Money;
  lineTotal: Money;
  expectedDate: string;
};

export type PurchaseOrder = {
  id: string;
  number: string;
  vendorId: string;
  status: PurchaseOrderStatus;
  lines: PurchaseOrderLine[];
  warehouseId: string;
  currency: Currency;
  subtotal: Money;
  taxAmount: Money;
  totalAmount: Money;
  requisitionId: string | null;
  quotationId: string | null;
  budgetId: string | null;
  paymentTerms: PaymentTerms;
  createdByUserId: string;
  createdAt: string;
  approvalId: string | null;
  approvedAt: string | null;
  approvedByUserId: string | null;
  sentAt: string | null;
  expectedDeliveryDate: string;
  closedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
};

export type GoodsReceiptStatus = "draft" | "posted" | "cancelled";

export type GoodsReceiptLine = {
  id: string;
  purchaseOrderLineId: string;
  productId: string;
  quantityReceived: number;
  quantityRejected: number;
  note: string;
};

export type GoodsReceipt = {
  id: string;
  number: string;
  purchaseOrderId: string;
  warehouseId: string;
  status: GoodsReceiptStatus;
  lines: GoodsReceiptLine[];
  deliveryNote: string;
  receivedByUserId: string;
  receivedAt: string;
  postedAt: string | null;
  cancelledAt: string | null;
};

export type DiscrepancyType = "shortage" | "overage" | "damage" | "wrong_item";

export type DiscrepancyStatus = "open" | "resolved" | "waived";

export type ReceivingDiscrepancy = {
  id: string;
  goodsReceiptId: string;
  purchaseOrderId: string;
  purchaseOrderLineId: string;
  productId: string;
  type: DiscrepancyType;
  quantityExpected: number;
  quantityReceived: number;
  status: DiscrepancyStatus;
  reportedByUserId: string;
  reportedAt: string;
  resolvedAt: string | null;
  resolution: string | null;
};

export type VendorInvoiceStatus =
  | "draft"
  | "pending_match"
  | "matched"
  | "pending_approval"
  | "approved"
  | "disputed"
  | "partially_paid"
  | "paid"
  | "rejected"
  | "cancelled";

export type VendorInvoiceLine = {
  id: string;
  purchaseOrderLineId: string | null;
  productId: string | null;
  description: string;
  quantity: number;
  unitPrice: Money;
  lineTotal: Money;
};

export type VendorInvoice = {
  id: string;
  number: string;
  vendorInvoiceNumber: string;
  vendorId: string;
  purchaseOrderId: string | null;
  goodsReceiptIds: string[];
  status: VendorInvoiceStatus;
  lines: VendorInvoiceLine[];
  subtotal: Money;
  taxAmount: Money;
  totalAmount: Money;
  amountPaid: Money;
  invoiceDate: string;
  dueDate: string;
  receivedAt: string;
  matchId: string | null;
  approvalId: string | null;
  approvedAt: string | null;
  approvedByUserId: string | null;
  disputeReason: string | null;
  paidAt: string | null;
};

export type MatchStatus = "pending" | "matched" | "failed";

export type MatchDiscrepancyType =
  | "price"
  | "quantity"
  | "missing_receipt"
  | "missing_purchase_order"
  | "total";

export type MatchDiscrepancy = {
  type: MatchDiscrepancyType;
  purchaseOrderLineId: string | null;
  productId: string | null;
  expected: number;
  actual: number;
  message: string;
};

export type MatchTolerance = {
  pricePercent: number;
  quantityPercent: number;
};

export type ThreeWayMatch = {
  id: string;
  vendorInvoiceId: string;
  purchaseOrderId: string | null;
  goodsReceiptIds: string[];
  status: MatchStatus;
  discrepancies: MatchDiscrepancy[];
  tolerance: MatchTolerance;
  runAt: string;
  runByUserId: string;
};

export type PaymentDirection = "outbound" | "inbound";

export type PaymentMethod = "bank_transfer" | "ach" | "check" | "card";

export type PaymentStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "completed"
  | "failed"
  | "cancelled";

export type PaymentAllocation = {
  invoiceId: string;
  amount: Money;
};

export type Payment = {
  id: string;
  number: string;
  direction: PaymentDirection;
  vendorId: string | null;
  customerId: string | null;
  allocations: PaymentAllocation[];
  amount: Money;
  method: PaymentMethod;
  status: PaymentStatus;
  reference: string;
  scheduledDate: string;
  processedAt: string | null;
  failureReason: string | null;
  createdByUserId: string;
  approvalId: string | null;
  approvedByUserId: string | null;
  createdAt: string;
};

export type SalesOrderStatus =
  | "draft"
  | "confirmed"
  | "partially_fulfilled"
  | "fulfilled"
  | "invoiced"
  | "cancelled"
  | "closed";

export type SalesOrderLine = {
  id: string;
  productId: string;
  quantityOrdered: number;
  quantityReserved: number;
  quantityFulfilled: number;
  unitPrice: Money;
  lineTotal: Money;
  warehouseId: string;
};

export type SalesOrder = {
  id: string;
  number: string;
  customerId: string;
  status: SalesOrderStatus;
  lines: SalesOrderLine[];
  currency: Currency;
  subtotal: Money;
  taxAmount: Money;
  totalAmount: Money;
  customerPoNumber: string;
  orderDate: string;
  requestedDeliveryDate: string;
  createdByUserId: string;
  confirmedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  closedAt: string | null;
};

export type FulfillmentStatus = "draft" | "shipped" | "delivered" | "cancelled";

export type FulfillmentLine = {
  id: string;
  salesOrderLineId: string;
  productId: string;
  quantity: number;
};

export type Fulfillment = {
  id: string;
  number: string;
  salesOrderId: string;
  warehouseId: string;
  status: FulfillmentStatus;
  lines: FulfillmentLine[];
  carrier: string;
  trackingNumber: string;
  shippedByUserId: string;
  shippedAt: string | null;
  deliveredAt: string | null;
};

export type CustomerInvoiceStatus =
  | "draft"
  | "issued"
  | "partially_paid"
  | "paid"
  | "cancelled"
  | "written_off";

export type CustomerInvoiceLine = {
  id: string;
  salesOrderLineId: string | null;
  productId: string;
  description: string;
  quantity: number;
  unitPrice: Money;
  lineTotal: Money;
};

export type CustomerInvoice = {
  id: string;
  number: string;
  customerId: string;
  salesOrderId: string | null;
  fulfillmentIds: string[];
  status: CustomerInvoiceStatus;
  lines: CustomerInvoiceLine[];
  subtotal: Money;
  taxAmount: Money;
  totalAmount: Money;
  amountPaid: Money;
  issueDate: string;
  dueDate: string;
  paidAt: string | null;
};

export type ExpenseStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "rejected"
  | "paid";

export type Expense = {
  id: string;
  number: string;
  employeeUserId: string;
  departmentId: string;
  category: string;
  description: string;
  amount: Money;
  status: ExpenseStatus;
  incurredAt: string;
  submittedAt: string | null;
  approvalId: string | null;
  budgetId: string | null;
  paymentId: string | null;
  hasReceipt: boolean;
};

export type BudgetStatus = "active" | "closed";

export type Budget = {
  id: string;
  name: string;
  departmentId: string;
  fiscalYear: string;
  category: string;
  allocatedAmount: Money;
  committedAmount: Money;
  spentAmount: Money;
  currency: Currency;
  status: BudgetStatus;
};

export type AuditEntityType =
  | "company"
  | "vendor"
  | "customer"
  | "product"
  | "warehouse"
  | "inventory"
  | "requisition"
  | "approval"
  | "rfq"
  | "quotation"
  | "purchase_order"
  | "goods_receipt"
  | "discrepancy"
  | "vendor_invoice"
  | "three_way_match"
  | "payment"
  | "sales_order"
  | "fulfillment"
  | "customer_invoice"
  | "expense"
  | "budget";

export type AuditChange = {
  field: string;
  from: unknown;
  to: unknown;
};

export type AuditEvent = {
  id: string;
  at: string;
  actorUserId: string;
  action: string;
  entityType: AuditEntityType;
  entityId: string;
  summary: string;
  changes: AuditChange[];
};

export type State = {
  now: string;
  company: Company;
  departments: Record<string, Department>;
  users: Record<string, User>;
  vendors: Record<string, Vendor>;
  customers: Record<string, Customer>;
  products: Record<string, Product>;
  warehouses: Record<string, Warehouse>;
  inventory: Record<string, InventoryRecord>;
  inventoryMovements: Record<string, InventoryMovement>;
  requisitions: Record<string, PurchaseRequisition>;
  approvals: Record<string, Approval>;
  rfqs: Record<string, Rfq>;
  quotations: Record<string, Quotation>;
  purchaseOrders: Record<string, PurchaseOrder>;
  goodsReceipts: Record<string, GoodsReceipt>;
  receivingDiscrepancies: Record<string, ReceivingDiscrepancy>;
  vendorInvoices: Record<string, VendorInvoice>;
  threeWayMatches: Record<string, ThreeWayMatch>;
  payments: Record<string, Payment>;
  salesOrders: Record<string, SalesOrder>;
  fulfillments: Record<string, Fulfillment>;
  customerInvoices: Record<string, CustomerInvoice>;
  expenses: Record<string, Expense>;
  budgets: Record<string, Budget>;
  auditLog: AuditEvent[];
  sequences: Record<string, number>;
};

export function round2(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

export function money(amount: number, currency: Currency = "USD"): Money {
  return { amount: round2(amount), currency };
}

export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amount + b.amount, a.currency);
}

export function subtractMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amount - b.amount, a.currency);
}

export function multiplyMoney(value: Money, factor: number): Money {
  return money(value.amount * factor, value.currency);
}

export function sumMoney(values: Money[], currency: Currency = "USD"): Money {
  return values.reduce((total, value) => addMoney(total, value), money(0, currency));
}

export function isZeroMoney(value: Money): boolean {
  return round2(value.amount) === 0;
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new Error(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  }
}

export function inventoryId(productId: string, warehouseId: string): string {
  return `STK-${productId}-${warehouseId}`;
}

export function findInventory(
  state: State,
  productId: string,
  warehouseId: string,
): InventoryRecord | undefined {
  return state.inventory[inventoryId(productId, warehouseId)];
}

export function availableQuantity(record: InventoryRecord): number {
  return record.quantityOnHand - record.quantityReserved;
}

export function effectiveReorderPoint(
  record: InventoryRecord,
  product: Product,
): number {
  return record.reorderPoint ?? product.reorderPoint;
}

export function outstandingAmount(invoice: {
  totalAmount: Money;
  amountPaid: Money;
}): Money {
  return subtractMoney(invoice.totalAmount, invoice.amountPaid);
}

export function isOverdue(
  invoice: { dueDate: string; status: string; totalAmount: Money; amountPaid: Money },
  now: string,
): boolean {
  const settled = ["paid", "cancelled", "written_off", "draft"].includes(
    invoice.status,
  );

  if (settled) {
    return false;
  }

  return invoice.dueDate < now && !isZeroMoney(outstandingAmount(invoice));
}

export function budgetAvailable(budget: Budget): Money {
  return subtractMoney(
    subtractMoney(budget.allocatedAmount, budget.committedAmount),
    budget.spentAmount,
  );
}

/**
 * Units still to arrive. Rejected units count as delivered — the vendor shipped
 * them and they failed inspection, which is settled by credit or a discrepancy,
 * not by shipping them again.
 */
export function lineRemaining(line: PurchaseOrderLine): number {
  return Math.max(0, line.quantityOrdered - line.quantityReceived - line.quantityRejected);
}

export function uninvoicedQuantity(line: PurchaseOrderLine): number {
  return line.quantityReceived - line.quantityInvoiced;
}

export function unfulfilledQuantity(line: SalesOrderLine): number {
  return line.quantityOrdered - line.quantityFulfilled;
}

export function paymentTermDays(terms: PaymentTerms): number {
  switch (terms) {
    case "DUE_ON_RECEIPT":
      return 0;
    case "NET_15":
      return 15;
    case "NET_30":
      return 30;
    case "NET_45":
      return 45;
    case "NET_60":
      return 60;
  }
}

export function addDays(isoDate: string, days: number): string {
  const date = new Date(isoDate);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

export function daysBetween(from: string, to: string): number {
  const millis = new Date(to).getTime() - new Date(from).getTime();
  return Math.floor(millis / 86_400_000);
}

export function formatId(prefix: string, value: number, pad = 3): string {
  return `${prefix}-${String(value).padStart(pad, "0")}`;
}

/**
 * Deterministic ID minting. Sequence counters live in state so repeated runs of
 * the same task produce identical IDs.
 */
export function nextId(state: State, prefix: string, pad = 3): string {
  const next = (state.sequences[prefix] ?? 1) + 1;
  state.sequences[prefix] = next;
  return formatId(prefix, next, pad);
}

export function indexById<T extends { id: string }>(
  items: T[],
): Record<string, T> {
  const result: Record<string, T> = {};

  for (const item of items) {
    result[item.id] = item;
  }

  return result;
}

export function recordAudit(
  state: State,
  event: Omit<AuditEvent, "id" | "at"> & { at?: string },
): AuditEvent {
  const auditEvent: AuditEvent = {
    id: nextId(state, "AUD", 4),
    at: event.at ?? state.now,
    actorUserId: event.actorUserId,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId,
    summary: event.summary,
    changes: event.changes,
  };

  state.auditLog.push(auditEvent);

  return auditEvent;
}
