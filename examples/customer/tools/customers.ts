/**
 * Customer tools.
 *
 * `run` receives the live state and the agent's raw input. Validate the input,
 * then read or mutate state directly — Silo clones whatever you return.
 */

import { defineTool, toolError } from "@burn0/silo";

import type { State } from "../state.js";

function requireCustomer(state: State, id: unknown) {
  if (typeof id !== "string" || id.trim() === "") {
    throw toolError("invalid_input", `"customerId" must be a non-empty string.`);
  }

  const customer = state.customers[id];

  if (!customer) {
    throw toolError("not_found", `Customer "${id}" was not found.`);
  }

  return customer;
}

export const getCustomer = defineTool<State>({
  name: "get_customer",
  description: "Get a customer by id, including their current status.",
  inputSchema: {
    type: "object",
    properties: {
      customerId: { type: "string", description: "Customer id, for example CUS-001." },
    },
    required: ["customerId"],
    additionalProperties: false,
  },
  run(state, input) {
    return requireCustomer(state, input.customerId);
  },
});

export const blockCustomer = defineTool<State>({
  name: "block_customer",
  description:
    "Block a customer so no further business can be transacted with them, recording why.",
  inputSchema: {
    type: "object",
    properties: {
      customerId: { type: "string", description: "Customer id, for example CUS-001." },
      reason: { type: "string", description: "Why the customer is being blocked." },
    },
    required: ["customerId", "reason"],
    additionalProperties: false,
  },
  run(state, input) {
    const customer = requireCustomer(state, input.customerId);

    if (typeof input.reason !== "string" || input.reason.trim() === "") {
      throw toolError("invalid_input", `"reason" must be a non-empty string.`);
    }

    if (customer.status === "blocked") {
      throw toolError("invalid_state", `Customer "${customer.id}" is already blocked.`, {
        status: customer.status,
      });
    }

    customer.status = "blocked";
    customer.statusReason = input.reason.trim();

    return customer;
  },
});
