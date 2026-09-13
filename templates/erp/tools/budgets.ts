import { type Budget, money, nextId, sumMoney } from "../state.js";
import {
  S,
  defineTool,
  pagingProperties,
  paginate,
  readNumber,
  readOptionalString,
  readString,
  schema,
  toolError,
} from "./contract.js";
import {
  actor,
  audit,
  budgetHeadroom,
  commitToBudget,
  releaseCommitment,
  requireBudget,
} from "./helpers.js";

const budgetView = (budget: Budget) => ({
  id: budget.id,
  name: budget.name,
  departmentId: budget.departmentId,
  fiscalYear: budget.fiscalYear,
  category: budget.category,
  status: budget.status,
  allocated: budget.allocatedAmount,
  committed: budget.committedAmount,
  spent: budget.spentAmount,
  available: budgetHeadroom(budget),
  utilisationPercent:
    budget.allocatedAmount.amount === 0
      ? 0
      : Math.round(
          ((budget.committedAmount.amount + budget.spentAmount.amount) /
            budget.allocatedAmount.amount) *
            1000,
        ) / 10,
});

export const budgetTools = [
  defineTool({
    name: "list_budgets",
    description: "List budgets with allocated, committed, spent and available amounts.",
    inputSchema: schema({
      departmentId: S.string("Only budgets for this department."),
      fiscalYear: S.string("Only budgets for this fiscal year."),
      ...pagingProperties,
    }),
    run(state, input) {
      const departmentId = readOptionalString(input, "departmentId");
      const fiscalYear = readOptionalString(input, "fiscalYear");

      const budgets = Object.values(state.budgets)
        .filter((budget) => (departmentId ? budget.departmentId === departmentId : true))
        .filter((budget) => (fiscalYear ? budget.fiscalYear === fiscalYear : true))
        .sort((a, b) => a.id.localeCompare(b.id));

      const page = paginate(budgets, input);

      return { ...page, results: page.results.map(budgetView) };
    },
  }),

  defineTool({
    name: "get_budget",
    description:
      "Get one budget with its headroom and the documents currently drawing on it.",
    inputSchema: schema({ budgetId: S.string("Budget ID, e.g. 'BUD-004'.") }, ["budgetId"]),
    run(state, input) {
      const budget = requireBudget(state, readString(input, "budgetId"));

      const requisitions = Object.values(state.requisitions)
        .filter((requisition) => requisition.budgetId === budget.id)
        .map((requisition) => ({
          id: requisition.id,
          status: requisition.status,
          estimatedTotal: requisition.estimatedTotal,
        }));

      const purchaseOrders = Object.values(state.purchaseOrders)
        .filter((order) => order.budgetId === budget.id)
        .map((order) => ({ id: order.id, status: order.status, totalAmount: order.totalAmount }));

      const expenses = Object.values(state.expenses)
        .filter((expense) => expense.budgetId === budget.id)
        .map((expense) => ({ id: expense.id, status: expense.status, amount: expense.amount }));

      return { ...budgetView(budget), requisitions, purchaseOrders, expenses };
    },
  }),

  defineTool({
    name: "get_department_budget",
    description: "Total budget position for one department across all its budgets.",
    inputSchema: schema({ departmentId: S.string("Department ID, e.g. 'DEPT-FAC'.") }, [
      "departmentId",
    ]),
    run(state, input) {
      const departmentId = readString(input, "departmentId");

      if (!state.departments[departmentId]) {
        throw toolError("not_found", `Department "${departmentId}" was not found.`);
      }

      const budgets = Object.values(state.budgets).filter(
        (budget) => budget.departmentId === departmentId,
      );

      return {
        departmentId,
        departmentName: state.departments[departmentId]?.name,
        budgetCount: budgets.length,
        allocated: sumMoney(budgets.map((budget) => budget.allocatedAmount), state.company.baseCurrency),
        committed: sumMoney(budgets.map((budget) => budget.committedAmount), state.company.baseCurrency),
        spent: sumMoney(budgets.map((budget) => budget.spentAmount), state.company.baseCurrency),
        available: sumMoney(budgets.map((budget) => budgetHeadroom(budget)), state.company.baseCurrency),
        budgets: budgets.map(budgetView),
      };
    },
  }),

  defineTool({
    name: "check_budget_availability",
    description:
      "Check whether a budget can absorb a given amount. Read-only — nothing is committed.",
    inputSchema: schema(
      {
        budgetId: S.string("Budget ID."),
        amount: S.number("Amount to test.", { minimum: 0 }),
      },
      ["budgetId", "amount"],
    ),
    run(state, input) {
      const budget = requireBudget(state, readString(input, "budgetId"));
      const amount = readNumber(input, "amount", { min: 0 });
      const available = budgetHeadroom(budget);

      return {
        budgetId: budget.id,
        budgetName: budget.name,
        requested: money(amount, budget.currency),
        available,
        sufficient: amount <= available.amount,
        shortfall:
          amount <= available.amount
            ? money(0, budget.currency)
            : money(amount - available.amount, budget.currency),
        status: budget.status,
      };
    },
  }),

  defineTool({
    name: "commit_budget",
    description:
      "Reserve budget headroom against planned spend. Fails if the amount exceeds what is available.",
    inputSchema: schema(
      {
        budgetId: S.string("Budget ID."),
        amount: S.number("Amount to commit.", { minimum: 0 }),
        reference: S.string("What the commitment is for."),
        actorUserId: S.string("User performing the action."),
      },
      ["budgetId", "amount", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const budget = requireBudget(state, readString(input, "budgetId"));
      const amount = readNumber(input, "amount", { min: 0 });
      const reference = readOptionalString(input, "reference") ?? "manual commitment";

      if (budget.status === "closed") {
        throw toolError("invalid_state", `Budget ${budget.id} is closed.`);
      }

      commitToBudget(budget, money(amount, budget.currency));

      audit(state, user.id, "budget.committed", "budget", budget.id, `Committed ${amount} to ${budget.id} for ${reference}`);

      return budgetView(budget);
    },
  }),

  defineTool({
    name: "release_budget_commitment",
    description: "Release a previously committed amount back to available headroom.",
    inputSchema: schema(
      {
        budgetId: S.string("Budget ID."),
        amount: S.number("Amount to release.", { minimum: 0 }),
        reference: S.string("What is being released."),
        actorUserId: S.string("User performing the action."),
      },
      ["budgetId", "amount", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const budget = requireBudget(state, readString(input, "budgetId"));
      const amount = readNumber(input, "amount", { min: 0 });
      const reference = readOptionalString(input, "reference") ?? "manual release";

      releaseCommitment(budget, money(amount, budget.currency));

      audit(state, user.id, "budget.released", "budget", budget.id, `Released ${amount} on ${budget.id} for ${reference}`);

      return budgetView(budget);
    },
  }),

  defineTool({
    name: "record_budget_spend",
    description:
      "Move an amount from committed to spent, for example when an invoice is paid.",
    inputSchema: schema(
      {
        budgetId: S.string("Budget ID."),
        amount: S.number("Amount actually spent.", { minimum: 0 }),
        reference: S.string("What the spend relates to."),
        actorUserId: S.string("User performing the action."),
      },
      ["budgetId", "amount", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const budget = requireBudget(state, readString(input, "budgetId"));
      const amount = readNumber(input, "amount", { min: 0 });
      const reference = readOptionalString(input, "reference") ?? "spend";

      const fromCommitment = Math.min(amount, budget.committedAmount.amount);
      const beyondCommitment = amount - fromCommitment;
      const available = budgetHeadroom(budget);

      if (beyondCommitment > available.amount) {
        throw toolError(
          "limit_exceeded",
          `Budget ${budget.id} cannot absorb ${amount}: ${budget.committedAmount.amount} committed and ${available.amount} uncommitted headroom.`,
          { committed: budget.committedAmount.amount, available: available.amount },
        );
      }

      budget.committedAmount = money(budget.committedAmount.amount - fromCommitment, budget.currency);
      budget.spentAmount = money(budget.spentAmount.amount + amount, budget.currency);

      audit(state, user.id, "budget.spend_recorded", "budget", budget.id, `Recorded spend of ${amount} on ${budget.id} for ${reference}`);

      return budgetView(budget);
    },
  }),

  defineTool({
    name: "update_budget",
    description: "Change a budget's allocation or close it.",
    inputSchema: schema(
      {
        budgetId: S.string("Budget ID."),
        allocatedAmount: S.number("New allocation.", { minimum: 0 }),
        status: S.enumeration("New status.", ["active", "closed"]),
        actorUserId: S.string("User performing the action."),
      },
      ["budgetId", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const budget = requireBudget(state, readString(input, "budgetId"));
      const changes: Array<{ field: string; from: unknown; to: unknown }> = [];

      if (typeof input["allocatedAmount"] === "number") {
        const allocated = readNumber(input, "allocatedAmount", { min: 0 });
        const consumed = budget.committedAmount.amount + budget.spentAmount.amount;

        if (allocated < consumed) {
          throw toolError(
            "invalid_input",
            `Allocation ${allocated} is below the ${consumed} already committed and spent on ${budget.id}.`,
            { committed: budget.committedAmount.amount, spent: budget.spentAmount.amount },
          );
        }

        changes.push({ field: "allocatedAmount", from: budget.allocatedAmount.amount, to: allocated });
        budget.allocatedAmount = money(allocated, budget.currency);
      }

      const status = readOptionalString(input, "status");
      if (status === "active" || status === "closed") {
        changes.push({ field: "status", from: budget.status, to: status });
        budget.status = status;
      }

      if (changes.length === 0) {
        throw toolError("invalid_input", "No budget fields were supplied to update.");
      }

      audit(state, user.id, "budget.updated", "budget", budget.id, `Updated ${budget.id}`, changes);

      return budgetView(budget);
    },
  }),

  defineTool({
    name: "create_budget",
    description: "Create a budget for a department and fiscal year.",
    inputSchema: schema(
      {
        name: S.string("Budget name."),
        departmentId: S.string("Department the budget belongs to."),
        category: S.string("Spend category."),
        allocatedAmount: S.number("Amount allocated.", { minimum: 0 }),
        fiscalYear: S.string("Fiscal year, e.g. 'FY2026'."),
        actorUserId: S.string("User performing the action."),
      },
      ["name", "departmentId", "allocatedAmount", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const departmentId = readString(input, "departmentId");

      if (!state.departments[departmentId]) {
        throw toolError("not_found", `Department "${departmentId}" was not found.`);
      }

      const budget: Budget = {
        id: nextId(state, "BUD"),
        name: readString(input, "name"),
        departmentId,
        fiscalYear: readOptionalString(input, "fiscalYear") ?? state.company.fiscalYear,
        category: readOptionalString(input, "category") ?? "general",
        allocatedAmount: money(readNumber(input, "allocatedAmount", { min: 0 }), state.company.baseCurrency),
        committedAmount: money(0, state.company.baseCurrency),
        spentAmount: money(0, state.company.baseCurrency),
        currency: state.company.baseCurrency,
        status: "active",
      };

      state.budgets[budget.id] = budget;

      audit(state, user.id, "budget.created", "budget", budget.id, `Created ${budget.id} with ${budget.allocatedAmount.amount}`);

      return budgetView(budget);
    },
  }),

  defineTool({
    name: "get_budget_utilisation",
    description:
      "Utilisation across every budget, highlighting those that are fully consumed or overdrawn.",
    inputSchema: schema({ fiscalYear: S.string("Limit to one fiscal year.") }),
    run(state, input) {
      const fiscalYear = readOptionalString(input, "fiscalYear");

      const rows = Object.values(state.budgets)
        .filter((budget) => (fiscalYear ? budget.fiscalYear === fiscalYear : true))
        .map(budgetView)
        .sort((a, b) => b.utilisationPercent - a.utilisationPercent);

      return {
        asOf: state.now,
        budgetCount: rows.length,
        totalAllocated: sumMoney(rows.map((row) => row.allocated), state.company.baseCurrency),
        totalCommitted: sumMoney(rows.map((row) => row.committed), state.company.baseCurrency),
        totalSpent: sumMoney(rows.map((row) => row.spent), state.company.baseCurrency),
        totalAvailable: sumMoney(rows.map((row) => row.available), state.company.baseCurrency),
        exhausted: rows.filter((row) => row.available.amount <= 0).map((row) => row.id),
        budgets: rows,
      };
    },
  }),
];
