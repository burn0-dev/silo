import { type UserRole, openPipelineFor, wonAmountFor } from "../state.js";
import {
  S,
  defineTool,
  pagingProperties,
  paginate,
  readBoolean,
  readOptionalEnum,
  readString,
  schema,
} from "./contract.js";
import { requireUser, userSummary } from "./helpers.js";

const userRoles: readonly UserRole[] = ["rep", "manager"];

export const userTools = [
  defineTool({
    name: "list_users",
    description:
      "List sales users. Use this to find who owns what, and to check whether a user is still active before assigning work to them.",
    inputSchema: schema({
      role: S.enumeration("Only users with this role.", userRoles),
      activeOnly: S.boolean("Only users who are still active (default false)."),
      ...pagingProperties,
    }),
    run(state, input) {
      const role = readOptionalEnum(input, "role", userRoles);
      const activeOnly = readBoolean(input, "activeOnly", false);

      const users = Object.values(state.users)
        .filter((user) => (role ? user.role === role : true))
        .filter((user) => (activeOnly ? user.active : true))
        .sort((a, b) => a.id.localeCompare(b.id));

      const page = paginate(users, input);

      return { ...page, results: page.results.map(userSummary) };
    },
  }),

  defineTool({
    name: "get_user",
    description:
      "Get one user with their quota, open pipeline and closed-won total, for measuring attainment.",
    inputSchema: schema({ userId: S.string("User ID, e.g. 'USR-002'.") }, ["userId"]),
    run(state, input) {
      const user = requireUser(state, readString(input, "userId"));
      const won = wonAmountFor(state, user.id);
      const attainment =
        user.quota.amount === 0 ? null : Math.round((won.amount / user.quota.amount) * 1000) / 10;

      return {
        ...userSummary(user),
        openPipeline: openPipelineFor(state, user.id),
        closedWon: won,
        quotaAttainmentPercent: attainment,
      };
    },
  }),
];
