/**
 * Profit tools.
 *
 * Read-only: this environment's task asks a question, so no tool changes the
 * world. The agent has to gather the figures and do the arithmetic itself.
 */

import { defineTool } from "@burn0/silo";

import type { State } from "../state.js";

export const getProfits = defineTool<State>({
  name: "get_profits",
  description: "List every recorded profit line and its amount.",
  inputSchema: {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  },
  run(state) {
    return [
      { line: "profit1", amount: state.profit1 },
      { line: "profit2", amount: state.profit2 },
    ];
  },
});
