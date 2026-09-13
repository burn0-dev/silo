/**
 * Deterministic verifiers.
 *
 * Each verifier inspects the final simulated world and, where a delta matters,
 * compares it against the initial state. None of them look at what the agent
 * said — a task passes only because the ERP ends up in the right shape.
 */

import {
  type ErpState,
  availableQuantity,
  inventoryId,
  isOverdue,
  outstandingAmount,
  round2,
} from "../state.js";

export type VerifierCheck = {
  label: string;
  passed: boolean;
  detail: string;
  /**
   * Required checks define success: if one fails the task fails outright,
   * however much else went right. Optional checks only move the reward.
   */
  required: boolean;
};

export type VerifierOutcome = {
  verifierId: string;
  taskId: string;
  /** True only when every required check passed. */
  passed: boolean;
  /** Partial progress across all checks, 0-1. Independent of `passed`. */
  reward: number;
  requiredPassed: number;
  requiredTotal: number;
  failedRequired: string[];
  checks: VerifierCheck[];
};

export type ErpVerifier = {
  id: string;
  taskId: string;
  name: string;
  check: (finalState: ErpState, initialState: ErpState) => VerifierOutcome;
};

/** A check that defines success. Failing one fails the task. */
function check(label: string, passed: boolean, detail = ""): VerifierCheck {
  return { label, passed, detail, required: true };
}

/** Corroborating evidence: contributes to reward but cannot fail the task alone. */
function optional(label: string, passed: boolean, detail = ""): VerifierCheck {
  return { label, passed, detail, required: false };
}

function outcome(
  verifierId: string,
  taskId: string,
  checks: VerifierCheck[],
): VerifierOutcome {
  const passedCount = checks.filter((entry) => entry.passed).length;
  const required = checks.filter((entry) => entry.required);
  const failedRequired = required.filter((entry) => !entry.passed);

  if (required.length === 0) {
    throw new Error(
      `${verifierId} has no required checks; a task cannot be graded on optional evidence alone.`,
    );
  }

  return {
    verifierId,
    taskId,
    passed: failedRequired.length === 0,
    reward: checks.length === 0 ? 0 : round2(passedCount / checks.length),
    requiredPassed: required.length - failedRequired.length,
    requiredTotal: required.length,
    failedRequired: failedRequired.map((entry) => entry.label),
    checks,
  };
}

function stockOnHand(state: ErpState, productId: string, warehouseId: string): number {
  return state.inventory[inventoryId(productId, warehouseId)]?.quantityOnHand ?? 0;
}

function completedPaymentsFor(state: ErpState, invoiceId: string): number {
  return round2(
    Object.values(state.payments)
      .filter((payment) => payment.status === "completed")
      .flatMap((payment) => payment.allocations)
      .filter((allocation) => allocation.invoiceId === invoiceId)
      .reduce((total, allocation) => total + allocation.amount.amount, 0),
  );
}

function latestMatchFor(state: ErpState, invoiceId: string) {
  return Object.values(state.threeWayMatches)
    .filter((match) => match.vendorInvoiceId === invoiceId)
    .sort((a, b) => a.id.localeCompare(b.id))
    .at(-1);
}

function newIds(final: ErpState, initial: ErpState, collection: keyof ErpState): string[] {
  const before = new Set(Object.keys(initial[collection] as Record<string, unknown>));

  return Object.keys(final[collection] as Record<string, unknown>).filter(
    (id) => !before.has(id),
  );
}

