/**
 * Builds the ERP world each rollout starts from.
 *
 * `data/` holds facts: ids, quantities, unit prices, statuses, dates. Every
 * money total is derived here instead of being stored, so editing a quantity
 * in a dataset cannot leave a stale line total behind.
 *
 * Node caches imported JSON modules for the life of the process, so the
 * assembled world is cloned before it is handed to a rollout.
 */

import {
  type Approval,
  type AuditEvent,
  type Budget,
  type Company,
  type Customer,
  type CustomerInvoice,
  type Department,
  type State,
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
  indexById,
  money,
} from "./state.js";

import approvalsData from "./data/approvals.json" with { type: "json" };
import auditLogData from "./data/auditLog.json" with { type: "json" };
import budgetsData from "./data/budgets.json" with { type: "json" };
import companyData from "./data/company.json" with { type: "json" };
import customerInvoiceSpecs from "./data/customerInvoices.json" with { type: "json" };
import customersData from "./data/customers.json" with { type: "json" };
import departmentsData from "./data/departments.json" with { type: "json" };
import expensesData from "./data/expenses.json" with { type: "json" };
import fulfillmentsData from "./data/fulfillments.json" with { type: "json" };
import goodsReceiptsData from "./data/goodsReceipts.json" with { type: "json" };
import inventoryData from "./data/inventory.json" with { type: "json" };
import inventoryMovementsData from "./data/inventoryMovements.json" with { type: "json" };
import paymentsData from "./data/payments.json" with { type: "json" };
import productsData from "./data/products.json" with { type: "json" };
import purchaseOrderSpecs from "./data/purchaseOrders.json" with { type: "json" };
import quotationSpecs from "./data/quotations.json" with { type: "json" };
import receivingDiscrepanciesData from "./data/receivingDiscrepancies.json" with { type: "json" };
import requisitionsData from "./data/requisitions.json" with { type: "json" };
import rfqsData from "./data/rfqs.json" with { type: "json" };
import salesOrderSpecs from "./data/salesOrders.json" with { type: "json" };
import sequencesData from "./data/sequences.json" with { type: "json" };
import threeWayMatchesData from "./data/threeWayMatches.json" with { type: "json" };
import usersData from "./data/users.json" with { type: "json" };
import vendorInvoiceSpecs from "./data/vendorInvoices.json" with { type: "json" };
import vendorsData from "./data/vendors.json" with { type: "json" };
import warehousesData from "./data/warehouses.json" with { type: "json" };

/** The instant the simulated world is frozen at. */
export const SIMULATION_NOW = "2026-03-16T09:00:00.000Z";

/** Sales tax applied to order and invoice subtotals. */
export const TAX_RATE = 0.08;

const usd = (amount: number): Money => money(amount, "USD");

// --- derivation -------------------------------------------------------------
// Line totals, subtotals and tax come from the figures in `data/`, never from
// a stored copy of the answer.

type QuotationSpec = {
  id: string;
  rfqId: string;
  vendorId: string;
  status: Quotation["status"];
  lines: Array<[productId: string, quantity: number, unitPrice: number]>;
  leadTimeDays: number;
  validUntil: string;
  receivedAt: string;
  notes: string;
};

type PurchaseOrderLineSpec = {
  productId: string;
  description: string;
  ordered: number;
  unitPrice: number;
  expectedDate: string;
  received?: number;
  rejected?: number;
  invoiced?: number;
};

type PurchaseOrderSpec = {
  id: string;
  vendorId: string;
  status: PurchaseOrder["status"];
  warehouseId: string;
  lines: PurchaseOrderLineSpec[];
  paymentTerms: PurchaseOrder["paymentTerms"];
  createdByUserId: string;
  createdAt: string;
  expectedDeliveryDate: string;
  requisitionId?: string;
  quotationId?: string;
  budgetId?: string;
  approvalId?: string;
  approvedAt?: string;
  approvedByUserId?: string;
  sentAt?: string;
  closedAt?: string;
  cancelledAt?: string;
  cancelReason?: string;
};

type VendorInvoiceSpec = {
  id: string;
  vendorInvoiceNumber: string;
  vendorId: string;
  status: VendorInvoice["status"];
  lines: Array<{
    purchaseOrderLineId: string | null;
    productId: string | null;
    description: string;
    quantity: number;
    unitPrice: number;
  }>;
  invoiceDate: string;
  dueDate: string;
  receivedAt: string;
  amountPaid?: number;
  purchaseOrderId?: string;
  goodsReceiptIds?: string[];
  matchId?: string;
  approvalId?: string;
  approvedAt?: string;
  approvedByUserId?: string;
  disputeReason?: string;
  paidAt?: string;
};

