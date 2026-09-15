import { defineTool, schema } from "./contract.js";

export const clockTools = [
  defineTool({
    name: "get_current_date",
    description:
      "Today's date in the simulation. Every overdue, days-in-status and sprint-remaining judgement is relative to this date, not to the real calendar.",
    inputSchema: schema({}),
    run(state) {
      return { today: state.now };
    },
  }),
];