export const erpVerifiers: ErpVerifier[] = [
  {
    id: "VER-001",
    taskId: "TASK-001",
    name: "Vendor payment terms updated",
    check(final) {
      const vendor = final.vendors["VEN-002"];

      return outcome("VER-001", "TASK-001", [
        check(
          "VEN-002 is on NET_30",
          vendor?.paymentTerms === "NET_30",
          `paymentTerms = ${vendor?.paymentTerms}`,
        ),
        optional(
          "Vendor is still active",
          vendor?.status === "active",
          `status = ${vendor?.status}`,
        ),
      ]);
    },
  },

  {
    id: "VER-002",
    taskId: "TASK-002",
    name: "Vendor blocked with a reason",
    check(final) {
      const vendor = final.vendors["VEN-007"];

      return outcome("VER-002", "TASK-002", [
        check("VEN-007 is blocked", vendor?.status === "blocked", `status = ${vendor?.status}`),
        check(
          "A block reason was recorded",
          typeof vendor?.statusReason === "string" && vendor.statusReason.trim().length > 0,
          `statusReason = ${vendor?.statusReason ?? "null"}`,
        ),
      ]);
    },
  },

  {
    id: "VER-003",
    taskId: "TASK-003",
    name: "Largest overdue debtor placed on credit hold",
    check(final, initial) {
      const customer = final.customers["CUS-003"];

      const overdueAbove10k = Object.values(initial.customerInvoices).filter(
        (invoice) => isOverdue(invoice, initial.now) && invoice.totalAmount.amount > 10_000,
      );

      const untouched = overdueAbove10k.every(
        (invoice) => final.customerInvoices[invoice.id]?.status !== "written_off",
      );

      return outcome("VER-003", "TASK-003", [
        check(
          "CUS-003 (largest overdue balance) is on credit hold",
          customer?.status === "credit_hold",
          `status = ${customer?.status}`,
        ),
        optional(
          "A reason was recorded",
          typeof customer?.statusReason === "string" && customer.statusReason.trim().length > 0,
          `statusReason = ${customer?.statusReason ?? "null"}`,
        ),
        check(
          "No overdue invoice was written off",
          untouched,
          `${overdueAbove10k.length} invoice(s) above $10k checked`,
        ),
      ]);
    },
  },

  {
    id: "VER-004",
    taskId: "TASK-004",
    name: "Shortage escalated as a requisition, stock untouched",
    check(final, initial) {
      const created = newIds(final, initial, "requisitions")
        .map((id) => final.requisitions[id])
        .filter((requisition) => requisition !== undefined);

      const match = created.find((requisition) =>
        requisition.lines.some((line) => line.productId === "PRD-012"),
      );

      const product = final.products["PRD-012"];
      const line = match?.lines.find((candidate) => candidate.productId === "PRD-012");

      return outcome("VER-004", "TASK-004", [
        check(
          "A requisition was raised for PRD-012",
          match !== undefined,
          match ? `requisition ${match.id}` : "no new requisition found",
        ),
        check(
          "It requests the product's reorder quantity",
          line?.quantity === product?.reorderQuantity,
          `quantity = ${line?.quantity}, reorderQuantity = ${product?.reorderQuantity}`,
        ),
        check(
          "It is charged to BUD-002 for DEPT-OPS",
          match?.budgetId === "BUD-002" && match?.departmentId === "DEPT-OPS",
          `budgetId = ${match?.budgetId}, departmentId = ${match?.departmentId}`,
        ),
        check(
          "Stock was not altered to hide the shortage",
          stockOnHand(final, "PRD-012", "WH-001") === stockOnHand(initial, "PRD-012", "WH-001"),
          `on hand = ${stockOnHand(final, "PRD-012", "WH-001")}`,
        ),
      ]);
    },
  },

  {
    id: "VER-005",
    taskId: "TASK-005",
    name: "Requisition rejected because the budget cannot cover it",
    check(final, initial) {
      const requisition = final.requisitions["PR-002"];
      const approval = final.approvals["APR-002"];
      const budget = final.budgets["BUD-004"];
      const initialBudget = initial.budgets["BUD-004"];

      return outcome("VER-005", "TASK-005", [
        check(
          "PR-002 was rejected, not approved",
          requisition?.status === "rejected",
          `status = ${requisition?.status}`,
        ),
        optional(
          "The approval records the rejection",
          approval?.status === "rejected" && approval.decidedByUserId === "USR-003",
          `approval = ${approval?.status}, by ${approval?.decidedByUserId}`,
        ),
        optional(
          "A reason was captured",
          (approval?.notes.length ?? 0) > 0,
          `${approval?.notes.length ?? 0} note(s)`,
        ),
        check(
          "No budget was committed",
          budget?.committedAmount.amount === initialBudget?.committedAmount.amount,
          `committed = ${budget?.committedAmount.amount}`,
        ),
      ]);
    },
  },

  {
    id: "VER-006",
    taskId: "TASK-006",
    name: "Stock rebalanced above the reorder point",
    check(final, initial) {
      const record = final.inventory[inventoryId("PRD-010", "WH-002")];
      const product = final.products["PRD-010"];
      const reorderPoint = record?.reorderPoint ?? product?.reorderPoint ?? 0;

      const sourceBefore = stockOnHand(initial, "PRD-010", "WH-001");
      const sourceAfter = stockOnHand(final, "PRD-010", "WH-001");
      const destBefore = stockOnHand(initial, "PRD-010", "WH-002");
      const destAfter = stockOnHand(final, "PRD-010", "WH-002");

      return outcome("VER-006", "TASK-006", [
        check(
          "Warehouse South received 200 units",
          destAfter === destBefore + 200,
          `${destBefore} -> ${destAfter}`,
        ),
        check(
          "Warehouse North gave up 200 units",
          sourceAfter === sourceBefore - 200,
          `${sourceBefore} -> ${sourceAfter}`,
        ),
        check(
          "Warehouse South is back above its reorder point",
          destAfter >= reorderPoint,
          `on hand ${destAfter} vs reorder point ${reorderPoint}`,
        ),
        optional(
          "Movements were recorded for the transfer",
          Object.values(final.inventoryMovements).some(
            (movement) =>
              movement.productId === "PRD-010" &&
              (movement.type === "transfer_in" || movement.type === "transfer_out") &&
              movement.occurredAt >= initial.now,
          ),
          "transfer movements present",
        ),
      ]);
    },
  },

  {
    id: "VER-007",
    taskId: "TASK-007",
    name: "Outstanding delivery received and order completed",
    check(final, initial) {
      const order = final.purchaseOrders["PO-202"];
      const line = order?.lines.find((candidate) => candidate.id === "PO-202-L1");
      const record = final.inventory[inventoryId("PRD-007", "WH-001")];

      return outcome("VER-007", "TASK-007", [
        check(
          "All 40 cylinders are now received",
          line?.quantityReceived === 40,
          `quantityReceived = ${line?.quantityReceived}`,
        ),
        check(
          "PO-202 is fully received",
          order?.status === "received",
          `status = ${order?.status}`,
        ),
        check(
          "Stock at Warehouse North rose by 15",
          stockOnHand(final, "PRD-007", "WH-001") === stockOnHand(initial, "PRD-007", "WH-001") + 15,
          `${stockOnHand(initial, "PRD-007", "WH-001")} -> ${stockOnHand(final, "PRD-007", "WH-001")}`,
        ),
        optional(
          "Nothing is still inbound for that line",
          record?.quantityInbound === 0,
          `inbound = ${record?.quantityInbound}`,
        ),
      ]);
    },
  },

  {
    id: "VER-008",
    taskId: "TASK-008",
    name: "Invoice due this week paid in full",
    check(final) {
      const invoice = final.vendorInvoices["VINV-107"];
      const paid = completedPaymentsFor(final, "VINV-107");

      return outcome("VER-008", "TASK-008", [
        check("VINV-107 is paid", invoice?.status === "paid", `status = ${invoice?.status}`),
        check(
          "The full amount was paid",
          invoice !== undefined && round2(invoice.amountPaid.amount) === round2(invoice.totalAmount.amount),
          `paid ${invoice?.amountPaid.amount} of ${invoice?.totalAmount.amount}`,
        ),
        check(
          "A completed payment covers it",
          invoice !== undefined && paid === round2(invoice.totalAmount.amount),
          `completed payments = ${paid}`,
        ),
        optional(
          "Nothing remains outstanding",
          invoice !== undefined && outstandingAmount(invoice).amount === 0,
          `outstanding = ${invoice ? outstandingAmount(invoice).amount : "n/a"}`,
        ),
      ]);
    },
  },

  {
    id: "VER-009",
    taskId: "TASK-009",
    name: "Unapproved purchase order cancelled",
    check(final, initial) {
      const order = final.purchaseOrders["PO-205"];
      const approval = final.approvals["APR-010"];
      const budget = final.budgets["BUD-001"];
      const initialBudget = initial.budgets["BUD-001"];

      return outcome("VER-009", "TASK-009", [
        check("PO-205 is cancelled", order?.status === "cancelled", `status = ${order?.status}`),
        check(
          "A cancellation reason was recorded",
          typeof order?.cancelReason === "string" && order.cancelReason.trim().length > 0,
          `reason = ${order?.cancelReason ?? "null"}`,
        ),
        optional(
          "Its pending approval is no longer outstanding",
          approval?.status !== "pending",
          `approval = ${approval?.status}`,
        ),
        optional(
          "No budget was left committed for it",
          budget?.committedAmount.amount === initialBudget?.committedAmount.amount,
          `committed = ${budget?.committedAmount.amount}`,
        ),
      ]);
    },
  },

  {
    id: "VER-010",
    taskId: "TASK-010",
    name: "Shipped order invoiced",
    check(final, initial) {
      const created = newIds(final, initial, "customerInvoices")
        .map((id) => final.customerInvoices[id])
        .filter((invoice) => invoice !== undefined);

      const invoice = created.find((candidate) => candidate.salesOrderId === "SO-306");
      const order = final.salesOrders["SO-306"];
      const line = invoice?.lines[0];

      return outcome("VER-010", "TASK-010", [
        check(
          "An invoice was raised against SO-306",
          invoice !== undefined,
          invoice ? `invoice ${invoice.id}` : "none found",
        ),
        check(
          "It bills the 120 units that shipped",
          line?.quantity === 120,
          `quantity = ${line?.quantity}`,
        ),
        check(
          "The invoice was issued, not left in draft",
          invoice?.status === "issued" || invoice?.status === "paid" || invoice?.status === "partially_paid",
          `status = ${invoice?.status}`,
        ),
        optional(
          "Invoice value matches what shipped",
          invoice !== undefined && round2(invoice.subtotal.amount) === 5040,
          `subtotal = ${invoice?.subtotal.amount}`,
        ),
        optional(
          "SO-306 is marked invoiced",
          order?.status === "invoiced",
          `status = ${order?.status}`,
        ),
      ]);
    },
  },

  {
    id: "VER-011",
    taskId: "TASK-011",
    name: "Cheapest valid quotation awarded and order raised",
    check(final, initial) {
      const rfq = final.rfqs["RFQ-002"];
      const winner = final.quotations["QUO-006"];
      const cheapestButExpired = final.quotations["QUO-005"];

      const created = newIds(final, initial, "purchaseOrders")
        .map((id) => final.purchaseOrders[id])
        .filter((order) => order !== undefined);

      const order = created.find((candidate) => candidate.vendorId === "VEN-012");

      const hoseLine = order?.lines.find((line) => line.productId === "PRD-008");
      const beltLine = order?.lines.find((line) => line.productId === "PRD-010");

      return outcome("VER-011", "TASK-011", [
        check(
          "RFQ-002 was awarded to QUO-006",
          rfq?.awardedQuotationId === "QUO-006" && winner?.status === "accepted",
          `awarded = ${rfq?.awardedQuotationId}, QUO-006 = ${winner?.status}`,
        ),
        check(
          "The expired cheaper quotation was not awarded",
          cheapestButExpired?.status !== "accepted",
          `QUO-005 = ${cheapestButExpired?.status}`,
        ),
        check(
          "A purchase order was raised on VEN-012",
          order !== undefined,
          order ? `order ${order.id}` : "none found",
        ),
        check(
          "It carries the quoted quantities and prices",
          hoseLine?.quantityOrdered === 600 &&
            hoseLine.unitPrice.amount === 6.55 &&
            beltLine?.quantityOrdered === 500 &&
            beltLine.unitPrice.amount === 6.8,
          `hose ${hoseLine?.quantityOrdered} @ ${hoseLine?.unitPrice.amount}, belt ${beltLine?.quantityOrdered} @ ${beltLine?.unitPrice.amount}`,
        ),
        check(
          "It is approved but not yet sent",
          order?.status === "approved" && order.sentAt === null,
          `status = ${order?.status}, sentAt = ${order?.sentAt}`,
        ),
        optional(
          "It delivers to WH-001 against BUD-002",
          order?.warehouseId === "WH-001" && order.budgetId === "BUD-002",
          `warehouse = ${order?.warehouseId}, budget = ${order?.budgetId}`,
        ),
      ]);
    },
  },

  {
    id: "VER-012",
    taskId: "TASK-012",
    name: "Quantity mismatch corrected and invoice approved",
    check(final) {
      const invoice = final.vendorInvoices["VINV-104"];
      const line = invoice?.lines.find((candidate) => candidate.productId === "PRD-004");
      const order = final.purchaseOrders["PO-203"];
      const orderLine = order?.lines.find((candidate) => candidate.id === "PO-203-L1");
      const match = latestMatchFor(final, "VINV-104");

      return outcome("VER-012", "TASK-012", [
        check(
          "The bolt line now bills the 250 boxes received",
          line?.quantity === 250,
          `quantity = ${line?.quantity}`,
        ),
        optional(
          "Invoice totals were recalculated",
          invoice !== undefined && round2(invoice.subtotal.amount) === 5655,
          `subtotal = ${invoice?.subtotal.amount} (expected 5655)`,
        ),
        check(
          "The purchase order no longer shows over-invoicing",
          orderLine !== undefined && orderLine.quantityInvoiced <= orderLine.quantityReceived,
          `invoiced ${orderLine?.quantityInvoiced} vs received ${orderLine?.quantityReceived}`,
        ),
        check(
          "The latest three-way match passes",
          match?.status === "matched",
          `match ${match?.id} = ${match?.status}`,
        ),
        check(
          "The invoice is approved",
          invoice?.status === "approved" || invoice?.status === "paid",
          `status = ${invoice?.status}`,
        ),
      ]);
    },
  },

  {
    id: "VER-013",
    taskId: "TASK-013",
    name: "Price mismatch corrected to the agreed rate",
    check(final) {
      const invoice = final.vendorInvoices["VINV-103"];
      const line = invoice?.lines[0];
      const match = latestMatchFor(final, "VINV-103");

      return outcome("VER-013", "TASK-013", [
        check(
          "The line is priced at the agreed $82.00",
          line?.unitPrice.amount === 82,
          `unitPrice = ${line?.unitPrice.amount}`,
        ),
        check(
          "The quantity was left at 80 drums",
          line?.quantity === 80,
          `quantity = ${line?.quantity}`,
        ),
        optional(
          "Invoice total was recalculated to 7084.80",
          invoice !== undefined && round2(invoice.totalAmount.amount) === 7084.8,
          `total = ${invoice?.totalAmount.amount}`,
        ),
        check(
          "The latest three-way match passes",
          match?.status === "matched",
          `match ${match?.id} = ${match?.status}`,
        ),
        check(
          "The invoice is approved",
          invoice?.status === "approved" || invoice?.status === "paid",
          `status = ${invoice?.status}`,
        ),
      ]);
    },
  },

  {
    id: "VER-014",
    taskId: "TASK-014",
    name: "Order filled from multiple warehouses",
    check(final, initial) {
      const order = final.salesOrders["SO-307"];
      const line = order?.lines[0];

      const shipments = Object.values(final.fulfillments).filter(
        (fulfillment) => fulfillment.salesOrderId === "SO-307" && fulfillment.status !== "cancelled",
      );

      const shippedUnits = shipments
        .flatMap((fulfillment) => fulfillment.lines)
        .reduce((total, shipmentLine) => total + shipmentLine.quantity, 0);

      const northDrop = stockOnHand(initial, "PRD-003", "WH-001") - stockOnHand(final, "PRD-003", "WH-001");
      const southDrop = stockOnHand(initial, "PRD-003", "WH-002") - stockOnHand(final, "PRD-003", "WH-002");

      const transferred = Object.values(final.inventoryMovements).some(
        (movement) =>
          movement.productId === "PRD-003" &&
          (movement.type === "transfer_in" || movement.type === "transfer_out") &&
          movement.occurredAt >= initial.now,
      );

      return outcome("VER-014", "TASK-014", [
        check(
          "All 150 units shipped",
          line?.quantityFulfilled === 150 && shippedUnits === 150,
          `line fulfilled = ${line?.quantityFulfilled}, shipment units = ${shippedUnits}`,
        ),
        optional(
          "SO-307 is fulfilled",
          order?.status === "fulfilled" || order?.status === "invoiced" || order?.status === "closed",
          `status = ${order?.status}`,
        ),
        check(
          "Stock came out of both warehouses",
          northDrop > 0 && southDrop > 0,
          `WH-001 -${northDrop}, WH-002 -${southDrop}`,
        ),
        optional(
          "The totals add up to 150 units",
          northDrop + southDrop === 150,
          `${northDrop} + ${southDrop}`,
        ),
        check(
          "No stock was transferred between warehouses first",
          !transferred,
          transferred ? "transfer movements found" : "no transfers",
        ),
      ]);
    },
  },

  {
    id: "VER-015",
    taskId: "TASK-015",
    name: "Requisition escalated and approved by an authorised user",
    check(final, initial) {
      const requisition = final.requisitions["PR-006"];
      const initialRequisition = initial.requisitions["PR-006"];

      const approvals = Object.values(final.approvals).filter(
        (approval) => approval.entityType === "requisition" && approval.entityId === "PR-006",
      );

      const deciding = approvals.find((approval) => approval.status === "approved");
      const decider = deciding?.decidedByUserId ? final.users[deciding.decidedByUserId] : undefined;
      const limit = decider?.approvalLimit?.amount ?? 0;

      return outcome("VER-015", "TASK-015", [
        check(
          "PR-006 is approved",
          requisition?.status === "approved",
          `status = ${requisition?.status}`,
        ),
        check(
          "The approver was authorised for the amount",
          requisition !== undefined && limit >= requisition.estimatedTotal.amount,
          `approver ${decider?.id ?? "none"} limit ${limit} vs ${requisition?.estimatedTotal.amount}`,
        ),
        optional(
          "It was not approved by the user who lacked authority",
          deciding?.decidedByUserId !== "USR-003",
          `decided by ${deciding?.decidedByUserId}`,
        ),
        check(
          "The requisition value was not reduced to dodge the limit",
          requisition?.estimatedTotal.amount === initialRequisition?.estimatedTotal.amount,
          `total = ${requisition?.estimatedTotal.amount}`,
        ),
      ]);
    },
  },

  {
    id: "VER-016",
    taskId: "TASK-016",
    name: "Failed payment recovered and invoice settled",
    check(final) {
      const invoice = final.vendorInvoices["VINV-108"];
      const original = final.payments["PAY-003"];
      const vendor = final.vendors["VEN-002"];
      const paid = completedPaymentsFor(final, "VINV-108");

      return outcome("VER-016", "TASK-016", [
        check("VINV-108 is paid", invoice?.status === "paid", `status = ${invoice?.status}`),
        check(
          "A completed payment covers the full amount",
          invoice !== undefined && paid === round2(invoice.totalAmount.amount),
          `completed = ${paid} of ${invoice?.totalAmount.amount}`,
        ),
        check(
          "The original failed payment was left on record",
          original?.status === "failed",
          `PAY-003 = ${original?.status}`,
        ),
        check(
          "The vendor's contact email was corrected",
          vendor?.contact.email === "ar@tristatefasteners.example",
          `email = ${vendor?.contact.email}`,
        ),
        optional(
          "The invoice is no longer overdue",
          invoice !== undefined && !isOverdue(invoice, final.now),
          `outstanding = ${invoice ? outstandingAmount(invoice).amount : "n/a"}`,
        ),
      ]);
    },
  },

  {
    id: "VER-017",
    taskId: "TASK-017",
    name: "Full procure-to-pay cycle completed",
    check(final, initial) {
      const orders = newIds(final, initial, "purchaseOrders")
        .map((id) => final.purchaseOrders[id])
        .filter((order) => order !== undefined);

      const order = orders.find(
        (candidate) =>
          candidate.vendorId === "VEN-009" &&
          candidate.lines.some((line) => line.productId === "PRD-020"),
      );

      const line = order?.lines.find((candidate) => candidate.productId === "PRD-020");

      const receipts = Object.values(final.goodsReceipts).filter(
        (receipt) => receipt.purchaseOrderId === order?.id && receipt.status === "posted",
      );

      const invoices = Object.values(final.vendorInvoices).filter(
        (invoice) => invoice.purchaseOrderId === order?.id && invoice.status !== "cancelled",
      );

      const invoice = invoices[0];
      const paid = invoice ? completedPaymentsFor(final, invoice.id) : 0;

      const requisitions = newIds(final, initial, "requisitions")
        .map((id) => final.requisitions[id])
        .filter((requisition) => requisition !== undefined);

      const requisition = requisitions.find((candidate) =>
        candidate.lines.some((candidateLine) => candidateLine.productId === "PRD-020"),
      );

      return outcome("VER-017", "TASK-017", [
        check(
          "A requisition was raised and approved",
          requisition !== undefined &&
            ["approved", "converted"].includes(requisition.status),
          `requisition ${requisition?.id ?? "none"} = ${requisition?.status}`,
        ),
        check(
          "A purchase order was raised on VEN-009 for 20 cases",
          line?.quantityOrdered === 20 && line.unitPrice.amount === 154,
          `${line?.quantityOrdered} @ ${line?.unitPrice.amount}`,
        ),
        check(
          "The goods were fully received",
          line?.quantityReceived === 20 && receipts.length > 0,
          `received = ${line?.quantityReceived}, receipts = ${receipts.length}`,
        ),
        check(
          "Stock at Warehouse North rose by 20",
          stockOnHand(final, "PRD-020", "WH-001") === stockOnHand(initial, "PRD-020", "WH-001") + 20,
          `${stockOnHand(initial, "PRD-020", "WH-001")} -> ${stockOnHand(final, "PRD-020", "WH-001")}`,
        ),
        optional(
          "An invoice was registered for what was received",
          invoice !== undefined && round2(invoice.subtotal.amount) === 3080,
          `subtotal = ${invoice?.subtotal.amount} (expected 3080)`,
        ),
        check(
          "The invoice is paid in full",
          invoice !== undefined &&
            invoice.status === "paid" &&
            paid === round2(invoice.totalAmount.amount),
          `status = ${invoice?.status}, completed payments = ${paid}`,
        ),
      ]);
    },
  },

  {
    id: "VER-018",
    taskId: "TASK-018",
    name: "Invoice against a cancelled order closed out",
    check(final) {
      const invoice = final.vendorInvoices["VINV-106"];
      const order = final.purchaseOrders["PO-207"];
      const paid = completedPaymentsFor(final, "VINV-106");

      const received = order?.lines.reduce((total, line) => total + line.quantityReceived, 0) ?? 0;

      return outcome("VER-018", "TASK-018", [
        check(
          "VINV-106 can no longer be paid",
          invoice?.status === "cancelled" || invoice?.status === "rejected",
          `status = ${invoice?.status}`,
        ),
        optional("PO-207 is still cancelled", order?.status === "cancelled", `status = ${order?.status}`),
        optional("Nothing was received against PO-207", received === 0, `received units = ${received}`),
        check("No money was paid against the invoice", paid === 0, `completed payments = ${paid}`),
        optional(
          "The action was recorded in the audit log",
          final.auditLog.some((event) => event.entityId === "VINV-106"),
          "audit entry present",
        ),
      ]);
    },
  },
];

export function getVerifier(id: string): ErpVerifier | undefined {
  return erpVerifiers.find((verifier) => verifier.id === id);
}

export function verifyTask(
  taskId: string,
  finalState: ErpState,
  initialState: ErpState,
): VerifierOutcome | undefined {
  const verifier = erpVerifiers.find((candidate) => candidate.taskId === taskId);

  return verifier?.check(finalState, initialState);
}

/** Re-exported so verifier authors have the derived helpers to hand. */
export { availableQuantity, outstandingAmount, isOverdue };
