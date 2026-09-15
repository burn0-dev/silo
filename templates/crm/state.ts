/**
 * CRM environment state.
 *
 * The shape of the simulated world, plus pure helpers that read it. No data
 * lives here and nothing here builds a world — that is `environment.ts`.
 *
 * Note which values are stored and which are computed. A stage carries the
 * probability; an opportunity does not. Weighted value and days-in-stage are
 * helpers rather than fields, because the agent can move an opportunity between
 * stages mid-rollout and a stored copy would go stale the moment it did.
 */

export type Currency = "USD";

export type Money = {
  amount: number;
  currency: Currency;
};

export type UserRole = "rep" | "manager";

export type User = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  managerId: string | null;
  quota: Money;
  active: boolean;
};

export type AccountTier = "enterprise" | "mid_market" | "smb";

export type Account = {
  id: string;
  name: string;
  industry: string;
  tier: AccountTier;
  ownerId: string;
  website: string | null;
  createdDate: string;
};

export type Contact = {
  id: string;
  accountId: string | null;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  title: string | null;
  isPrimary: boolean;
};

export type LeadStatus = "new" | "working" | "qualified" | "disqualified" | "converted";

export type LeadSource =
  | "web_form"
  | "referral"
  | "event"
  | "outbound"
  | "partner"
  | "inbound_call";

export type Lead = {
  id: string;
  firstName: string;
  lastName: string;
  company: string;
  email: string;
  phone: string | null;
  title: string | null;
  source: LeadSource;
  status: LeadStatus;
  ownerId: string;
  createdDate: string;
  lastContactedDate: string | null;
  disqualifyReason: string | null;
  /** Set by `convert_lead`; the three records the conversion produced or reused. */
  convertedAccountId: string | null;
  convertedContactId: string | null;
  convertedOpportunityId: string | null;
};

export type OpportunityStatus = "open" | "won" | "lost";

export type Opportunity = {
  id: string;
  name: string;
  accountId: string;
  primaryContactId: string | null;
  ownerId: string;
  /** Id of a row in `stages`. The probability lives there, not here. */
  stageId: string;
  amount: Money;
  expectedCloseDate: string;
  createdDate: string;
  /** When the opportunity entered its current stage — `daysInStage` reads this. */
  stageEnteredDate: string;
  status: OpportunityStatus;
  closedDate: string | null;
  lostReason: string | null;
  sourceLeadId: string | null;
};

export type PipelineStage = {
  id: string;
  name: string;
  /** Position in the pipeline, ascending. */
  order: number;
  /** Percentage, 0-100. The only place a probability is stored. */
  probability: number;
  /** A closed stage ends the opportunity; `advance_opportunity_stage` refuses it. */
  isClosed: boolean;
};

export type ActivityType = "call" | "email" | "meeting" | "note";

export type ActivityRelation = {
  type: "lead" | "account" | "contact" | "opportunity";
  id: string;
};

export type Activity = {
  id: string;
  type: ActivityType;
  subject: string;
  ownerId: string;
  relatedTo: ActivityRelation;
  dueDate: string | null;
  completedDate: string | null;
  notes: string | null;
};

export type AuditEvent = {
  id: string;
  at: string;
  actorUserId: string;
  action: string;
  entityType: string;
  entityId: string;
  detail: string;
};

export type State = {
  /** The simulation clock. Every "is it overdue / stale" question reads this. */
  now: string;
  users: Record<string, User>;
  accounts: Record<string, Account>;
  contacts: Record<string, Contact>;
  leads: Record<string, Lead>;
  opportunities: Record<string, Opportunity>;
  activities: Record<string, Activity>;
  stages: Record<string, PipelineStage>;
  auditLog: AuditEvent[];
  sequences: Record<string, number>;
};

// --- money -----------------------------------------------------------------