type SalesOrderSpec = {
  id: string;
  customerId: string;
  status: SalesOrder["status"];
  lines: Array<{
    productId: string;
    ordered: number;
    unitPrice: number;
    warehouseId: string;
    reserved?: number;
    fulfilled?: number;
  }>;
  customerPoNumber: string;
  orderDate: string;
  requestedDeliveryDate: string;
  createdByUserId: string;
  confirmedAt?: string;
  cancelledAt?: string;
  cancelReason?: string;
  closedAt?: string;
};

type CustomerInvoiceSpec = {
  id: string;
  customerId: string;
  status: CustomerInvoice["status"];
  lines: Array<{
    salesOrderLineId: string | null;
    productId: string;
    description: string;
    quantity: number;
    unitPrice: number;
  }>;
  issueDate: string;
  dueDate: string;
  amountPaid?: number;
  salesOrderId?: string;
  fulfillmentIds?: string[];
  paidAt?: string;
};

function quotation(spec: QuotationSpec): Quotation {
  const { id, rfqId, vendorId, status, lines, leadTimeDays, validUntil, receivedAt, notes } = spec;

  const quotationLines = lines.map(([productId, quantity, unitPrice], index) => ({
    id: `${id}-L${index + 1}`,
    productId,
    quantity,
    unitPrice: usd(unitPrice),
    lineTotal: usd(quantity * unitPrice),
  }));

  const subtotal = usd(
    quotationLines.reduce((total, line) => total + line.lineTotal.amount, 0),
  );

  return {
    id,
    number: id,
    rfqId,
    vendorId,
    status,
    lines: quotationLines,
    subtotal,
    totalAmount: subtotal,
    leadTimeDays,
    validUntil,
    receivedAt,
    notes,
  };
}

function purchaseOrder(spec: PurchaseOrderSpec): PurchaseOrder {
  const lines = spec.lines.map((line, index) => ({
    id: `${spec.id}-L${index + 1}`,
    productId: line.productId,
    description: line.description,
    quantityOrdered: line.ordered,
    quantityReceived: line.received ?? 0,
    quantityRejected: line.rejected ?? 0,
    quantityInvoiced: line.invoiced ?? 0,
    unitPrice: usd(line.unitPrice),
    lineTotal: usd(line.ordered * line.unitPrice),
    expectedDate: line.expectedDate,
  }));

  const subtotal = usd(lines.reduce((total, line) => total + line.lineTotal.amount, 0));
  const taxAmount = usd(subtotal.amount * TAX_RATE);

  return {
    id: spec.id,
    number: spec.id,
    vendorId: spec.vendorId,
    status: spec.status,
    lines,
    warehouseId: spec.warehouseId,
    currency: "USD",
    subtotal,
    taxAmount,
    totalAmount: usd(subtotal.amount + taxAmount.amount),
    requisitionId: spec.requisitionId ?? null,
    quotationId: spec.quotationId ?? null,
    budgetId: spec.budgetId ?? null,
    paymentTerms: spec.paymentTerms,
    createdByUserId: spec.createdByUserId,
    createdAt: spec.createdAt,
    approvalId: spec.approvalId ?? null,
    approvedAt: spec.approvedAt ?? null,
    approvedByUserId: spec.approvedByUserId ?? null,
    sentAt: spec.sentAt ?? null,
    expectedDeliveryDate: spec.expectedDeliveryDate,
    closedAt: spec.closedAt ?? null,
    cancelledAt: spec.cancelledAt ?? null,
    cancelReason: spec.cancelReason ?? null,
  };
}

function vendorInvoice(spec: VendorInvoiceSpec): VendorInvoice {
  const lines = spec.lines.map((line, index) => ({
    id: `${spec.id}-L${index + 1}`,
    purchaseOrderLineId: line.purchaseOrderLineId,
    productId: line.productId,
    description: line.description,
    quantity: line.quantity,
    unitPrice: usd(line.unitPrice),
    lineTotal: usd(line.quantity * line.unitPrice),
  }));

  const subtotal = usd(lines.reduce((total, line) => total + line.lineTotal.amount, 0));
  const taxAmount = usd(subtotal.amount * TAX_RATE);

  return {
    id: spec.id,
    number: spec.id,
    vendorInvoiceNumber: spec.vendorInvoiceNumber,
    vendorId: spec.vendorId,
    purchaseOrderId: spec.purchaseOrderId ?? null,
    goodsReceiptIds: spec.goodsReceiptIds ?? [],
    status: spec.status,
    lines,
    subtotal,
    taxAmount,
    totalAmount: usd(subtotal.amount + taxAmount.amount),
    amountPaid: usd(spec.amountPaid ?? 0),
    invoiceDate: spec.invoiceDate,
    dueDate: spec.dueDate,
    receivedAt: spec.receivedAt,
    matchId: spec.matchId ?? null,
    approvalId: spec.approvalId ?? null,
    approvedAt: spec.approvedAt ?? null,
    approvedByUserId: spec.approvedByUserId ?? null,
    disputeReason: spec.disputeReason ?? null,
    paidAt: spec.paidAt ?? null,
  };
}

