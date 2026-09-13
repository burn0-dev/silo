/**
 * ERP environment template.
 *
 * A simulated mid-sized industrial distributor with connected procure-to-pay,
 * order-to-cash, inventory and budgeting data. Edit anything here — this file is
 * copied into your project, it is not library code.
 */

import type { ErpState } from "./state.js";
import { type ErpTool, erpTools } from "./tools/index.js";

export * from "./state.js";

export * from "./tools/index.js";

export * from "./tasks/index.js";

export * from "./verifiers/index.js";

/**
 * Binds the ERP tools to a state object, producing the shape Silo's runner
 * expects: `execute(input)` returning `{ output, isError }`. Keeping this
 * conversion here means the tools themselves stay framework-agnostic.
 */
export function bindTools(state: ErpState, tools: ErpTool[] = erpTools) {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    async execute(input: unknown) {
      const outcome = tool.execute(
        state,
        (input ?? {}) as Record<string, unknown>,
      );

      // Cloned so traces are immutable snapshots and callers cannot reach
      // into live state through a returned object.
      return outcome.ok
        ? { output: structuredClone(outcome.data) }
        : { output: structuredClone(outcome.error), isError: true };
    },
  }));
}

export {
  SIMULATION_NOW,
  TAX_RATE,
  createErpState,
  company,
  departments,
  users,
  vendors,
  customers,
  products,
  warehouses,
  inventory,
  inventoryMovements,
  requisitions,
  approvals,
  rfqs,
  quotations,
  purchaseOrders,
  goodsReceipts,
  receivingDiscrepancies,
  vendorInvoices,
  threeWayMatches,
  payments,
  salesOrders,
  fulfillments,
  customerInvoices,
  expenses,
  budgets,
  auditLog,
  sequences,
} from "./seed.js";

import { createErpState } from "./seed.js";
import { erpTasks } from "./tasks/index.js";
import { erpVerifiers } from "./verifiers/index.js";

/**
 * Standard runtime surface. Silo loads templates through these four names only,
 * so it never needs to know about ERP-specific exports.
 */
export const createState = createErpState;
export const tasks = erpTasks;
export const verifiers = erpVerifiers;