export function round2(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

export function money(amount: number, currency: Currency = "USD"): Money {
  return { amount: round2(amount), currency };
}

export function addMoney(a: Money, b: Money): Money {
  return money(a.amount + b.amount, a.currency);
}

export function sumMoney(values: Money[], currency: Currency = "USD"): Money {
  return money(
    values.reduce((total, value) => total + value.amount, 0),
    currency,
  );
}

// --- dates -----------------------------------------------------------------

export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate.slice(0, 10)}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);

  return date.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from.slice(0, 10)}T00:00:00.000Z`);
  const end = Date.parse(`${to.slice(0, 10)}T00:00:00.000Z`);

  return Math.round((end - start) / 86_400_000);
}

// --- pipeline --------------------------------------------------------------

/**
 * The stage an opportunity is in.
 *
 * Returns null for a dangling stage id rather than throwing, so reporting over
 * a large pipeline cannot be taken down by one bad row.
 */
export function stageOf(state: State, opportunity: Opportunity): PipelineStage | null {
  return state.stages[opportunity.stageId] ?? null;
}

/** Win probability as a percentage, read from the opportunity's stage. */
export function probabilityOf(state: State, opportunity: Opportunity): number {
  if (opportunity.status === "won") return 100;
  if (opportunity.status === "lost") return 0;

  return stageOf(state, opportunity)?.probability ?? 0;
}

/**
 * Amount weighted by stage probability.
 *
 * A helper rather than a stored field: both the amount and the stage change
 * during a rollout, and a stored copy would be wrong immediately afterwards.
 */
export function weightedAmount(state: State, opportunity: Opportunity): Money {
  return money(
    (opportunity.amount.amount * probabilityOf(state, opportunity)) / 100,
    opportunity.amount.currency,
  );
}

/** How long the opportunity has sat in its current stage, as of `state.now`. */
export function daysInStage(state: State, opportunity: Opportunity): number {
  return daysBetween(opportunity.stageEnteredDate, state.now);
}

/** Age of the opportunity in days, as of `state.now`. */
export function ageInDays(state: State, createdDate: string): number {
  return daysBetween(createdDate, state.now);
}

/** Days in one stage after which an open opportunity is considered stale. */
export const STALE_STAGE_DAYS = 30;

/**
 * An open opportunity that has not moved for longer than `threshold` days.
 * Closed opportunities are never stale — they are finished, not stuck.
 */
export function isStale(state: State, opportunity: Opportunity, threshold: number): boolean {
  return opportunity.status === "open" && daysInStage(state, opportunity) > threshold;
}

/** An open opportunity whose expected close date has already passed. */
export function isPastDue(state: State, opportunity: Opportunity): boolean {
  return (
    opportunity.status === "open" &&
    daysBetween(opportunity.expectedCloseDate, state.now) > 0
  );
}

export function stagesInOrder(state: State): PipelineStage[] {
  return Object.values(state.stages).sort((a, b) => a.order - b.order);
}

/** The next open stage after this one, or null at the end of the pipeline. */
export function nextStage(state: State, stageId: string): PipelineStage | null {
  const ordered = stagesInOrder(state);
  const index = ordered.findIndex((stage) => stage.id === stageId);

  if (index === -1) return null;

  return ordered.slice(index + 1).find((stage) => !stage.isClosed) ?? null;
}

// --- people ----------------------------------------------------------------

export function fullName(person: { firstName: string; lastName: string }): string {
  return `${person.firstName} ${person.lastName}`;
}

export function contactsForAccount(state: State, accountId: string): Contact[] {
  return Object.values(state.contacts)
    .filter((contact) => contact.accountId === accountId)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function opportunitiesForAccount(state: State, accountId: string): Opportunity[] {
  return Object.values(state.opportunities)
    .filter((opportunity) => opportunity.accountId === accountId)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function opportunitiesOwnedBy(state: State, ownerId: string): Opportunity[] {
  return Object.values(state.opportunities)
    .filter((opportunity) => opportunity.ownerId === ownerId)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function activitiesFor(
  state: State,
  relation: ActivityRelation,
): Activity[] {
  return Object.values(state.activities)
    .filter(
      (activity) =>
        activity.relatedTo.type === relation.type && activity.relatedTo.id === relation.id,
    )
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Total open pipeline owned by a rep, unweighted. */
export function openPipelineFor(state: State, ownerId: string): Money {
  return sumMoney(
    opportunitiesOwnedBy(state, ownerId)
      .filter((opportunity) => opportunity.status === "open")
      .map((opportunity) => opportunity.amount),
  );
}

/** Closed-won total for a rep, used to measure attainment against quota. */
export function wonAmountFor(state: State, ownerId: string): Money {
  return sumMoney(
    opportunitiesOwnedBy(state, ownerId)
      .filter((opportunity) => opportunity.status === "won")
      .map((opportunity) => opportunity.amount),
  );
}

// --- ids and audit ---------------------------------------------------------

export function formatId(prefix: string, value: number, pad = 3): string {
  return `${prefix}-${String(value).padStart(pad, "0")}`;
}

/** Next id in a sequence, advancing the counter stored in state. */
export function nextId(state: State, prefix: string, pad = 3): string {
  const next = (state.sequences[prefix] ?? 0) + 1;
  state.sequences[prefix] = next;

  return formatId(prefix, next, pad);
}

export function indexById<T extends { id: string }>(rows: T[]): Record<string, T> {
  return Object.fromEntries(rows.map((row) => [row.id, row]));
}

export function recordAudit(
  state: State,
  event: Omit<AuditEvent, "id" | "at">,
): AuditEvent {
  const entry: AuditEvent = { id: nextId(state, "AUD", 4), at: state.now, ...event };
  state.auditLog.push(entry);

  return entry;
}
