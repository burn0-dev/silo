/**
 * Cross-domain reporting.
 *
 * Deliberately small. Anything that is "list X filtered by Y" belongs on the
 * domain that owns X; these tools exist only where a genuine cross-entity
 * rollup is needed.
 */

import {
  availableQuantity,
  isOverdue,
  money,
  outstandingAmount,
  sumMoney,
} from "../state.js";
import {
  S,
  defineTool,
  pagingProperties,
  paginate,
  readOptionalString,
  schema,
} from "./contract.js";
import { budgetHeadroom } from "./helpers.js";

export const reportingTools = [
  defineTool({
    name: "get_procurement_spend_summary",
    description:
      "Procurement spend by vendor over a date range, based on invoices that are approved or paid, with the open commitment still on order.",
    inputSchema: schema({
      fromDate: S.string("ISO lower bound on invoice date."),
      toDate: S.string("ISO upper bound on invoice date."),
      ...pagingProperties,
    }),
    run(state, input) {
      const fromDate = readOptionalString(input, "fromDate") ?? "0000-01-01";
      const toDate = readOptionalString(input, "toDate") ?? "9999-12-31";

      const byVendor = new Map<string, { invoiced: number; paid: number; count: number }>();

      for (const invoice of Object.values(state.vendorInvoices)) {
        if (!["approved", "partially_paid", "paid"].includes(invoice.status)) continue;
        if (invoice.invoiceDate < fromDate || invoice.invoiceDate > toDate) continue;

        const entry = byVendor.get(invoice.vendorId) ?? { invoiced: 0, paid: 0, count: 0 };
        entry.invoiced += invoice.totalAmount.amount;
        entry.paid += invoice.amountPaid.amount;
        entry.count += 1;
        byVendor.set(invoice.vendorId, entry);
      }

      const openCommitment = new Map<string, number>();

      for (const order of Object.values(state.purchaseOrders)) {
        if (!["approved", "sent", "partially_received"].includes(order.status)) continue;
        openCommitment.set(
          order.vendorId,
          (openCommitment.get(order.vendorId) ?? 0) + order.totalAmount.amount,
        );
      }

      const rows = [...byVendor.entries()]
        .map(([vendorId, entry]) => ({
          vendorId,
          vendorName: state.vendors[vendorId]?.name ?? vendorId,
          invoiceCount: entry.count,
          invoiced: money(entry.invoiced, state.company.baseCurrency),
          paid: money(entry.paid, state.company.baseCurrency),
          outstanding: money(entry.invoiced - entry.paid, state.company.baseCurrency),
          openOnOrder: money(openCommitment.get(vendorId) ?? 0, state.company.baseCurrency),
        }))
        .sort((a, b) => b.invoiced.amount - a.invoiced.amount);

      return {
        fromDate,
        toDate,
        ...paginate(rows, input),
        totalInvoiced: sumMoney(rows.map((row) => row.invoiced), state.company.baseCurrency),
        totalPaid: sumMoney(rows.map((row) => row.paid), state.company.baseCurrency),
      };
    },
  }),

  defineTool({
    name: "get_ap_aging",
    description:
      "Accounts payable aging: what is owed to vendors, bucketed by how far past due it is.",
    inputSchema: schema({ vendorId: S.string("Limit to one vendor.") }),
    run(state, input) {
      const vendorId = readOptionalString(input, "vendorId");

      const totals = { current: 0, days1to30: 0, days31to60: 0, days61to90: 0, days90plus: 0 };
      const ids = {
        current: [] as string[],
        days1to30: [] as string[],
        days31to60: [] as string[],
        days61to90: [] as string[],
        days90plus: [] as string[],
      };

      for (const invoice of Object.values(state.vendorInvoices)) {
        if (["cancelled", "rejected", "paid", "draft"].includes(invoice.status)) continue;
        if (vendorId && invoice.vendorId !== vendorId) continue;

        const amount = outstandingAmount(invoice).amount;
        if (amount <= 0) continue;

        const overdueDays =
          invoice.dueDate < state.now
            ? Math.floor(
                (new Date(state.now).getTime() - new Date(invoice.dueDate).getTime()) / 86_400_000,
              )
            : 0;

        const bucket =
          overdueDays <= 0
            ? "current"
            : overdueDays <= 30
              ? "days1to30"
              : overdueDays <= 60
                ? "days31to60"
                : overdueDays <= 90
                  ? "days61to90"
                  : "days90plus";

        totals[bucket] += amount;
        ids[bucket].push(invoice.id);
      }

      const grandTotal = Object.values(totals).reduce((sum, value) => sum + value, 0);

      return {
        asOf: state.now,
        vendorId: vendorId ?? null,
        buckets: {
          current: { total: money(totals.current, state.company.baseCurrency), invoiceIds: ids.current },
          days1to30: { total: money(totals.days1to30, state.company.baseCurrency), invoiceIds: ids.days1to30 },
          days31to60: { total: money(totals.days31to60, state.company.baseCurrency), invoiceIds: ids.days31to60 },
          days61to90: { total: money(totals.days61to90, state.company.baseCurrency), invoiceIds: ids.days61to90 },
          days90plus: { total: money(totals.days90plus, state.company.baseCurrency), invoiceIds: ids.days90plus },
        },
        grandTotal: money(grandTotal, state.company.baseCurrency),
      };
    },
  }),

  defineTool({
    name: "get_inventory_valuation",
    description:
      "Stock value at standard cost, by warehouse or by category, with low-stock counts.",
    inputSchema: schema({
      groupBy: S.enumeration("How to group the valuation.", ["warehouse", "category"]),
    }),
    run(state, input) {
      const groupBy = readOptionalString(input, "groupBy") ?? "warehouse";

      const groups = new Map<string, { value: number; units: number; lowStock: number; skus: number }>();

      for (const record of Object.values(state.inventory)) {
        const product = state.products[record.productId];
        if (!product) continue;

        const key = groupBy === "category" ? product.category : record.warehouseId;
        const entry = groups.get(key) ?? { value: 0, units: 0, lowStock: 0, skus: 0 };

        entry.value += record.quantityOnHand * product.standardCost.amount;
        entry.units += record.quantityOnHand;
        entry.skus += 1;

        if (record.quantityOnHand < (record.reorderPoint ?? product.reorderPoint)) {
          entry.lowStock += 1;
        }

        groups.set(key, entry);
      }

      const rows = [...groups.entries()]
        .map(([key, entry]) => ({
          group: key,
          label:
            groupBy === "warehouse" ? (state.warehouses[key]?.name ?? key) : key,
          stockValue: money(entry.value, state.company.baseCurrency),
          unitsOnHand: entry.units,
          skuCount: entry.skus,
          lowStockCount: entry.lowStock,
        }))
        .sort((a, b) => b.stockValue.amount - a.stockValue.amount);

      return {
        groupBy,
        totalValue: sumMoney(rows.map((row) => row.stockValue), state.company.baseCurrency),
        groups: rows,
      };
    },
  }),

  defineTool({
    name: "get_sales_summary",
    description:
      "Sales by customer over a date range: ordered, shipped and invoiced value, plus what remains unshipped.",
    inputSchema: schema({
      fromDate: S.string("ISO lower bound on order date."),
      toDate: S.string("ISO upper bound on order date."),
      ...pagingProperties,
    }),
    run(state, input) {
      const fromDate = readOptionalString(input, "fromDate") ?? "0000-01-01";
      const toDate = readOptionalString(input, "toDate") ?? "9999-12-31";

      const byCustomer = new Map<string, { ordered: number; shipped: number; orders: number }>();

      for (const order of Object.values(state.salesOrders)) {
        if (order.status === "cancelled") continue;
        if (order.orderDate < fromDate || order.orderDate > toDate) continue;

        const entry = byCustomer.get(order.customerId) ?? { ordered: 0, shipped: 0, orders: 0 };
        entry.ordered += order.subtotal.amount;
        entry.shipped += order.lines.reduce(
          (total, line) => total + line.quantityFulfilled * line.unitPrice.amount,
          0,
        );
        entry.orders += 1;
        byCustomer.set(order.customerId, entry);
      }

      const invoiced = new Map<string, number>();

      for (const invoice of Object.values(state.customerInvoices)) {
        if (["cancelled", "draft"].includes(invoice.status)) continue;
        if (invoice.issueDate < fromDate || invoice.issueDate > toDate) continue;
        invoiced.set(
          invoice.customerId,
          (invoiced.get(invoice.customerId) ?? 0) + invoice.subtotal.amount,
        );
      }

      const rows = [...byCustomer.entries()]
        .map(([customerId, entry]) => ({
          customerId,
          customerName: state.customers[customerId]?.name ?? customerId,
          orderCount: entry.orders,
          orderedValue: money(entry.ordered, state.company.baseCurrency),
          shippedValue: money(entry.shipped, state.company.baseCurrency),
          invoicedValue: money(invoiced.get(customerId) ?? 0, state.company.baseCurrency),
          unshippedValue: money(entry.ordered - entry.shipped, state.company.baseCurrency),
        }))
        .sort((a, b) => b.orderedValue.amount - a.orderedValue.amount);

      return {
        fromDate,
        toDate,
        ...paginate(rows, input),
        totalOrdered: sumMoney(rows.map((row) => row.orderedValue), state.company.baseCurrency),
        totalShipped: sumMoney(rows.map((row) => row.shippedValue), state.company.baseCurrency),
      };
    },
  }),

  defineTool({
    name: "get_cash_position",
    description:
      "Near-term cash view: payables due, receivables expected, completed payments in and out, and the net position.",
    inputSchema: schema({
      withinDays: S.integer("Horizon in days (default 30).", { minimum: 0, maximum: 365 }),
    }),
    run(state, input) {
      const withinDays = typeof input["withinDays"] === "number" ? Number(input["withinDays"]) : 30;
      const horizonDate = new Date(state.now);
      horizonDate.setUTCDate(horizonDate.getUTCDate() + withinDays);
      const horizon = horizonDate.toISOString();

      const payablesDue = Object.values(state.vendorInvoices)
        .filter((invoice) => ["approved", "partially_paid"].includes(invoice.status))
        .filter((invoice) => invoice.dueDate <= horizon)
        .map((invoice) => outstandingAmount(invoice));

      const receivablesDue = Object.values(state.customerInvoices)
        .filter((invoice) => ["issued", "partially_paid"].includes(invoice.status))
        .filter((invoice) => invoice.dueDate <= horizon)
        .map((invoice) => outstandingAmount(invoice));

      const completed = Object.values(state.payments).filter(
        (payment) => payment.status === "completed",
      );

      const paidOut = completed
        .filter((payment) => payment.direction === "outbound")
        .map((payment) => payment.amount);

      const receivedIn = completed
        .filter((payment) => payment.direction === "inbound")
        .map((payment) => payment.amount);

      const payables = sumMoney(payablesDue, state.company.baseCurrency);
      const receivables = sumMoney(receivablesDue, state.company.baseCurrency);

      return {
        asOf: state.now,
        horizon,
        payablesDue: payables,
        receivablesDue: receivables,
        netPosition: money(receivables.amount - payables.amount, state.company.baseCurrency),
        paymentsCompletedOut: sumMoney(paidOut, state.company.baseCurrency),
        paymentsCompletedIn: sumMoney(receivedIn, state.company.baseCurrency),
        failedPaymentCount: Object.values(state.payments).filter((payment) => payment.status === "failed").length,
      };
    },
  }),

  defineTool({
    name: "get_operations_dashboard",
    description:
      "One-call health check across the business: blocked invoices, overdue documents, open discrepancies, low stock, unshipped orders and exhausted budgets. Good starting point when asked to find what needs attention.",
    inputSchema: schema({}),
    run(state) {
      const blockedInvoices = Object.values(state.vendorInvoices).filter((invoice) => {
        const match = invoice.matchId ? state.threeWayMatches[invoice.matchId] : null;
        return (
          (match?.status === "failed" || invoice.status === "disputed") &&
          !["paid", "cancelled", "rejected"].includes(invoice.status)
        );
      });

      const lowStock = Object.values(state.inventory).filter((record) => {
        const product = state.products[record.productId];
        return product !== undefined && record.quantityOnHand < (record.reorderPoint ?? product.reorderPoint);
      });

      const openDiscrepancies = Object.values(state.receivingDiscrepancies).filter(
        (discrepancy) => discrepancy.status === "open",
      );

      const unshipped = Object.values(state.salesOrders).filter(
        (order) =>
          (order.status === "confirmed" || order.status === "partially_fulfilled") &&
          order.lines.some((line) => line.quantityFulfilled < line.quantityOrdered),
      );

      const latePurchaseOrders = Object.values(state.purchaseOrders).filter(
        (order) =>
          (order.status === "sent" || order.status === "partially_received") &&
          order.expectedDeliveryDate < state.now,
      );

      return {
        asOf: state.now,
        blockedVendorInvoices: blockedInvoices.map((invoice) => ({
          id: invoice.id,
          status: invoice.status,
          vendorId: invoice.vendorId,
          amount: invoice.totalAmount,
        })),
        overdueVendorInvoices: Object.values(state.vendorInvoices)
          .filter((invoice) => isOverdue(invoice, state.now))
          .map((invoice) => invoice.id),
        overdueCustomerInvoices: Object.values(state.customerInvoices)
          .filter((invoice) => isOverdue(invoice, state.now))
          .map((invoice) => invoice.id),
        openReceivingDiscrepancies: openDiscrepancies.map((discrepancy) => ({
          id: discrepancy.id,
          type: discrepancy.type,
          purchaseOrderId: discrepancy.purchaseOrderId,
        })),
        lowStock: lowStock.map((record) => ({
          productId: record.productId,
          warehouseId: record.warehouseId,
          quantityOnHand: record.quantityOnHand,
          quantityAvailable: availableQuantity(record),
        })),
        latePurchaseOrders: latePurchaseOrders.map((order) => order.id),
        unshippedSalesOrders: unshipped.map((order) => order.id),
        pendingApprovals: Object.values(state.approvals)
          .filter((approval) => approval.status === "pending")
          .map((approval) => ({
            id: approval.id,
            entityType: approval.entityType,
            entityId: approval.entityId,
            assignedToUserId: approval.assignedToUserId,
          })),
        exhaustedBudgets: Object.values(state.budgets)
          .filter((budget) => budgetHeadroom(budget).amount <= 0)
          .map((budget) => budget.id),
      };
    },
  }),
];