function salesOrder(spec: SalesOrderSpec): SalesOrder {
  const lines = spec.lines.map((line, index) => ({
    id: `${spec.id}-L${index + 1}`,
    productId: line.productId,
    quantityOrdered: line.ordered,
    quantityReserved: line.reserved ?? 0,
    quantityFulfilled: line.fulfilled ?? 0,
    unitPrice: usd(line.unitPrice),
    lineTotal: usd(line.ordered * line.unitPrice),
    warehouseId: line.warehouseId,
  }));

  const subtotal = usd(lines.reduce((total, line) => total + line.lineTotal.amount, 0));
  const taxAmount = usd(subtotal.amount * TAX_RATE);

  return {
    id: spec.id,
    number: spec.id,
    customerId: spec.customerId,
    status: spec.status,
    lines,
    currency: "USD",
    subtotal,
    taxAmount,
    totalAmount: usd(subtotal.amount + taxAmount.amount),
    customerPoNumber: spec.customerPoNumber,
    orderDate: spec.orderDate,
    requestedDeliveryDate: spec.requestedDeliveryDate,
    createdByUserId: spec.createdByUserId,
    confirmedAt: spec.confirmedAt ?? null,
    cancelledAt: spec.cancelledAt ?? null,
    cancelReason: spec.cancelReason ?? null,
    closedAt: spec.closedAt ?? null,
  };
}

function customerInvoice(spec: CustomerInvoiceSpec): CustomerInvoice {
  const lines = spec.lines.map((line, index) => ({
    id: `${spec.id}-L${index + 1}`,
    salesOrderLineId: line.salesOrderLineId,
    productId: line.productId,
    description: line.description,
    quantity: line.quantity,
    unitPrice: usd(line.unitPrice),
    lineTotal: usd(line.quantity * line.unitPrice),
  }));

  const subtotal = usd(lines.reduce((total, line) => total + line.lineTotal.amount, 0));
  const taxAmount = usd(subtotal.amount * TAX_RATE);

  return {
    id: spec.id,
    number: spec.id,
    customerId: spec.customerId,
    salesOrderId: spec.salesOrderId ?? null,
    fulfillmentIds: spec.fulfillmentIds ?? [],
    status: spec.status,
    lines,
    subtotal,
    taxAmount,
    totalAmount: usd(subtotal.amount + taxAmount.amount),
    amountPaid: usd(spec.amountPaid ?? 0),
    issueDate: spec.issueDate,
    dueDate: spec.dueDate,
    paidAt: spec.paidAt ?? null,
  };
}

// --- assembly ---------------------------------------------------------------

export function createState(): State {
  return structuredClone({
    now: SIMULATION_NOW,
    company: companyData as Company,
    departments: indexById(departmentsData as Department[]),
    users: indexById(usersData as User[]),
    vendors: indexById(vendorsData as Vendor[]),
    customers: indexById(customersData as Customer[]),
    products: indexById(productsData as Product[]),
    warehouses: indexById(warehousesData as Warehouse[]),
    inventory: indexById(inventoryData as InventoryRecord[]),
    inventoryMovements: indexById(inventoryMovementsData as InventoryMovement[]),
    requisitions: indexById(requisitionsData as PurchaseRequisition[]),
    approvals: indexById(approvalsData as Approval[]),
    rfqs: indexById(rfqsData as Rfq[]),
    quotations: indexById((quotationSpecs as QuotationSpec[]).map(quotation)),
    purchaseOrders: indexById((purchaseOrderSpecs as PurchaseOrderSpec[]).map(purchaseOrder)),
    goodsReceipts: indexById(goodsReceiptsData as GoodsReceipt[]),
    receivingDiscrepancies: indexById(receivingDiscrepanciesData as ReceivingDiscrepancy[]),
    vendorInvoices: indexById((vendorInvoiceSpecs as VendorInvoiceSpec[]).map(vendorInvoice)),
    threeWayMatches: indexById(threeWayMatchesData as ThreeWayMatch[]),
    payments: indexById(paymentsData as Payment[]),
    salesOrders: indexById((salesOrderSpecs as SalesOrderSpec[]).map(salesOrder)),
    fulfillments: indexById(fulfillmentsData as Fulfillment[]),
    customerInvoices: indexById((customerInvoiceSpecs as CustomerInvoiceSpec[]).map(customerInvoice)),
    expenses: indexById(expensesData as Expense[]),
    budgets: indexById(budgetsData as Budget[]),
    auditLog: auditLogData as AuditEvent[],
    sequences: sequencesData as Record<string, number>,
  });
}
