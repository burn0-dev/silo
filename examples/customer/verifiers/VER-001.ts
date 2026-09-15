/**
 * Grades TASK-001 by inspecting the world the rollout left behind.
 *
 * Nothing here reads what the agent said it did — only what the state shows.
 */

import { check, defineVerifier, optional } from "@burn0/silo";

import type { State } from "../state.js";

export const ver001 = defineVerifier<State>({
  id: "VER-001",
  taskId: "TASK-001",
  name: "Customer blocked with a reason",
  check(final, initial) {
    const customer = final.customers["CUS-001"];

    return [
      check(
        "CUS-001 is blocked",
        customer?.status === "blocked",
        `status = ${customer?.status ?? "missing"}`,
      ),
      optional(
        "A block reason was recorded",
        typeof customer?.statusReason === "string" && customer.statusReason.trim().length > 0,
        `statusReason = ${customer?.statusReason ?? "null"}`,
      ),
      optional(
        "No customer was added or removed",
        Object.keys(final.customers).length === Object.keys(initial.customers).length,
        `${Object.keys(final.customers).length} customers`,
      ),
    ];
  },
});
