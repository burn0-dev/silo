import {
  type Payment,
  type PaymentMethod,
  type PaymentStatus,
  money,
  nextId,
  outstandingAmount,
  sumMoney,
} from "../state.js";
import {
  S,
  defineTool,
  pagingProperties,
  paginate,
  readEnum,
  readObjectArray,
  readOptionalEnum,
  readOptionalString,
  readNumber,
  readString,
  schema,
  toolError,
} from "./contract.js";
import {
  actor,
  applyPaymentToInvoice,
  assertStatus,
  audit,
  createApproval,
  decideApproval,
  requireApproval,
  requireCustomer,
  requireCustomerInvoice,
  requirePayment,
  requireUser,
  requireVendor,
  requireVendorInvoice,
  withinApprovalLimit,
} from "./helpers.js";

const paymentMethods: readonly PaymentMethod[] = ["bank_transfer", "ach", "check", "card"];

const paymentStatuses: readonly PaymentStatus[] = [
  "draft",
  "pending_approval",
  "approved",
  "completed",
  "failed",
  "cancelled",
];

const paymentSummary = (payment: Payment) => ({
  id: payment.id,
  direction: payment.direction,
  vendorId: payment.vendorId,
  customerId: payment.customerId,
  status: payment.status,
  amount: payment.amount,
  method: payment.method,
  scheduledDate: payment.scheduledDate,
  processedAt: payment.processedAt,
  invoiceIds: payment.allocations.map((allocation) => allocation.invoiceId),
});

