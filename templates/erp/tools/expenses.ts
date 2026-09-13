import {
  type Expense,
  type ExpenseStatus,
  type Payment,
  money,
  nextId,
  sumMoney,
} from "../state.js";
import {
  S,
  defineTool,
  pagingProperties,
  paginate,
  readNumber,
  readOptionalEnum,
  readOptionalString,
  readString,
  schema,
  toolError,
} from "./contract.js";
import {
  actor,
  assertStatus,
  audit,
  budgetHeadroom,
  createApproval,
  decideApproval,
  requireApproval,
  requireBudget,
  requireExpense,
  requireUser,
} from "./helpers.js";

const expenseStatuses: readonly ExpenseStatus[] = [
  "draft",
  "submitted",
  "approved",
  "rejected",
  "paid",
];

export const expenseTools = [
  defineTool({
    name: "list_expenses",
    description:
      "List expense claims, optionally filtered by status, employee or department.",
    inputSchema: schema({
      status: S.enumeration("Only claims with this status.", expenseStatuses),
      employeeUserId: S.string("Only claims from this employee."),
      departmentId: S.string("Only claims for this department."),
      ...pagingProperties,
    }),
    run(state, input) {
      const status = readOptionalEnum(input, "status", expenseStatuses);
      const employeeUserId = readOptionalString(input, "employeeUserId");
      const departmentId = readOptionalString(input, "departmentId");

      const expenses = Object.values(state.expenses)
        .filter((expense) => (status ? expense.status === status : true))
        .filter((expense) => (employeeUserId ? expense.employeeUserId === employeeUserId : true))
        .filter((expense) => (departmentId ? expense.departmentId === departmentId : true))
        .sort((a, b) => a.id.localeCompare(b.id));

      const page = paginate(expenses, input);

      return {
        ...page,
        results: page.results,
        totalValue: sumMoney(
          expenses.map((expense) => expense.amount),
          state.company.baseCurrency,
        ),
      };
    },
  }),

  defineTool({
    name: "get_expense",
    description: "Get one expense claim.",
    inputSchema: schema({ expenseId: S.string("Expense ID, e.g. 'EXP-002'.") }, ["expenseId"]),
    run(state, input) {
      const expense = requireExpense(state, readString(input, "expenseId"));
      const approval = expense.approvalId ? state.approvals[expense.approvalId] : null;

      return { ...expense, approval: approval ?? null };
    },
  }),

  defineTool({
    name: "create_expense",
    description: "Raise a draft expense claim.",
    inputSchema: schema(
      {
        employeeUserId: S.string("Employee incurring the expense."),
        category: S.string("Expense category, e.g. 'travel'."),
        description: S.string("What the expense was for."),
        amount: S.number("Amount claimed.", { minimum: 0 }),
        budgetId: S.string("Budget to charge."),
        incurredAt: S.string("ISO date the expense was incurred."),
        hasReceipt: S.boolean("Whether a receipt is attached."),
      },
      ["employeeUserId", "category", "description", "amount"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "employeeUserId"));
      const budgetId = readOptionalString(input, "budgetId");

      if (budgetId) requireBudget(state, budgetId);

      const expense: Expense = {
        id: nextId(state, "EXP"),
        number: "",
        employeeUserId: user.id,
        departmentId: user.departmentId,
        category: readString(input, "category"),
        description: readString(input, "description"),
        amount: money(readNumber(input, "amount", { min: 0 }), state.company.baseCurrency),
        status: "draft",
        incurredAt: readOptionalString(input, "incurredAt") ?? state.now,
        submittedAt: null,
        approvalId: null,
        budgetId: budgetId ?? null,
        paymentId: null,
        hasReceipt: input["hasReceipt"] === true,
      };

      expense.number = expense.id;
      state.expenses[expense.id] = expense;

      audit(state, user.id, "expense.created", "expense", expense.id, `Raised ${expense.id} for ${expense.amount.amount}`);

      return expense;
    },
  }),

  defineTool({
    name: "submit_expense",
    description:
      "Submit a draft expense claim for approval. Claims without a receipt are refused.",
    inputSchema: schema(
      {
        expenseId: S.string("Expense ID."),
        approverUserId: S.string("User who should approve it."),
        actorUserId: S.string("User submitting the claim."),
      },
      ["expenseId", "approverUserId", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const expense = requireExpense(state, readString(input, "expenseId"));
      const approver = requireUser(state, readString(input, "approverUserId"));

      assertStatus(expense.status, ["draft"], `Expense ${expense.id}`);

      if (!expense.hasReceipt) {
        throw toolError(
          "invalid_state",
          `Expense ${expense.id} has no receipt attached and cannot be submitted.`,
        );
      }

      const approval = createApproval(state, {
        entityType: "expense",
        entityId: expense.id,
        requestedByUserId: user.id,
        assignedToUserId: approver.id,
        amount: expense.amount,
      });

      expense.status = "submitted";
      expense.submittedAt = state.now;
      expense.approvalId = approval.id;

      audit(state, user.id, "expense.submitted", "expense", expense.id, `Submitted ${expense.id} to ${approver.name}`);

      return { expense, approval };
    },
  }),

  defineTool({
    name: "approve_expense",
    description:
      "Approve a submitted expense claim and charge it to its budget as spend.",
    inputSchema: schema(
      {
        expenseId: S.string("Expense ID."),
        approverUserId: S.string("User approving the claim."),
        note: S.string("Optional note."),
      },
      ["expenseId", "approverUserId"],
    ),
    run(state, input) {
      const approver = actor(state, readString(input, "approverUserId"));
      const expense = requireExpense(state, readString(input, "expenseId"));

      assertStatus(expense.status, ["submitted"], `Expense ${expense.id}`);

      if (expense.budgetId) {
        const budget = requireBudget(state, expense.budgetId);
        const available = budgetHeadroom(budget);

        if (expense.amount.amount > available.amount) {
          throw toolError(
            "limit_exceeded",
            `Budget ${budget.id} has ${available.amount} available; expense ${expense.id} is ${expense.amount.amount}.`,
            { available: available.amount, requested: expense.amount.amount },
          );
        }

        budget.spentAmount = money(
          budget.spentAmount.amount + expense.amount.amount,
          budget.currency,
        );
      }

      if (expense.approvalId) {
        decideApproval(
          state,
          requireApproval(state, expense.approvalId),
          "approved",
          approver.id,
          readOptionalString(input, "note"),
        );
      }

      expense.status = "approved";

      audit(state, approver.id, "expense.approved", "expense", expense.id, `Approved ${expense.id} for ${expense.amount.amount}`);

      return expense;
    },
  }),

  defineTool({
    name: "reject_expense",
    description: "Reject a submitted expense claim.",
    inputSchema: schema(
      {
        expenseId: S.string("Expense ID."),
        approverUserId: S.string("User rejecting the claim."),
        reason: S.string("Why it is being rejected."),
      },
      ["expenseId", "approverUserId", "reason"],
    ),
    run(state, input) {
      const approver = actor(state, readString(input, "approverUserId"));
      const expense = requireExpense(state, readString(input, "expenseId"));
      const reason = readString(input, "reason");

      assertStatus(expense.status, ["submitted"], `Expense ${expense.id}`);

      if (expense.approvalId) {
        decideApproval(state, requireApproval(state, expense.approvalId), "rejected", approver.id, reason);
      }

      expense.status = "rejected";

      audit(state, approver.id, "expense.rejected", "expense", expense.id, `Rejected ${expense.id}: ${reason}`);

      return expense;
    },
  }),

  defineTool({
    name: "pay_expense",
    description:
      "Reimburse an approved expense claim, creating a completed outbound payment.",
    inputSchema: schema(
      {
        expenseId: S.string("Expense ID."),
        actorUserId: S.string("User processing the reimbursement."),
      },
      ["expenseId", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const expense = requireExpense(state, readString(input, "expenseId"));

      assertStatus(expense.status, ["approved"], `Expense ${expense.id}`);

      const payment: Payment = {
        id: nextId(state, "PAY"),
        number: "",
        direction: "outbound",
        vendorId: null,
        customerId: null,
        allocations: [],
        amount: expense.amount,
        method: "ach",
        status: "completed",
        reference: `REIMB-${expense.id}`,
        scheduledDate: state.now,
        processedAt: state.now,
        failureReason: null,
        createdByUserId: user.id,
        approvalId: null,
        approvedByUserId: user.id,
        createdAt: state.now,
      };

      payment.number = payment.id;
      state.payments[payment.id] = payment;

      expense.status = "paid";
      expense.paymentId = payment.id;

      audit(state, user.id, "expense.paid", "expense", expense.id, `Reimbursed ${expense.id} via ${payment.id}`);

      return { expense, payment };
    },
  }),

  defineTool({
    name: "list_expenses_awaiting_action",
    description:
      "Expense claims that need someone to act: drafts missing receipts, submitted claims awaiting approval, and approved claims awaiting reimbursement.",
    inputSchema: schema({ ...pagingProperties }),
    run(state, input) {
      type PendingExpense = {
        expenseId: string;
        status: ExpenseStatus;
        amount: Expense["amount"];
        employeeUserId: string;
        action: string;
      };

      const actionByStatus: Partial<Record<ExpenseStatus, string>> = {
        submitted: "approve_expense / reject_expense",
        approved: "pay_expense",
      };

      const rows: PendingExpense[] = [];

      for (const expense of Object.values(state.expenses)) {
        const action =
          expense.status === "draft"
            ? expense.hasReceipt
              ? "submit_expense"
              : "attach a receipt before submitting"
            : actionByStatus[expense.status];

        if (!action) continue;

        rows.push({
          expenseId: expense.id,
          status: expense.status,
          amount: expense.amount,
          employeeUserId: expense.employeeUserId,
          action,
        });
      }

      rows.sort((a, b) => a.expenseId.localeCompare(b.expenseId));

      return paginate(rows, input);
    },
  }),
];
