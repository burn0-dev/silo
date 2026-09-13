/**
 * Approval queries and routing.
 *
 * Deciding an approval is deliberately NOT done here: approving a requisition,
 * purchase order, invoice, payment or expense has different side effects, so each
 * domain owns its own approve/reject tool. These tools cover the inbox view.
 */

import type { ApprovalEntityType, ApprovalStatus } from "../state.js";
import {
  S,
  defineTool,
  pagingProperties,
  paginate,
  readOptionalEnum,
  readOptionalString,
  readString,
  schema,
  toolError,
} from "./contract.js";
import {
  actor,
  audit,
  requireApproval,
  requireUser,
  withinApprovalLimit,
} from "./helpers.js";

const entityTypes: readonly ApprovalEntityType[] = [
  "requisition",
  "purchase_order",
  "vendor_invoice",
  "payment",
  "expense",
];

const approvalStatuses: readonly ApprovalStatus[] = [
  "pending",
  "approved",
  "rejected",
  "cancelled",
];

const decisionToolByEntity: Record<ApprovalEntityType, string> = {
  requisition: "approve_requisition / reject_requisition",
  purchase_order: "approve_purchase_order / reject_purchase_order",
  vendor_invoice: "approve_vendor_invoice / reject_vendor_invoice",
  payment: "approve_payment",
  expense: "approve_expense / reject_expense",
};

