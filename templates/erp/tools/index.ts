import type { ErpTool } from "./contract.js";
import { approvalTools } from "./approvals.js";
import { auditTools } from "./audit.js";
import { budgetTools } from "./budgets.js";
import { clockTools } from "./clock.js";
import { customerInvoiceTools } from "./customer-invoices.js";
import { customerTools } from "./customers.js";
import { expenseTools } from "./expenses.js";
import { inventoryTools } from "./inventory.js";
import { paymentTools } from "./payments.js";
import { productTools } from "./products.js";
import { purchaseOrderTools } from "./purchase-orders.js";
import { quotationTools } from "./quotations.js";
import { receivingTools } from "./receiving.js";
import { reportingTools } from "./reporting.js";
import { requisitionTools } from "./requisitions.js";
import { rfqTools } from "./rfqs.js";
import { salesOrderTools } from "./sales-orders.js";
import { vendorInvoiceTools } from "./vendor-invoices.js";
import { vendorTools } from "./vendors.js";

export * from "./contract.js";
export * from "./helpers.js";

export {
  approvalTools,
  auditTools,
  budgetTools,
  clockTools,
  customerInvoiceTools,
  customerTools,
  expenseTools,
  inventoryTools,
  paymentTools,
  productTools,
  purchaseOrderTools,
  quotationTools,
  receivingTools,
  reportingTools,
  requisitionTools,
  rfqTools,
  salesOrderTools,
  vendorInvoiceTools,
  vendorTools,
};

export const erpTools: ErpTool[] = [
  ...clockTools,
  ...vendorTools,
  ...customerTools,
  ...productTools,
  ...inventoryTools,
  ...requisitionTools,
  ...approvalTools,
  ...rfqTools,
  ...quotationTools,
  ...purchaseOrderTools,
  ...receivingTools,
  ...vendorInvoiceTools,
  ...paymentTools,
  ...salesOrderTools,
  ...customerInvoiceTools,
  ...expenseTools,
  ...budgetTools,
  ...reportingTools,
  ...auditTools,
];

export function getTool(name: string): ErpTool | undefined {
  return erpTools.find((tool) => tool.name === name);
}

export const toolsByDomain: Record<string, ErpTool[]> = {
  clock: clockTools,
  vendors: vendorTools,
  customers: customerTools,
  products: productTools,
  inventory: inventoryTools,
  requisitions: requisitionTools,
  approvals: approvalTools,
  rfqs: rfqTools,
  quotations: quotationTools,
  purchaseOrders: purchaseOrderTools,
  receiving: receivingTools,
  vendorInvoices: vendorInvoiceTools,
  payments: paymentTools,
  salesOrders: salesOrderTools,
  customerInvoices: customerInvoiceTools,
  expenses: expenseTools,
  budgets: budgetTools,
  reporting: reportingTools,
  audit: auditTools,
};
