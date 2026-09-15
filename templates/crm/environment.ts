/**
 * Builds the CRM world each rollout starts from.
 *
 * `data/` holds facts: ids, names, amounts, stage ids, dates, statuses. Nothing
 * here computes a forecast or a days-in-stage figure — those depend on the
 * stage an opportunity is in, which the agent can change during a rollout, so
 * they are helpers in `state.ts` rather than fields baked in at load.
 *
 * Node caches imported JSON modules for the life of the process, so the
 * assembled world is cloned before it is handed to a rollout.
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
  indexById,
} from "./state.js";

import accountsData from "./data/accounts.json" with { type: "json" };
import activitiesData from "./data/activities.json" with { type: "json" };
import auditLogData from "./data/auditLog.json" with { type: "json" };
import contactsData from "./data/contacts.json" with { type: "json" };
import leadsData from "./data/leads.json" with { type: "json" };
import opportunitiesData from "./data/opportunities.json" with { type: "json" };
import sequencesData from "./data/sequences.json" with { type: "json" };
import stagesData from "./data/stages.json" with { type: "json" };
import usersData from "./data/users.json" with { type: "json" };

/**
 * The date every rollout starts from.
 *
 * Fixed rather than `new Date()` so that "stale", "past due" and every forecast
 * figure are reproducible. A real clock would make grading depend on when the
 * test ran.
 */
export const SIMULATION_NOW = "2026-03-16";

export function createState(): State {
  return structuredClone({
    now: SIMULATION_NOW,
    users: indexById(usersData as User[]),
    accounts: indexById(accountsData as Account[]),
    contacts: indexById(contactsData as Contact[]),
    leads: indexById(leadsData as Lead[]),
    opportunities: indexById(opportunitiesData as Opportunity[]),
    activities: indexById(activitiesData as Activity[]),
    stages: indexById(stagesData as PipelineStage[]),
    auditLog: auditLogData as AuditEvent[],
    sequences: sequencesData as Record<string, number>,
  });
}