export const approvalTools = [
  defineTool({
    name: "list_pending_approvals",
    description:
      "List approvals still awaiting a decision, optionally for one approver or entity type. Each row names the tool that decides it.",
    inputSchema: schema({
      assignedToUserId: S.string("Only approvals assigned to this user."),
      entityType: S.enumeration("Only approvals of this entity type.", entityTypes),
      ...pagingProperties,
    }),
    run(state, input) {
      const assignedToUserId = readOptionalString(input, "assignedToUserId");
      const entityType = readOptionalEnum(input, "entityType", entityTypes);

      if (assignedToUserId) requireUser(state, assignedToUserId);

      const approvals = Object.values(state.approvals)
        .filter((approval) => approval.status === "pending")
        .filter((approval) => (assignedToUserId ? approval.assignedToUserId === assignedToUserId : true))
        .filter((approval) => (entityType ? approval.entityType === entityType : true))
        .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));

      const page = paginate(approvals, input);

      return {
        ...page,
        results: page.results.map((approval) => ({
          id: approval.id,
          entityType: approval.entityType,
          entityId: approval.entityId,
          amount: approval.amount,
          requestedByUserId: approval.requestedByUserId,
          assignedToUserId: approval.assignedToUserId,
          requestedAt: approval.requestedAt,
          decideWith: decisionToolByEntity[approval.entityType],
        })),
      };
    },
  }),

  defineTool({
    name: "get_approval",
    description: "Get one approval record.",
    inputSchema: schema({ approvalId: S.string("Approval ID, e.g. 'APR-001'.") }, [
      "approvalId",
    ]),
    run(state, input) {
      const approval = requireApproval(state, readString(input, "approvalId"));

      return { ...approval, decideWith: decisionToolByEntity[approval.entityType] };
    },
  }),

  defineTool({
    name: "list_approvals_for_entity",
    description:
      "Approval history for one document, for example every approval raised against a purchase order.",
    inputSchema: schema(
      {
        entityType: S.enumeration("Type of document.", entityTypes),
        entityId: S.string("Document ID."),
      },
      ["entityType", "entityId"],
    ),
    run(state, input) {
      const entityType = readOptionalEnum(input, "entityType", entityTypes);
      const entityId = readString(input, "entityId");

      return Object.values(state.approvals)
        .filter((approval) => approval.entityType === entityType && approval.entityId === entityId)
        .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
    },
  }),

  defineTool({
    name: "list_approvals",
    description: "List approvals across the business, filtered by status or approver.",
    inputSchema: schema({
      status: S.enumeration("Only approvals with this status.", approvalStatuses),
      assignedToUserId: S.string("Only approvals assigned to this user."),
      ...pagingProperties,
    }),
    run(state, input) {
      const status = readOptionalEnum(input, "status", approvalStatuses);
      const assignedToUserId = readOptionalString(input, "assignedToUserId");

      const approvals = Object.values(state.approvals)
        .filter((approval) => (status ? approval.status === status : true))
        .filter((approval) => (assignedToUserId ? approval.assignedToUserId === assignedToUserId : true))
        .sort((a, b) => a.id.localeCompare(b.id));

      return paginate(approvals, input);
    },
  }),

  defineTool({
    name: "add_approval_note",
    description: "Append a note to an approval without deciding it.",
    inputSchema: schema(
      {
        approvalId: S.string("Approval ID."),
        note: S.string("Note to append."),
        actorUserId: S.string("User adding the note."),
      },
      ["approvalId", "note", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const approval = requireApproval(state, readString(input, "approvalId"));
      const note = readString(input, "note");

      approval.notes.push(note);

      audit(state, user.id, "approval.note_added", "approval", approval.id, `Note added to ${approval.id}`);

      return approval;
    },
  }),

  defineTool({
    name: "reassign_approval",
    description:
      "Route a pending approval to a different approver, for example when it exceeds the current approver's limit.",
    inputSchema: schema(
      {
        approvalId: S.string("Approval ID."),
        assignToUserId: S.string("User who should decide instead."),
        reason: S.string("Why it is being reassigned."),
        actorUserId: S.string("User performing the action."),
      },
      ["approvalId", "assignToUserId", "actorUserId"],
    ),
    run(state, input) {
      const user = actor(state, readString(input, "actorUserId"));
      const approval = requireApproval(state, readString(input, "approvalId"));
      const assignee = requireUser(state, readString(input, "assignToUserId"));
      const reason = readOptionalString(input, "reason") ?? "Reassigned";

      if (approval.status !== "pending") {
        throw toolError(
          "invalid_state",
          `Approval ${approval.id} was already ${approval.status}.`,
        );
      }

      if (assignee.id === approval.assignedToUserId) {
        throw toolError("invalid_input", `Approval ${approval.id} is already assigned to ${assignee.id}.`);
      }

      const previous = approval.assignedToUserId;
      approval.assignedToUserId = assignee.id;
      approval.notes.push(`Reassigned from ${previous} to ${assignee.id}: ${reason}`);

      audit(state, user.id, "approval.reassigned", "approval", approval.id, `Reassigned ${approval.id} to ${assignee.name}`, [
        { field: "assignedToUserId", from: previous, to: assignee.id },
      ]);

      return approval;
    },
  }),

  defineTool({
    name: "check_approval_authority",
    description:
      "Check whether a user may approve a given amount, and if not, who can. Use this before attempting an approval that might exceed a limit.",
    inputSchema: schema(
      {
        userId: S.string("User whose authority is being checked."),
        amount: S.number("Amount to be approved.", { minimum: 0 }),
      },
      ["userId", "amount"],
    ),
    run(state, input) {
      const user = requireUser(state, readString(input, "userId"));
      const amount = input["amount"];

      if (typeof amount !== "number") {
        throw toolError("invalid_input", "\"amount\" must be a number.");
      }

      const money = { amount, currency: state.company.baseCurrency } as const;
      const authorised = withinApprovalLimit(user, money);

      const alternatives = Object.values(state.users)
        .filter((candidate) => candidate.isActive && withinApprovalLimit(candidate, money))
        .map((candidate) => ({
          userId: candidate.id,
          name: candidate.name,
          role: candidate.role,
          approvalLimit: candidate.approvalLimit,
        }))
        .sort((a, b) => (a.approvalLimit?.amount ?? 0) - (b.approvalLimit?.amount ?? 0));

      return {
        userId: user.id,
        name: user.name,
        role: user.role,
        approvalLimit: user.approvalLimit,
        requestedAmount: money,
        authorised,
        escalateTo: authorised ? [] : alternatives,
      };
    },
  }),
];
