/**
 * Simulated clock.
 *
 * `state.now` is the only source of "today" in this environment — no tool reads
 * the real system time. The clock never advances on its own: a mutation does not
 * tick it, so a task that never calls `advance_clock` runs entirely at one
 * instant and is fully reproducible. Advancing is explicit and forward-only.
 */

import { addDays, daysBetween, isOverdue } from "../state.js";
import {
  S,
  defineTool,
  readNumber,
  readOptionalString,
  readString,
  schema,
  toolError,
} from "./contract.js";
import { actor, audit } from "./helpers.js";

export const clockTools = [
  defineTool({
    name: "get_current_date",
    description:
      "The environment's current date, plus how many documents are overdue as of now. All date comparisons in this ERP use this clock, not real-world time.",
    inputSchema: schema({}),
    run(state) {
      const overdueVendorInvoices = Object.values(state.vendorInvoices).filter((invoice) =>
        isOverdue(invoice, state.now),
      );

      const overdueCustomerInvoices = Object.values(state.customerInvoices).filter((invoice) =>
        isOverdue(invoice, state.now),
      );

      const latePurchaseOrders = Object.values(state.purchaseOrders).filter(
        (order) =>
          (order.status === "sent" || order.status === "partially_received") &&
          order.expectedDeliveryDate < state.now,
      );

      return {
        now: state.now,
        fiscalYear: state.company.fiscalYear,
        fiscalYearStart: state.company.fiscalYearStart,
        overdueVendorInvoiceCount: overdueVendorInvoices.length,
        overdueCustomerInvoiceCount: overdueCustomerInvoices.length,
        latePurchaseOrderCount: latePurchaseOrders.length,
      };
    },
  }),

  defineTool({
    name: "advance_clock",
    description:
      "Move the simulated clock forward by a number of days. Use this to test what falls due later; it never moves backwards and nothing else advances it.",
    inputSchema: schema(
      {
        days: S.integer("Days to advance. Must be positive.", { minimum: 1, maximum: 365 }),
        reason: S.string("Why the clock is being advanced."),
        actorUserId: S.string("User performing the action."),
      },
      ["days", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const days = readNumber(input, "days", { min: 1, max: 365, integer: true });
      const reason = readOptionalString(input, "reason") ?? "Clock advanced";

      const previous = state.now;
      state.now = addDays(state.now, days);

      const newlyOverdueVendorInvoices = Object.values(state.vendorInvoices)
        .filter((invoice) => !isOverdue(invoice, previous) && isOverdue(invoice, state.now))
        .map((invoice) => invoice.id);

      const newlyOverdueCustomerInvoices = Object.values(state.customerInvoices)
        .filter((invoice) => !isOverdue(invoice, previous) && isOverdue(invoice, state.now))
        .map((invoice) => invoice.id);

      const newlyExpiredQuotations = Object.values(state.quotations)
        .filter(
          (quotation) =>
            (quotation.status === "received" || quotation.status === "under_review") &&
            quotation.validUntil >= previous &&
            quotation.validUntil < state.now,
        )
        .map((quotation) => quotation.id);

      audit(state, user.id, "clock.advanced", "company", state.company.id, `Advanced the clock ${days} day(s): ${reason}`, [
        { field: "now", from: previous, to: state.now },
      ]);

      return {
        previousDate: previous,
        now: state.now,
        daysAdvanced: daysBetween(previous, state.now),
        newlyOverdueVendorInvoices,
        newlyOverdueCustomerInvoices,
        newlyExpiredQuotations,
      };
    },
  }),

  defineTool({
    name: "set_clock",
    description:
      "Set the simulated clock to a specific ISO date. Forward-only: moving the clock backwards is refused because it would contradict records already written.",
    inputSchema: schema(
      {
        date: S.string("ISO date or timestamp to move to."),
        reason: S.string("Why the clock is being set."),
        actorUserId: S.string("User performing the action."),
      },
      ["date", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const date = readString(input, "date");
      const parsed = new Date(date);

      if (Number.isNaN(parsed.getTime())) {
        throw toolError("invalid_input", `"${date}" is not a valid ISO date.`);
      }

      const target = parsed.toISOString();

      if (target < state.now) {
        throw toolError(
          "invalid_input",
          `The clock cannot move backwards from ${state.now} to ${target}.`,
          { now: state.now, requested: target },
        );
      }

      const previous = state.now;
      state.now = target;

      audit(state, user.id, "clock.set", "company", state.company.id, `Set the clock to ${target}`, [
        { field: "now", from: previous, to: target },
      ]);

      return { previousDate: previous, now: state.now, daysAdvanced: daysBetween(previous, target) };
    },
  }),
];