export const paymentTools = [
  defineTool({
    name: "list_payments",
    description:
      "List payments, optionally filtered by direction, status, vendor or customer.",
    inputSchema: schema({
      direction: S.enumeration("Outbound (to vendors) or inbound (from customers).", ["outbound", "inbound"]),
      status: S.enumeration("Only payments with this status.", paymentStatuses),
      vendorId: S.string("Only payments to this vendor."),
      customerId: S.string("Only receipts from this customer."),
      ...pagingProperties,
    }),
    run(state, input) {
      const direction = readOptionalString(input, "direction");
      const status = readOptionalEnum(input, "status", paymentStatuses);
      const vendorId = readOptionalString(input, "vendorId");
      const customerId = readOptionalString(input, "customerId");

      const payments = Object.values(state.payments)
        .filter((payment) => (direction ? payment.direction === direction : true))
        .filter((payment) => (status ? payment.status === status : true))
        .filter((payment) => (vendorId ? payment.vendorId === vendorId : true))
        .filter((payment) => (customerId ? payment.customerId === customerId : true))
        .sort((a, b) => a.id.localeCompare(b.id));

      const page = paginate(payments, input);

      return { ...page, results: page.results.map(paymentSummary) };
    },
  }),

  defineTool({
    name: "get_payment",
    description: "Get one payment with its invoice allocations.",
    inputSchema: schema({ paymentId: S.string("Payment ID, e.g. 'PAY-002'.") }, ["paymentId"]),
    run(state, input) {
      return requirePayment(state, readString(input, "paymentId"));
    },
  }),

  defineTool({
    name: "create_vendor_payment",
    description:
      "Schedule a payment against one or more approved vendor invoices. Refuses invoices that are not approved, are cancelled, or are already settled, and refuses to over-pay.",
    inputSchema: schema(
      {
        vendorId: S.string("Vendor being paid."),
        allocations: S.array(
          "Invoices and amounts to pay. Omit amount to pay the full outstanding balance.",
          S.object(
            "Allocation.",
            {
              invoiceId: S.string("Vendor invoice ID."),
              amount: S.number("Amount to apply.", { minimum: 0 }),
            },
            ["invoiceId"],
          ),
        ),
        method: S.enumeration("Payment method.", paymentMethods),
        scheduledDate: S.string("ISO date the payment is scheduled for."),
        actorUserId: S.string("User creating the payment."),
      },
      ["vendorId", "allocations", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const vendor = requireVendor(state, readString(input, "vendorId"));

      const allocations = readObjectArray(input, "allocations").map((entry) => {
        const invoice = requireVendorInvoice(state, readString(entry, "invoiceId"));

        if (invoice.vendorId !== vendor.id) {
          throw toolError(
            "invalid_input",
            `Invoice ${invoice.id} belongs to vendor ${invoice.vendorId}, not ${vendor.id}.`,
          );
        }

        if (invoice.status === "cancelled" || invoice.status === "rejected") {
          throw toolError(
            "invalid_state",
            `Invoice ${invoice.id} is ${invoice.status} and cannot be paid.`,
          );
        }

        if (invoice.status === "disputed") {
          throw toolError(
            "invalid_state",
            `Invoice ${invoice.id} is in dispute: ${invoice.disputeReason ?? "no reason recorded"}.`,
          );
        }

        if (invoice.status !== "approved" && invoice.status !== "partially_paid") {
          throw toolError(
            "invalid_state",
            `Invoice ${invoice.id} is "${invoice.status}"; only approved invoices can be paid. Use explain_invoice_block for details.`,
            { status: invoice.status },
          );
        }

        const remaining = outstandingAmount(invoice);

        if (remaining.amount <= 0) {
          throw toolError("invalid_state", `Invoice ${invoice.id} has nothing outstanding.`);
        }

        const requested =
          typeof entry["amount"] === "number"
            ? readNumber(entry, "amount", { min: 0 })
            : remaining.amount;

        if (requested > remaining.amount) {
          throw toolError(
            "invalid_input",
            `Cannot pay ${requested} against ${invoice.id}: only ${remaining.amount} outstanding.`,
            { outstanding: remaining.amount },
          );
        }

        return { invoiceId: invoice.id, amount: money(requested, state.company.baseCurrency) };
      });

      const amount = sumMoney(
        allocations.map((allocation) => allocation.amount),
        state.company.baseCurrency,
      );

      const payment: Payment = {
        id: nextId(state, "PAY"),
        number: "",
        direction: "outbound",
        vendorId: vendor.id,
        customerId: null,
        allocations,
        amount,
        method: readOptionalEnum(input, "method", paymentMethods) ?? "bank_transfer",
        status: "draft",
        reference: "",
        scheduledDate: readOptionalString(input, "scheduledDate") ?? state.now,
        processedAt: null,
        failureReason: null,
        createdByUserId: user.id,
        approvalId: null,
        approvedByUserId: null,
        createdAt: state.now,
      };

      payment.number = payment.id;
      payment.reference = `${payment.method.toUpperCase()}-${payment.id}`;

      state.payments[payment.id] = payment;

      audit(state, user.id, "payment.created", "payment", payment.id, `Scheduled ${payment.id} to ${vendor.name} for ${amount.amount}`);

      return payment;
    },
  }),

  defineTool({
    name: "submit_payment_for_approval",
    description: "Send a draft payment for approval before release.",
    inputSchema: schema(
      {
        paymentId: S.string("Payment ID."),
        approverUserId: S.string("User who should approve it."),
        actorUserId: S.string("User performing the action."),
      },
      ["paymentId", "approverUserId", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const payment = requirePayment(state, readString(input, "paymentId"));
      const approver = requireUser(state, readString(input, "approverUserId"));

      assertStatus(payment.status, ["draft"], `Payment ${payment.id}`);

      const approval = createApproval(state, {
        entityType: "payment",
        entityId: payment.id,
        requestedByUserId: user.id,
        assignedToUserId: approver.id,
        amount: payment.amount,
      });

      payment.status = "pending_approval";
      payment.approvalId = approval.id;

      audit(state, user.id, "payment.submitted", "payment", payment.id, `Submitted ${payment.id} to ${approver.name}`);

      return { payment, approval };
    },
  }),

  defineTool({
    name: "approve_payment",
    description: "Approve a payment so it can be released.",
    inputSchema: schema(
      {
        paymentId: S.string("Payment ID."),
        approverUserId: S.string("User approving the payment."),
        note: S.string("Optional note."),
      },
      ["paymentId", "approverUserId"],
    ),
    run(state, input) {
      const approver = actor(state, readString(input, "approverUserId"));
      const payment = requirePayment(state, readString(input, "paymentId"));

      assertStatus(payment.status, ["pending_approval", "draft"], `Payment ${payment.id}`);

      if (!withinApprovalLimit(approver, payment.amount)) {
        throw toolError(
          "limit_exceeded",
          `${approver.name} has an approval limit of ${approver.approvalLimit?.amount ?? 0}; ${payment.id} totals ${payment.amount.amount}.`,
          { approvalLimit: approver.approvalLimit?.amount ?? 0, amount: payment.amount.amount },
        );
      }

      if (payment.approvalId) {
        decideApproval(
          state,
          requireApproval(state, payment.approvalId),
          "approved",
          approver.id,
          readOptionalString(input, "note"),
        );
      }

      payment.status = "approved";
      payment.approvedByUserId = approver.id;

      audit(state, approver.id, "payment.approved", "payment", payment.id, `Approved ${payment.id}`);

      return payment;
    },
  }),

  defineTool({
    name: "complete_payment",
    description:
      "Release an approved payment. Applies each allocation to its invoice, marking invoices paid or partially paid.",
    inputSchema: schema(
      {
        paymentId: S.string("Payment ID."),
        actorUserId: S.string("User releasing the payment."),
      },
      ["paymentId", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const payment = requirePayment(state, readString(input, "paymentId"));

      assertStatus(payment.status, ["approved"], `Payment ${payment.id}`);

      for (const allocation of payment.allocations) {
        const invoice =
          payment.direction === "outbound"
            ? requireVendorInvoice(state, allocation.invoiceId)
            : requireCustomerInvoice(state, allocation.invoiceId);

        applyPaymentToInvoice(invoice, allocation.amount, state.now);
      }

      payment.status = "completed";
      payment.processedAt = state.now;

      audit(state, user.id, "payment.completed", "payment", payment.id, `Completed ${payment.id} for ${payment.amount.amount}`);

      return {
        payment,
        invoices: payment.allocations.map((allocation) => {
          const invoice =
            payment.direction === "outbound"
              ? state.vendorInvoices[allocation.invoiceId]
              : state.customerInvoices[allocation.invoiceId];

          return {
            invoiceId: allocation.invoiceId,
            status: invoice?.status,
            amountPaid: invoice?.amountPaid,
            outstanding: invoice ? outstandingAmount(invoice) : null,
          };
        }),
      };
    },
  }),

  defineTool({
    name: "fail_payment",
    description:
      "Mark a payment as failed, for example a rejected bank transfer. Invoice balances are left untouched.",
    inputSchema: schema(
      {
        paymentId: S.string("Payment ID."),
        reason: S.string("Why the payment failed."),
        actorUserId: S.string("User recording the failure."),
      },
      ["paymentId", "reason", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const payment = requirePayment(state, readString(input, "paymentId"));
      const reason = readString(input, "reason");

      assertStatus(payment.status, ["approved", "pending_approval"], `Payment ${payment.id}`);

      payment.status = "failed";
      payment.failureReason = reason;
      payment.processedAt = state.now;

      audit(state, user.id, "payment.failed", "payment", payment.id, `Payment ${payment.id} failed: ${reason}`);

      return payment;
    },
  }),

  defineTool({
    name: "retry_failed_payment",
    description:
      "Create a fresh payment for the same allocations as a failed one, so the original failure stays on record.",
    inputSchema: schema(
      {
        paymentId: S.string("Failed payment ID."),
        method: S.enumeration("Method for the retry.", paymentMethods),
        scheduledDate: S.string("ISO date for the retry."),
        actorUserId: S.string("User performing the retry."),
      },
      ["paymentId", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const original = requirePayment(state, readString(input, "paymentId"));

      assertStatus(original.status, ["failed"], `Payment ${original.id}`);

      const stillOwed = original.allocations.filter((allocation) => {
        const invoice =
          original.direction === "outbound"
            ? state.vendorInvoices[allocation.invoiceId]
            : state.customerInvoices[allocation.invoiceId];

        return invoice !== undefined && outstandingAmount(invoice).amount > 0;
      });

      if (stillOwed.length === 0) {
        throw toolError("invalid_state", `Nothing remains outstanding on ${original.id}'s invoices.`);
      }

      const retry: Payment = {
        id: nextId(state, "PAY"),
        number: "",
        direction: original.direction,
        vendorId: original.vendorId,
        customerId: original.customerId,
        allocations: stillOwed.map((allocation) => ({ ...allocation })),
        amount: sumMoney(
          stillOwed.map((allocation) => allocation.amount),
          state.company.baseCurrency,
        ),
        method: readOptionalEnum(input, "method", paymentMethods) ?? original.method,
        status: "draft",
        reference: "",
        scheduledDate: readOptionalString(input, "scheduledDate") ?? state.now,
        processedAt: null,
        failureReason: null,
        createdByUserId: user.id,
        approvalId: null,
        approvedByUserId: null,
        createdAt: state.now,
      };

      retry.number = retry.id;
      retry.reference = `${retry.method.toUpperCase()}-${retry.id}`;

      state.payments[retry.id] = retry;

      audit(state, user.id, "payment.retried", "payment", retry.id, `Created ${retry.id} to retry failed ${original.id}`);

      return { retry, originalPaymentId: original.id };
    },
  }),

  defineTool({
    name: "cancel_payment",
    description: "Cancel a payment that has not been released.",
    inputSchema: schema(
      {
        paymentId: S.string("Payment ID."),
        reason: S.string("Why it is being cancelled."),
        actorUserId: S.string("User performing the action."),
      },
      ["paymentId", "reason", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const payment = requirePayment(state, readString(input, "paymentId"));
      const reason = readString(input, "reason");

      assertStatus(payment.status, ["draft", "pending_approval", "approved"], `Payment ${payment.id}`);

      if (payment.approvalId) {
        const approval = requireApproval(state, payment.approvalId);
        if (approval.status === "pending") {
          approval.status = "cancelled";
          approval.decidedAt = state.now;
        }
      }

      payment.status = "cancelled";

      audit(state, user.id, "payment.cancelled", "payment", payment.id, `Cancelled ${payment.id}: ${reason}`);

      return payment;
    },
  }),

  defineTool({
    name: "record_customer_payment",
    description:
      "Record money received from a customer and apply it to their invoices. Completes immediately — receipts are not approved.",
    inputSchema: schema(
      {
        customerId: S.string("Customer paying."),
        allocations: S.array(
          "Invoices and amounts received. Omit amount to settle the full balance.",
          S.object(
            "Allocation.",
            {
              invoiceId: S.string("Customer invoice ID."),
              amount: S.number("Amount received.", { minimum: 0 }),
            },
            ["invoiceId"],
          ),
        ),
        method: S.enumeration("How the money arrived.", paymentMethods),
        reference: S.string("Bank or cheque reference."),
        actorUserId: S.string("User recording the receipt."),
      },
      ["customerId", "allocations", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const customer = requireCustomer(state, readString(input, "customerId"));

      const allocations = readObjectArray(input, "allocations").map((entry) => {
        const invoice = requireCustomerInvoice(state, readString(entry, "invoiceId"));

        if (invoice.customerId !== customer.id) {
          throw toolError(
            "invalid_input",
            `Invoice ${invoice.id} belongs to customer ${invoice.customerId}, not ${customer.id}.`,
          );
        }

        if (invoice.status === "cancelled" || invoice.status === "draft") {
          throw toolError(
            "invalid_state",
            `Invoice ${invoice.id} is "${invoice.status}" and cannot take a payment.`,
          );
        }

        const remaining = outstandingAmount(invoice);

        if (remaining.amount <= 0) {
          throw toolError("invalid_state", `Invoice ${invoice.id} has nothing outstanding.`);
        }

        const requested =
          typeof entry["amount"] === "number"
            ? readNumber(entry, "amount", { min: 0 })
            : remaining.amount;

        if (requested > remaining.amount) {
          throw toolError(
            "invalid_input",
            `Cannot apply ${requested} to ${invoice.id}: only ${remaining.amount} outstanding.`,
            { outstanding: remaining.amount },
          );
        }

        return { invoiceId: invoice.id, amount: money(requested, state.company.baseCurrency) };
      });

      const amount = sumMoney(
        allocations.map((allocation) => allocation.amount),
        state.company.baseCurrency,
      );

      const payment: Payment = {
        id: nextId(state, "PAY"),
        number: "",
        direction: "inbound",
        vendorId: null,
        customerId: customer.id,
        allocations,
        amount,
        method: readOptionalEnum(input, "method", paymentMethods) ?? "bank_transfer",
        status: "completed",
        reference: readOptionalString(input, "reference") ?? "",
        scheduledDate: state.now,
        processedAt: state.now,
        failureReason: null,
        createdByUserId: user.id,
        approvalId: null,
        approvedByUserId: null,
        createdAt: state.now,
      };

      payment.number = payment.id;
      if (!payment.reference) payment.reference = `RCPT-${payment.id}`;

      state.payments[payment.id] = payment;

      for (const allocation of allocations) {
        applyPaymentToInvoice(
          requireCustomerInvoice(state, allocation.invoiceId),
          allocation.amount,
          state.now,
        );
      }

      audit(state, user.id, "payment.received", "payment", payment.id, `Received ${amount.amount} from ${customer.name}`);

      return payment;
    },
  }),

  defineTool({
    name: "list_payments_for_invoice",
    description: "Every payment that touched one invoice, including failed attempts.",
    inputSchema: schema({ invoiceId: S.string("Vendor or customer invoice ID.") }, [
      "invoiceId",
    ]),
    run(state, input) {
      const invoiceId = readString(input, "invoiceId");

      if (!state.vendorInvoices[invoiceId] && !state.customerInvoices[invoiceId]) {
        throw toolError("not_found", `Invoice "${invoiceId}" was not found.`);
      }

      return Object.values(state.payments)
        .filter((payment) =>
          payment.allocations.some((allocation) => allocation.invoiceId === invoiceId),
        )
        .map((payment) => ({
          ...paymentSummary(payment),
          appliedAmount: payment.allocations.find((allocation) => allocation.invoiceId === invoiceId)?.amount,
          failureReason: payment.failureReason,
        }))
        .sort((a, b) => a.id.localeCompare(b.id));
    },
  }),

  defineTool({
    name: "build_payment_run",
    description:
      "Propose a payment run: approved invoices due within a window, grouped by vendor, with totals. Read-only — create the payments separately.",
    inputSchema: schema({
      withinDays: S.integer("Days ahead to include (default 7).", { minimum: 0, maximum: 365 }),
      includeOverdue: S.boolean("Include already-overdue invoices (default true)."),
    }),
    run(state, input) {
      const withinDays =
        typeof input["withinDays"] === "number" ? readNumber(input, "withinDays", { min: 0, max: 365, integer: true }) : 7;
      const includeOverdue = input["includeOverdue"] !== false;

      const horizonDate = new Date(state.now);
      horizonDate.setUTCDate(horizonDate.getUTCDate() + withinDays);
      const horizon = horizonDate.toISOString();

      const eligible = Object.values(state.vendorInvoices)
        .filter((invoice) => invoice.status === "approved" || invoice.status === "partially_paid")
        .filter((invoice) => outstandingAmount(invoice).amount > 0)
        .filter((invoice) => (invoice.dueDate < state.now ? includeOverdue : invoice.dueDate <= horizon));

      const byVendor = new Map<string, typeof eligible>();

      for (const invoice of eligible) {
        const list = byVendor.get(invoice.vendorId) ?? [];
        list.push(invoice);
        byVendor.set(invoice.vendorId, list);
      }

      const groups = [...byVendor.entries()]
        .map(([vendorId, invoices]) => ({
          vendorId,
          vendorName: state.vendors[vendorId]?.name ?? vendorId,
          invoiceCount: invoices.length,
          totalDue: sumMoney(
            invoices.map((invoice) => outstandingAmount(invoice)),
            state.company.baseCurrency,
          ),
          invoices: invoices
            .map((invoice) => ({
              invoiceId: invoice.id,
              dueDate: invoice.dueDate,
              outstanding: outstandingAmount(invoice),
              isOverdue: invoice.dueDate < state.now,
            }))
            .sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
        }))
        .sort((a, b) => b.totalDue.amount - a.totalDue.amount);

      return {
        horizon,
        vendorCount: groups.length,
        invoiceCount: eligible.length,
        grandTotal: sumMoney(
          groups.map((group) => group.totalDue),
          state.company.baseCurrency,
        ),
        groups,
      };
    },
  }),
];
