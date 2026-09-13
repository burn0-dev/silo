import {
  type PurchaseRequisition,
  type RequisitionStatus,
  type Rfq,
  addDays,
  money,
  nextId,
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
  readOptionalString,
  readString,
  readStringArray,
  schema,
  toolError,
} from "./contract.js";
import {
  actor,
  assertStatus,
  audit,
  budgetHeadroom,
  commitToBudget,
  createApproval,
  decideApproval,
  requireApproval,
  requireBudget,
  requireProduct,
  requireRequisition,
  requireUser,
  requisitionSummary,
  withinApprovalLimit,
} from "./helpers.js";

const requisitionStatuses: readonly RequisitionStatus[] = [
  "draft",
  "submitted",
  "pending_approval",
  "approved",
  "rejected",
  "cancelled",
  "converted",
];

function recalculateTotal(requisition: PurchaseRequisition): void {
  requisition.estimatedTotal = sumMoney(
    requisition.lines.map((line) =>
      money(line.quantity * line.estimatedUnitPrice.amount, line.estimatedUnitPrice.currency),
    ),
    requisition.estimatedTotal.currency,
  );
}

export const requisitionTools = [
  defineTool({
    name: "list_requisitions",
    description:
      "List purchase requisitions, optionally filtered by status, department or requester.",
    inputSchema: schema({
      status: S.enumeration("Only requisitions with this status.", requisitionStatuses),
      departmentId: S.string("Only requisitions from this department."),
      requesterUserId: S.string("Only requisitions raised by this user."),
      ...pagingProperties,
    }),
    run(state, input) {
      const status = readOptionalEnum(input, "status", requisitionStatuses);
      const departmentId = readOptionalString(input, "departmentId");
      const requesterUserId = readOptionalString(input, "requesterUserId");

      const requisitions = Object.values(state.requisitions)
        .filter((requisition) => (status ? requisition.status === status : true))
        .filter((requisition) => (departmentId ? requisition.departmentId === departmentId : true))
        .filter((requisition) => (requesterUserId ? requisition.requesterUserId === requesterUserId : true))
        .sort((a, b) => a.id.localeCompare(b.id));

      const page = paginate(requisitions, input);

      return { ...page, results: page.results.map(requisitionSummary) };
    },
  }),

  defineTool({
    name: "search_requisitions",
    description: "Search requisitions by justification text or ID.",
    inputSchema: schema(
      { query: S.string("Free-text search term."), ...pagingProperties },
      ["query"],
    ),
    run(state, input) {
      const query = readString(input, "query");

      const requisitions = Object.values(state.requisitions)
        .filter(
          (requisition) =>
            matchesText(requisition.id, query) ||
            matchesText(requisition.justification, query),
        )
        .sort((a, b) => a.id.localeCompare(b.id));

      const page = paginate(requisitions, input);

      return { ...page, results: page.results.map(requisitionSummary) };
    },
  }),

  defineTool({
    name: "get_requisition",
    description: "Get one purchase requisition with its lines and linked documents.",
    inputSchema: schema({ requisitionId: S.string("Requisition ID, e.g. 'PR-001'.") }, [
      "requisitionId",
    ]),
    run(state, input) {
      return requireRequisition(state, readString(input, "requisitionId"));
    },
  }),

  defineTool({
    name: "create_requisition",
    description:
      "Raise a new purchase requisition in draft. Submit it separately to start approval.",
    inputSchema: schema(
      {
        requesterUserId: S.string("User raising the requisition."),
        departmentId: S.string("Department the spend belongs to."),
        budgetId: S.string("Budget the spend should be charged to."),
        justification: S.string("Business justification."),
        neededBy: S.string("ISO date the goods are needed by."),
        lines: S.array(
          "Requested lines.",
          S.object(
            "Requisition line.",
            {
              productId: S.string("Product ID."),
              quantity: S.integer("Quantity required.", { minimum: 1 }),
              estimatedUnitPrice: S.number("Estimated unit price.", { minimum: 0 }),
            },
            ["productId", "quantity"],
          ),
        ),
      },
      ["requesterUserId", "departmentId", "justification", "lines"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "requesterUserId"));
      const departmentId = readString(input, "departmentId");

      if (!state.departments[departmentId]) {
        throw toolError("not_found", `Department "${departmentId}" was not found.`);
      }

      const budgetId = readOptionalString(input, "budgetId");
      if (budgetId) requireBudget(state, budgetId);

      const neededBy = readOptionalString(input, "neededBy") ?? addDays(state.now, 30);
      const id = nextId(state, "PR");

      const lines = readObjectArray(input, "lines").map((line, index) => {
        const product = requireProduct(state, readString(line, "productId"));
        const quantity = readNumber(line, "quantity", { min: 1, integer: true });
        const estimated = line["estimatedUnitPrice"];

        return {
          id: `${id}-L${index + 1}`,
          productId: product.id,
          quantity,
          estimatedUnitPrice:
            typeof estimated === "number"
              ? money(estimated, product.standardCost.currency)
              : product.standardCost,
          neededBy,
        };
      });

      const requisition: PurchaseRequisition = {
        id,
        number: id,
        requesterUserId: user.id,
        departmentId,
        status: "draft",
        lines,
        justification: readString(input, "justification"),
        estimatedTotal: money(0, state.company.baseCurrency),
        budgetId: budgetId ?? null,
        createdAt: state.now,
        submittedAt: null,
        decidedAt: null,
        approvalId: null,
        rfqId: null,
        purchaseOrderId: null,
      };

      recalculateTotal(requisition);
      state.requisitions[requisition.id] = requisition;

      audit(state, user.id, "requisition.created", "requisition", requisition.id, `Raised requisition ${requisition.id}`);

      return requisition;
    },
  }),

  defineTool({
    name: "update_requisition",
    description: "Change lines, justification or budget on a draft requisition.",
    inputSchema: schema(
      {
        requisitionId: S.string("Requisition ID."),
        justification: S.string("Replacement justification."),
        budgetId: S.string("Replacement budget ID."),
        lines: S.array(
          "Replacement lines; omit to keep existing lines.",
          S.object(
            "Requisition line.",
            {
              productId: S.string("Product ID."),
              quantity: S.integer("Quantity required.", { minimum: 1 }),
              estimatedUnitPrice: S.number("Estimated unit price.", { minimum: 0 }),
            },
            ["productId", "quantity"],
          ),
        ),
        actorUserId: S.string("User performing the action."),
      },
      ["requisitionId", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const requisition = requireRequisition(state, readString(input, "requisitionId"));

      assertStatus(requisition.status, ["draft"], `Requisition ${requisition.id}`);

      const justification = readOptionalString(input, "justification");
      if (justification) requisition.justification = justification;

      const budgetId = readOptionalString(input, "budgetId");
      if (budgetId) {
        requireBudget(state, budgetId);
        requisition.budgetId = budgetId;
      }

      if (Array.isArray(input["lines"])) {
        requisition.lines = readObjectArray(input, "lines").map((line, index) => {
          const product = requireProduct(state, readString(line, "productId"));
          const estimated = line["estimatedUnitPrice"];

          return {
            id: `${requisition.id}-L${index + 1}`,
            productId: product.id,
            quantity: readNumber(line, "quantity", { min: 1, integer: true }),
            estimatedUnitPrice:
              typeof estimated === "number"
                ? money(estimated, product.standardCost.currency)
                : product.standardCost,
            neededBy: requisition.lines[0]?.neededBy ?? addDays(state.now, 30),
          };
        });

        recalculateTotal(requisition);
      }

      audit(state, user.id, "requisition.updated", "requisition", requisition.id, `Updated requisition ${requisition.id}`);

      return requisition;
    },
  }),

  defineTool({
    name: "submit_requisition",
    description:
      "Submit a draft requisition for approval. Routes to the named approver and creates a pending approval record.",
    inputSchema: schema(
      {
        requisitionId: S.string("Requisition ID."),
        approverUserId: S.string("User who should decide on the requisition."),
        actorUserId: S.string("User performing the action."),
      },
      ["requisitionId", "approverUserId", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const requisition = requireRequisition(state, readString(input, "requisitionId"));
      const approver = requireUser(state, readString(input, "approverUserId"));

      assertStatus(requisition.status, ["draft"], `Requisition ${requisition.id}`);

      if (requisition.lines.length === 0) {
        throw toolError("invalid_state", `Requisition ${requisition.id} has no lines.`);
      }

      const approval = createApproval(state, {
        entityType: "requisition",
        entityId: requisition.id,
        requestedByUserId: user.id,
        assignedToUserId: approver.id,
        amount: requisition.estimatedTotal,
      });

      requisition.status = "pending_approval";
      requisition.submittedAt = state.now;
      requisition.approvalId = approval.id;

      audit(state, user.id, "requisition.submitted", "requisition", requisition.id, `Submitted ${requisition.id} to ${approver.name}`);

      return { requisition, approval };
    },
  }),

  defineTool({
    name: "check_requisition_budget",
    description:
      "Check whether the requisition's budget can absorb its estimated total. Does not change anything.",
    inputSchema: schema({ requisitionId: S.string("Requisition ID.") }, ["requisitionId"]),
    run(state, input) {
      const requisition = requireRequisition(state, readString(input, "requisitionId"));

      if (!requisition.budgetId) {
        return {
          requisitionId: requisition.id,
          hasBudget: false,
          sufficient: false,
          reason: "No budget is assigned to this requisition.",
        };
      }

      const budget = requireBudget(state, requisition.budgetId);
      const available = budgetHeadroom(budget);

      return {
        requisitionId: requisition.id,
        hasBudget: true,
        budgetId: budget.id,
        budgetName: budget.name,
        estimatedTotal: requisition.estimatedTotal,
        allocated: budget.allocatedAmount,
        committed: budget.committedAmount,
        spent: budget.spentAmount,
        available,
        sufficient: requisition.estimatedTotal.amount <= available.amount,
        shortfall:
          requisition.estimatedTotal.amount <= available.amount
            ? money(0, available.currency)
            : money(requisition.estimatedTotal.amount - available.amount, available.currency),
      };
    },
  }),

  defineTool({
    name: "approve_requisition",
    description:
      "Approve a requisition. Rejects the attempt if the approver's limit is too low or the budget cannot cover it, and commits the amount to the budget on success.",
    inputSchema: schema(
      {
        requisitionId: S.string("Requisition ID."),
        approverUserId: S.string("User approving the requisition."),
        note: S.string("Optional approval note."),
      },
      ["requisitionId", "approverUserId"],
    ),
    run(state, input) {
      const approver = actor(state, readString(input, "approverUserId"));
      const requisition = requireRequisition(state, readString(input, "requisitionId"));
      const note = readOptionalString(input, "note");

      assertStatus(requisition.status, ["pending_approval", "submitted"], `Requisition ${requisition.id}`);

      if (!requisition.approvalId) {
        throw toolError("invalid_state", `Requisition ${requisition.id} has no approval record; submit it first.`);
      }

      if (!withinApprovalLimit(approver, requisition.estimatedTotal)) {
        throw toolError(
          "limit_exceeded",
          `${approver.name} has an approval limit of ${approver.approvalLimit?.amount ?? 0}; requisition ${requisition.id} totals ${requisition.estimatedTotal.amount}.`,
          {
            approvalLimit: approver.approvalLimit?.amount ?? 0,
            amount: requisition.estimatedTotal.amount,
          },
        );
      }

      if (requisition.budgetId) {
        commitToBudget(requireBudget(state, requisition.budgetId), requisition.estimatedTotal);
      }

      const approval = decideApproval(
        state,
        requireApproval(state, requisition.approvalId),
        "approved",
        approver.id,
        note,
      );

      requisition.status = "approved";
      requisition.decidedAt = state.now;

      audit(state, approver.id, "requisition.approved", "requisition", requisition.id, `Approved ${requisition.id} for ${requisition.estimatedTotal.amount}`);

      return { requisition, approval };
    },
  }),

  defineTool({
    name: "reject_requisition",
    description: "Reject a requisition that is awaiting approval.",
    inputSchema: schema(
      {
        requisitionId: S.string("Requisition ID."),
        approverUserId: S.string("User rejecting the requisition."),
        reason: S.string("Why it is being rejected."),
      },
      ["requisitionId", "approverUserId", "reason"],
    ),
    run(state, input) {
      const approver = actor(state, readString(input, "approverUserId"));
      const requisition = requireRequisition(state, readString(input, "requisitionId"));
      const reason = readString(input, "reason");

      assertStatus(requisition.status, ["pending_approval", "submitted"], `Requisition ${requisition.id}`);

      if (!requisition.approvalId) {
        throw toolError("invalid_state", `Requisition ${requisition.id} has no approval record.`);
      }

      const approval = decideApproval(
        state,
        requireApproval(state, requisition.approvalId),
        "rejected",
        approver.id,
        reason,
      );

      requisition.status = "rejected";
      requisition.decidedAt = state.now;

      audit(state, approver.id, "requisition.rejected", "requisition", requisition.id, `Rejected ${requisition.id}: ${reason}`);

      return { requisition, approval };
    },
  }),

  defineTool({
    name: "cancel_requisition",
    description:
      "Cancel a requisition that has not yet been converted into a purchase order. Releases any budget commitment.",
    inputSchema: schema(
      {
        requisitionId: S.string("Requisition ID."),
        reason: S.string("Why it is being cancelled."),
        actorUserId: S.string("User performing the action."),
      },
      ["requisitionId", "reason", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const requisition = requireRequisition(state, readString(input, "requisitionId"));
      const reason = readString(input, "reason");

      assertStatus(
        requisition.status,
        ["draft", "submitted", "pending_approval", "approved"],
        `Requisition ${requisition.id}`,
      );

      if (requisition.status === "approved" && requisition.budgetId) {
        const budget = requireBudget(state, requisition.budgetId);
        budget.committedAmount = money(
          Math.max(0, budget.committedAmount.amount - requisition.estimatedTotal.amount),
          budget.currency,
        );
      }

      if (requisition.approvalId) {
        const approval = requireApproval(state, requisition.approvalId);
        if (approval.status === "pending") {
          approval.status = "cancelled";
          approval.decidedAt = state.now;
        }
      }

      requisition.status = "cancelled";
      requisition.decidedAt = state.now;

      audit(state, user.id, "requisition.cancelled", "requisition", requisition.id, `Cancelled ${requisition.id}: ${reason}`);

      return requisition;
    },
  }),

  defineTool({
    name: "list_requisition_approvals",
    description: "List every approval record raised against one requisition.",
    inputSchema: schema({ requisitionId: S.string("Requisition ID.") }, ["requisitionId"]),
    run(state, input) {
      const requisition = requireRequisition(state, readString(input, "requisitionId"));

      return Object.values(state.approvals)
        .filter(
          (approval) =>
            approval.entityType === "requisition" && approval.entityId === requisition.id,
        )
        .sort((a, b) => a.id.localeCompare(b.id));
    },
  }),

  defineTool({
    name: "convert_requisition_to_rfq",
    description:
      "Create an RFQ from an approved requisition and invite vendors to quote.",
    inputSchema: schema(
      {
        requisitionId: S.string("Requisition ID."),
        vendorIds: S.array("Vendors to invite.", S.string("Vendor ID.")),
        title: S.string("RFQ title."),
        responseDueDate: S.string("ISO date responses are due."),
        actorUserId: S.string("User performing the action."),
      },
      ["requisitionId", "vendorIds", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const requisition = requireRequisition(state, readString(input, "requisitionId"));
      const vendorIds = readStringArray(input, "vendorIds");

      assertStatus(requisition.status, ["approved"], `Requisition ${requisition.id}`);

      if (requisition.rfqId) {
        throw toolError(
          "conflict",
          `Requisition ${requisition.id} already has RFQ ${requisition.rfqId}.`,
          { rfqId: requisition.rfqId },
        );
      }

      for (const vendorId of vendorIds) {
        const vendor = state.vendors[vendorId];

        if (!vendor) {
          throw toolError("not_found", `Vendor "${vendorId}" was not found.`);
        }

        if (vendor.status === "blocked") {
          throw toolError("not_allowed", `Vendor ${vendorId} is blocked and cannot be invited to quote.`);
        }
      }

      const id = nextId(state, "RFQ");

      const rfq: Rfq = {
        id,
        number: id,
        title: readOptionalString(input, "title") ?? `Sourcing for ${requisition.id}`,
        status: "draft",
        requisitionId: requisition.id,
        lines: requisition.lines.map((line, index) => ({
          id: `${id}-L${index + 1}`,
          productId: line.productId,
          quantity: line.quantity,
        })),
        invitedVendorIds: vendorIds,
        issuedByUserId: user.id,
        createdAt: state.now,
        sentAt: null,
        responseDueDate: readOptionalString(input, "responseDueDate") ?? addDays(state.now, 10),
        closedAt: null,
        awardedQuotationId: null,
      };

      state.rfqs[rfq.id] = rfq;
      requisition.rfqId = rfq.id;

      audit(state, user.id, "rfq.created", "rfq", rfq.id, `Created ${rfq.id} from ${requisition.id}`);

      return rfq;
    },
  }),
];
