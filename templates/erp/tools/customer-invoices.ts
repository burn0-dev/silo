import {
  type CustomerInvoice,
  type CustomerInvoiceStatus,
  addDays,
  daysBetween,
  isOverdue,
  money,
  nextId,
  outstandingAmount,
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
  readOptionalNumber,
  readOptionalString,
  readString,
  schema,
  toolError,
} from "./contract.js";
import {
  actor,
  assertStatus,
  audit,
  customerInvoiceSummary,
  requireCustomer,
  requireCustomerInvoice,
  requireProduct,
  requireSalesOrder,
} from "./helpers.js";

const invoiceStatuses: readonly CustomerInvoiceStatus[] = [
  "draft",
  "issued",
  "partially_paid",
  "paid",
  "cancelled",
  "written_off",
];

const TAX_RATE = 0.08;

export const customerInvoiceTools = [
  defineTool({
    name: "list_customer_invoices",
    description:
      "List customer invoices across all customers, optionally filtered by status, customer or overdue flag.",
    inputSchema: schema({
      status: S.enumeration("Only invoices with this status.", invoiceStatuses),
      customerId: S.string("Only invoices for this customer."),
      overdueOnly: S.boolean("Only invoices past their due date and still owing."),
      minimumAmount: S.number("Only invoices at or above this total.", { minimum: 0 }),
      ...pagingProperties,
    }),
    run(state, input) {
      const status = readOptionalEnum(input, "status", invoiceStatuses);
      const customerId = readOptionalString(input, "customerId");
      const overdueOnly = input["overdueOnly"] === true;
      const minimumAmount = readOptionalNumber(input, "minimumAmount", { min: 0 });

      const invoices = Object.values(state.customerInvoices)
        .filter((invoice) => (status ? invoice.status === status : true))
        .filter((invoice) => (customerId ? invoice.customerId === customerId : true))
        .filter((invoice) => (overdueOnly ? isOverdue(invoice, state.now) : true))
        .filter((invoice) => (minimumAmount !== undefined ? invoice.totalAmount.amount >= minimumAmount : true))
        .sort((a, b) => a.id.localeCompare(b.id));

      const page = paginate(invoices, input);

      return {
        ...page,
        results: page.results.map((invoice) => ({
          ...customerInvoiceSummary(invoice),
          isOverdue: isOverdue(invoice, state.now),
        })),
        totalOutstanding: sumMoney(
          invoices.map((invoice) => outstandingAmount(invoice)),
          state.company.baseCurrency,
        ),
      };
    },
  }),

  defineTool({
    name: "search_customer_invoices",
    description: "Search customer invoices by ID or customer name.",
    inputSchema: schema(
      { query: S.string("Free-text search term."), ...pagingProperties },
      ["query"],
    ),
    run(state, input) {
      const query = readString(input, "query");

      const invoices = Object.values(state.customerInvoices)
        .filter((invoice) => {
          const customer = state.customers[invoice.customerId];

          return (
            matchesText(invoice.id, query) ||
            (customer ? matchesText(customer.name, query) : false)
          );
        })
        .sort((a, b) => a.id.localeCompare(b.id));

      const page = paginate(invoices, input);

      return { ...page, results: page.results.map(customerInvoiceSummary) };
    },
  }),

  defineTool({
    name: "get_customer_invoice",
    description: "Get one customer invoice with its lines and payment history.",
    inputSchema: schema({ customerInvoiceId: S.string("Invoice ID, e.g. 'CINV-403'.") }, [
      "customerInvoiceId",
    ]),
    run(state, input) {
      const invoice = requireCustomerInvoice(state, readString(input, "customerInvoiceId"));

      const payments = Object.values(state.payments)
        .filter((payment) => payment.allocations.some((allocation) => allocation.invoiceId === invoice.id))
        .map((payment) => ({
          id: payment.id,
          status: payment.status,
          amount: payment.amount,
          processedAt: payment.processedAt,
        }));

      return {
        ...invoice,
        outstanding: outstandingAmount(invoice),
        isOverdue: isOverdue(invoice, state.now),
        daysOverdue: isOverdue(invoice, state.now) ? daysBetween(invoice.dueDate, state.now) : 0,
        payments,
      };
    },
  }),

  defineTool({
    name: "create_customer_invoice",
    description:
      "Raise a draft invoice, normally for what has shipped on a sales order. Omit lines to bill the order's fulfilled quantities.",
    inputSchema: schema(
      {
        customerId: S.string("Customer to bill."),
        salesOrderId: S.string("Sales order being invoiced."),
        lines: S.array(
          "Invoice lines. Omit to bill the fulfilled quantities on the sales order.",
          S.object(
            "Invoice line.",
            {
              productId: S.string("Product ID."),
              description: S.string("Line description."),
              quantity: S.number("Quantity billed.", { minimum: 0 }),
              unitPrice: S.number("Unit price.", { minimum: 0 }),
              salesOrderLineId: S.string("Sales order line being billed."),
            },
            ["productId", "quantity", "unitPrice"],
          ),
        ),
        actorUserId: S.string("User raising the invoice."),
      },
      ["customerId", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const customer = requireCustomer(state, readString(input, "customerId"));
      const salesOrderId = readOptionalString(input, "salesOrderId");
      const order = salesOrderId ? requireSalesOrder(state, salesOrderId) : null;

      if (order && order.customerId !== customer.id) {
        throw toolError(
          "invalid_input",
          `${order.id} belongs to customer ${order.customerId}, not ${customer.id}.`,
        );
      }

      if (order && order.status === "cancelled") {
        throw toolError("invalid_state", `${order.id} is cancelled and cannot be invoiced.`);
      }

      const id = nextId(state, "CINV");

      const specs = Array.isArray(input["lines"])
        ? readObjectArray(input, "lines")
        : order
          ? order.lines
              .filter((line) => line.quantityFulfilled > 0)
              .map((line) => ({
                productId: line.productId,
                description: state.products[line.productId]?.name ?? line.productId,
                quantity: line.quantityFulfilled,
                unitPrice: line.unitPrice.amount,
                salesOrderLineId: line.id,
              }))
          : [];

      if (specs.length === 0) {
        throw toolError(
          "invalid_input",
          order
            ? `Nothing has shipped on ${order.id} yet, so there is nothing to invoice.`
            : "Provide \"lines\" when there is no sales order.",
        );
      }

      const lines = specs.map((line, index) => {
        const product = requireProduct(state, readString(line, "productId"));
        const quantity = readNumber(line, "quantity", { min: 0 });
        const unitPrice = readNumber(line, "unitPrice", { min: 0 });

        return {
          id: `${id}-L${index + 1}`,
          salesOrderLineId: readOptionalString(line, "salesOrderLineId") ?? null,
          productId: product.id,
          description: readOptionalString(line, "description") ?? product.name,
          quantity,
          unitPrice: money(unitPrice, state.company.baseCurrency),
          lineTotal: money(quantity * unitPrice, state.company.baseCurrency),
        };
      });

      const subtotal = sumMoney(lines.map((line) => line.lineTotal), state.company.baseCurrency);
      const taxAmount = money(subtotal.amount * TAX_RATE, state.company.baseCurrency);

      const invoice: CustomerInvoice = {
        id,
        number: id,
        customerId: customer.id,
        salesOrderId: order?.id ?? null,
        fulfillmentIds: order
          ? Object.values(state.fulfillments)
              .filter((fulfillment) => fulfillment.salesOrderId === order.id && fulfillment.status !== "cancelled")
              .map((fulfillment) => fulfillment.id)
          : [],
        status: "draft",
        lines,
        subtotal,
        taxAmount,
        totalAmount: money(subtotal.amount + taxAmount.amount, state.company.baseCurrency),
        amountPaid: money(0, state.company.baseCurrency),
        issueDate: state.now,
        dueDate: addDays(state.now, paymentTermDays(customer.paymentTerms)),
        paidAt: null,
      };

      state.customerInvoices[invoice.id] = invoice;

      audit(state, user.id, "customer_invoice.created", "customer_invoice", invoice.id, `Raised ${invoice.id} for ${customer.name}`);

      return invoice;
    },
  }),

  defineTool({
    name: "issue_customer_invoice",
    description:
      "Issue a draft invoice to the customer, setting the issue and due dates from their payment terms.",
    inputSchema: schema(
      {
        customerInvoiceId: S.string("Invoice ID."),
        actorUserId: S.string("User issuing the invoice."),
      },
      ["customerInvoiceId", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const invoice = requireCustomerInvoice(state, readString(input, "customerInvoiceId"));
      const customer = requireCustomer(state, invoice.customerId);

      assertStatus(invoice.status, ["draft"], `Invoice ${invoice.id}`);

      invoice.status = "issued";
      invoice.issueDate = state.now;
      invoice.dueDate = addDays(state.now, paymentTermDays(customer.paymentTerms));

      if (invoice.salesOrderId) {
        const order = requireSalesOrder(state, invoice.salesOrderId);
        if (order.status === "fulfilled") order.status = "invoiced";
      }

      audit(state, user.id, "customer_invoice.issued", "customer_invoice", invoice.id, `Issued ${invoice.id} due ${invoice.dueDate}`);

      return invoice;
    },
  }),

  defineTool({
    name: "cancel_customer_invoice",
    description: "Cancel an invoice that has taken no payment.",
    inputSchema: schema(
      {
        customerInvoiceId: S.string("Invoice ID."),
        reason: S.string("Why it is being cancelled."),
        actorUserId: S.string("User performing the action."),
      },
      ["customerInvoiceId", "reason", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const invoice = requireCustomerInvoice(state, readString(input, "customerInvoiceId"));
      const reason = readString(input, "reason");

      assertStatus(invoice.status, ["draft", "issued"], `Invoice ${invoice.id}`);

      if (invoice.amountPaid.amount > 0) {
        throw toolError(
          "invalid_state",
          `Invoice ${invoice.id} has ${invoice.amountPaid.amount} paid against it; write it off instead.`,
        );
      }

      invoice.status = "cancelled";

      audit(state, user.id, "customer_invoice.cancelled", "customer_invoice", invoice.id, `Cancelled ${invoice.id}: ${reason}`);

      return invoice;
    },
  }),

  defineTool({
    name: "write_off_customer_invoice",
    description:
      "Write off an unpaid or partly paid invoice as uncollectible. Typically paired with blocking the customer.",
    inputSchema: schema(
      {
        customerInvoiceId: S.string("Invoice ID."),
        reason: S.string("Why it is being written off."),
        actorUserId: S.string("User performing the write-off."),
      },
      ["customerInvoiceId", "reason", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const invoice = requireCustomerInvoice(state, readString(input, "customerInvoiceId"));
      const reason = readString(input, "reason");

      assertStatus(invoice.status, ["issued", "partially_paid"], `Invoice ${invoice.id}`);

      const writtenOff = outstandingAmount(invoice);
      invoice.status = "written_off";

      audit(state, user.id, "customer_invoice.written_off", "customer_invoice", invoice.id, `Wrote off ${writtenOff.amount} on ${invoice.id}: ${reason}`);

      return { invoice, amountWrittenOff: writtenOff };
    },
  }),

  defineTool({
    name: "list_overdue_customer_invoices",
    description:
      "Overdue receivables, optionally only those above a threshold. Includes days overdue and the customer's status.",
    inputSchema: schema({
      minimumAmount: S.number("Only invoices with a total at or above this.", { minimum: 0 }),
      customerId: S.string("Only this customer."),
      ...pagingProperties,
    }),
    run(state, input) {
      const minimumAmount = readOptionalNumber(input, "minimumAmount", { min: 0 });
      const customerId = readOptionalString(input, "customerId");

      const rows = Object.values(state.customerInvoices)
        .filter((invoice) => isOverdue(invoice, state.now))
        .filter((invoice) => (customerId ? invoice.customerId === customerId : true))
        .filter((invoice) => (minimumAmount !== undefined ? invoice.totalAmount.amount >= minimumAmount : true))
        .map((invoice) => ({
          ...customerInvoiceSummary(invoice),
          customerName: state.customers[invoice.customerId]?.name ?? invoice.customerId,
          customerStatus: state.customers[invoice.customerId]?.status,
          daysOverdue: daysBetween(invoice.dueDate, state.now),
        }))
        .sort((a, b) => b.daysOverdue - a.daysOverdue);

      return {
        ...paginate(rows, input),
        totalOverdue: sumMoney(rows.map((row) => row.outstanding), state.company.baseCurrency),
      };
    },
  }),

  defineTool({
    name: "list_receivables_by_customer",
    description: "Outstanding receivables grouped by customer, largest first.",
    inputSchema: schema({ ...pagingProperties }),
    run(state, input) {
      const groups = new Map<string, { outstanding: number; overdue: number; invoices: string[] }>();

      for (const invoice of Object.values(state.customerInvoices)) {
        if (["draft", "cancelled", "written_off", "paid"].includes(invoice.status)) continue;

        const entry = groups.get(invoice.customerId) ?? { outstanding: 0, overdue: 0, invoices: [] };
        entry.outstanding += outstandingAmount(invoice).amount;
        if (isOverdue(invoice, state.now)) entry.overdue += outstandingAmount(invoice).amount;
        entry.invoices.push(invoice.id);
        groups.set(invoice.customerId, entry);
      }

      const rows = [...groups.entries()]
        .map(([customerId, entry]) => ({
          customerId,
          customerName: state.customers[customerId]?.name ?? customerId,
          customerStatus: state.customers[customerId]?.status,
          creditLimit: state.customers[customerId]?.creditLimit,
          totalOutstanding: money(entry.outstanding, state.company.baseCurrency),
          overdueOutstanding: money(entry.overdue, state.company.baseCurrency),
          invoiceCount: entry.invoices.length,
          invoiceIds: entry.invoices.sort(),
        }))
        .sort((a, b) => b.totalOutstanding.amount - a.totalOutstanding.amount);

      return paginate(rows, input);
    },
  }),

  defineTool({
    name: "get_ar_aging",
    description:
      "Accounts receivable aging: current, 1-30, 31-60, 61-90 and 90+ days past due, with per-bucket totals.",
    inputSchema: schema({ customerId: S.string("Limit to one customer.") }),
    run(state, input) {
      const customerId = readOptionalString(input, "customerId");

      const buckets = {
        current: [] as string[],
        days1to30: [] as string[],
        days31to60: [] as string[],
        days61to90: [] as string[],
        days90plus: [] as string[],
      };

      const totals = {
        current: 0,
        days1to30: 0,
        days31to60: 0,
        days61to90: 0,
        days90plus: 0,
      };

      for (const invoice of Object.values(state.customerInvoices)) {
        if (["draft", "cancelled", "written_off", "paid"].includes(invoice.status)) continue;
        if (customerId && invoice.customerId !== customerId) continue;

        const amount = outstandingAmount(invoice).amount;
        if (amount <= 0) continue;

        const overdueDays = invoice.dueDate < state.now ? daysBetween(invoice.dueDate, state.now) : 0;

        if (overdueDays <= 0) {
          buckets.current.push(invoice.id);
          totals.current += amount;
        } else if (overdueDays <= 30) {
          buckets.days1to30.push(invoice.id);
          totals.days1to30 += amount;
        } else if (overdueDays <= 60) {
          buckets.days31to60.push(invoice.id);
          totals.days31to60 += amount;
        } else if (overdueDays <= 90) {
          buckets.days61to90.push(invoice.id);
          totals.days61to90 += amount;
        } else {
          buckets.days90plus.push(invoice.id);
          totals.days90plus += amount;
        }
      }

      const grandTotal =
        totals.current + totals.days1to30 + totals.days31to60 + totals.days61to90 + totals.days90plus;

      return {
        asOf: state.now,
        customerId: customerId ?? null,
        buckets: {
          current: { total: money(totals.current, state.company.baseCurrency), invoiceIds: buckets.current },
          days1to30: { total: money(totals.days1to30, state.company.baseCurrency), invoiceIds: buckets.days1to30 },
          days31to60: { total: money(totals.days31to60, state.company.baseCurrency), invoiceIds: buckets.days31to60 },
          days61to90: { total: money(totals.days61to90, state.company.baseCurrency), invoiceIds: buckets.days61to90 },
          days90plus: { total: money(totals.days90plus, state.company.baseCurrency), invoiceIds: buckets.days90plus },
        },
        grandTotal: money(grandTotal, state.company.baseCurrency),
      };
    },
  }),

  defineTool({
    name: "list_uninvoiced_shipments",
    description:
      "Orders with goods shipped but not yet billed — revenue sitting unrecognised.",
    inputSchema: schema({ ...pagingProperties }),
    run(state, input) {
      const rows = Object.values(state.salesOrders)
        .filter((order) => order.status !== "cancelled" && order.status !== "draft")
        .flatMap((order) => {
          const shippedValue = order.lines.reduce(
            (total, line) => total + line.quantityFulfilled * line.unitPrice.amount,
            0,
          );

          if (shippedValue <= 0) return [];

          const invoiced = Object.values(state.customerInvoices)
            .filter(
              (invoice) => invoice.salesOrderId === order.id && invoice.status !== "cancelled",
            )
            .reduce((total, invoice) => total + invoice.subtotal.amount, 0);

          if (invoiced >= shippedValue) return [];

          return [
            {
              salesOrderId: order.id,
              customerId: order.customerId,
              customerName: state.customers[order.customerId]?.name ?? order.customerId,
              status: order.status,
              shippedValue: money(shippedValue, state.company.baseCurrency),
              invoicedValue: money(invoiced, state.company.baseCurrency),
              uninvoicedValue: money(shippedValue - invoiced, state.company.baseCurrency),
            },
          ];
        })
        .sort((a, b) => b.uninvoicedValue.amount - a.uninvoicedValue.amount);

      return {
        ...paginate(rows, input),
        totalUninvoiced: sumMoney(
          rows.map((row) => row.uninvoicedValue),
          state.company.baseCurrency,
        ),
      };
    },
  }),
];
