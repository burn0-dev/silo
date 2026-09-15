/**
 * Lookup, summary and mutation helpers shared by every tool domain.
 *
 * Summaries are where derived numbers surface. The agent never sees state, so
 * anything computed — win probability, weighted amount, days in stage — has to
 * be put into a tool's output or it does not exist as far as the agent is
 * concerned.
 */

import {
  type Account,
  type Activity,
  type AuditEvent,
  type Contact,
  type Lead,
  type Opportunity,
  type PipelineStage,
  type State,
  type User,
  ageInDays,
  daysInStage,
  fullName,
  isPastDue,
  probabilityOf,
  recordAudit,
  stageOf,
  weightedAmount,
} from "../state.js";
import { toolError } from "./contract.js";

function require_<T>(collection: Record<string, T>, id: string, label: string): T {
  const value = collection[id];

  if (!value) {
    throw toolError("not_found", `${label} "${id}" was not found.`);
  }

  return value;
}

export const requireUser = (state: State, id: string): User =>
  require_(state.users, id, "User");

export const requireAccount = (state: State, id: string): Account =>
  require_(state.accounts, id, "Account");

export const requireContact = (state: State, id: string): Contact =>
  require_(state.contacts, id, "Contact");

export const requireLead = (state: State, id: string): Lead =>
  require_(state.leads, id, "Lead");

export const requireOpportunity = (state: State, id: string): Opportunity =>
  require_(state.opportunities, id, "Opportunity");

export const requireStage = (state: State, id: string): PipelineStage =>
  require_(state.stages, id, "Stage");

export const requireActivity = (state: State, id: string): Activity =>
  require_(state.activities, id, "Activity");

/**
 * The user performing an action.
 *
 * A deactivated user cannot act. That is what makes reassigning their open work
 * a real task rather than a formality — the agent cannot simply keep using them.
 */
export function actor(state: State, id: string): User {
  const user = requireUser(state, id);

  if (!user.active) {
    throw toolError("not_allowed", `User "${id}" (${user.name}) is deactivated and cannot act.`);
  }

  return user;
}

/** An owner must exist and still be active — closed work keeps its old owner. */
export function assertAssignable(state: State, id: string): User {
  const user = requireUser(state, id);

  if (!user.active) {
    throw toolError(
      "not_allowed",
      `User "${id}" (${user.name}) is deactivated and cannot own records.`,
    );
  }

  return user;
}

export function assertOpen(opportunity: Opportunity): void {
  if (opportunity.status !== "open") {
    throw toolError(
      "not_allowed",
      `Opportunity ${opportunity.id} is ${opportunity.status} and can no longer be changed.`,
    );
  }
}

export function audit(
  state: State,
  actorUserId: string,
  action: string,
  entityType: string,
  entityId: string,
  detail: string,
): AuditEvent {
  return recordAudit(state, { actorUserId, action, entityType, entityId, detail });
}

// --- summaries -------------------------------------------------------------

export function userSummary(user: User) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    managerId: user.managerId,
    quota: user.quota,
    active: user.active,
  };
}

export function accountSummary(state: State, account: Account) {
  return {
    id: account.id,
    name: account.name,
    industry: account.industry,
    tier: account.tier,
    ownerId: account.ownerId,
    ownerName: state.users[account.ownerId]?.name ?? null,
    website: account.website,
    createdDate: account.createdDate,
  };
}

export function contactSummary(state: State, contact: Contact) {
  return {
    id: contact.id,
    name: fullName(contact),
    accountId: contact.accountId,
    accountName: contact.accountId ? (state.accounts[contact.accountId]?.name ?? null) : null,
    email: contact.email,
    phone: contact.phone,
    title: contact.title,
    isPrimary: contact.isPrimary,
  };
}

export function leadSummary(state: State, lead: Lead) {
  return {
    id: lead.id,
    name: fullName(lead),
    company: lead.company,
    email: lead.email,
    phone: lead.phone,
    title: lead.title,
    source: lead.source,
    status: lead.status,
    ownerId: lead.ownerId,
    ownerName: state.users[lead.ownerId]?.name ?? null,
    createdDate: lead.createdDate,
    ageDays: ageInDays(state, lead.createdDate),
    lastContactedDate: lead.lastContactedDate,
    disqualifyReason: lead.disqualifyReason,
    convertedAccountId: lead.convertedAccountId,
    convertedContactId: lead.convertedContactId,
    convertedOpportunityId: lead.convertedOpportunityId,
  };
}

/**
 * An opportunity as the agent sees it.
 *
 * `probability`, `weightedAmount` and `daysInStage` are computed here on every
 * read rather than stored, so they stay correct after the agent moves a stage.
 */
export function opportunitySummary(state: State, opportunity: Opportunity) {
  const stage = stageOf(state, opportunity);

  return {
    id: opportunity.id,
    name: opportunity.name,
    accountId: opportunity.accountId,
    accountName: state.accounts[opportunity.accountId]?.name ?? null,
    primaryContactId: opportunity.primaryContactId,
    ownerId: opportunity.ownerId,
    ownerName: state.users[opportunity.ownerId]?.name ?? null,
    stageId: opportunity.stageId,
    stageName: stage?.name ?? null,
    probability: probabilityOf(state, opportunity),
    amount: opportunity.amount,
    weightedAmount: weightedAmount(state, opportunity),
    expectedCloseDate: opportunity.expectedCloseDate,
    createdDate: opportunity.createdDate,
    stageEnteredDate: opportunity.stageEnteredDate,
    daysInStage: daysInStage(state, opportunity),
    pastDue: isPastDue(state, opportunity),
    status: opportunity.status,
    closedDate: opportunity.closedDate,
    lostReason: opportunity.lostReason,
    sourceLeadId: opportunity.sourceLeadId,
  };
}

export function activitySummary(state: State, activity: Activity) {
  return {
    id: activity.id,
    type: activity.type,
    subject: activity.subject,
    ownerId: activity.ownerId,
    ownerName: state.users[activity.ownerId]?.name ?? null,
    relatedTo: activity.relatedTo,
    dueDate: activity.dueDate,
    completedDate: activity.completedDate,
    open: activity.completedDate === null,
    notes: activity.notes,
  };
}

export function stageSummary(stage: PipelineStage) {
  return {
    id: stage.id,
    name: stage.name,
    order: stage.order,
    probability: stage.probability,
    isClosed: stage.isClosed,
  };
}
