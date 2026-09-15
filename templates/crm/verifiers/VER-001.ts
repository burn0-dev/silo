/**
 * Grades TASK-001 by inspecting the world the rollout left behind.
 *
 * A conversion is only correct if all three records exist and point at each
 * other. Checking the lead's status alone would pass an agent that flipped a
 * field and created nothing.
 */

import { check, defineVerifier, optional } from "@burn0/silo";

import type { State } from "../state.js";

const LEAD_ID = "LEAD-004";
const EXPECTED_AMOUNT = 140000;
const EXPECTED_CLOSE_DATE = "2026-06-30";

export const ver001 = defineVerifier<State>({
  id: "VER-001",
  taskId: "TASK-001",
  name: "Lead converted into a linked account, contact and opportunity",
  check(final, initial) {
    const lead = final.leads[LEAD_ID];
    const accountId = lead?.convertedAccountId ?? null;
    const contactId = lead?.convertedContactId ?? null;
    const opportunityId = lead?.convertedOpportunityId ?? null;

    const account = accountId ? final.accounts[accountId] : undefined;
    const contact = contactId ? final.contacts[contactId] : undefined;
    const opportunity = opportunityId ? final.opportunities[opportunityId] : undefined;

    return [
      check(
        "The lead is marked converted",
        lead?.status === "converted",
        `status = ${lead?.status ?? "missing"}`,
      ),
      check(
        "The conversion produced an opportunity",
        opportunity !== undefined,
        `convertedOpportunityId = ${opportunityId ?? "null"}`,
      ),
      check(
        "The opportunity is worth the agreed amount",
        opportunity?.amount.amount === EXPECTED_AMOUNT,
        `amount = ${opportunity?.amount.amount ?? "missing"}, expected ${EXPECTED_AMOUNT}`,
      ),
      check(
        "The opportunity closes on the agreed date",
        opportunity?.expectedCloseDate === EXPECTED_CLOSE_DATE,
        `expectedCloseDate = ${opportunity?.expectedCloseDate ?? "missing"}`,
      ),
      check(
        "The opportunity points back at the lead it came from",
        opportunity?.sourceLeadId === LEAD_ID,
        `sourceLeadId = ${opportunity?.sourceLeadId ?? "null"}`,
      ),
      check(
        "The conversion produced a contact on the new account",
        contact !== undefined && account !== undefined && contact.accountId === account.id,
        `contact ${contactId ?? "null"} -> account ${contact?.accountId ?? "null"}`,
      ),
      check(
        "The opportunity sits on the same account as the contact",
        opportunity !== undefined && account !== undefined && opportunity.accountId === account.id,
        `opportunity account = ${opportunity?.accountId ?? "null"}, account = ${accountId ?? "null"}`,
      ),
      optional(
        "The account is new rather than an existing customer",
        accountId !== null && initial.accounts[accountId] === undefined,
        `${accountId ?? "null"} existed before = ${accountId !== null && initial.accounts[accountId] !== undefined}`,
      ),
      optional(
        "The opportunity is open",
        opportunity?.status === "open",
        `status = ${opportunity?.status ?? "missing"}`,
      ),
      optional(
        "The deal stayed with the lead's owner",
        opportunity?.ownerId === initial.leads[LEAD_ID]?.ownerId,
        `owner = ${opportunity?.ownerId ?? "missing"}`,
      ),
    ];
  },
});
