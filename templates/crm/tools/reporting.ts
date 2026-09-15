/**
 * Read-only rollups over the pipeline.
 *
 * Everything here is computed from the live world on each call. Nothing is
 * cached and nothing is stored, so a report taken after the agent has changed
 * a stage reflects the change.
 */

import {
  STALE_STAGE_DAYS,
  daysInStage,
  isStale,
  openPipelineFor,
  stagesInOrder,
  sumMoney,
  weightedAmount,
  wonAmountFor,
} from "../state.js";
import {
  S,
  defineTool,
  readBoolean,
  readOptionalDate,
  readOptionalNumber,
  readOptionalString,
  schema,
} from "./contract.js";
import { requireUser } from "./helpers.js";

export const reportingTools = [
  defineTool({
    name: "pipeline_summary",
    description:
      "Open pipeline broken down by stage: how many deals sit in each, their total value and their probability-weighted value.",
    inputSchema: schema({
      ownerId: S.string("Restrict the summary to one owner."),
    }),
    run(state, input) {
      const ownerId = readOptionalString(input, "ownerId");

      if (ownerId) requireUser(state, ownerId);

      const open = Object.values(state.opportunities)
        .filter((opportunity) => opportunity.status === "open")
        .filter((opportunity) => (ownerId ? opportunity.ownerId === ownerId : true));

      const byStage = stagesInOrder(state)
        .filter((stage) => !stage.isClosed)
        .map((stage) => {
          const rows = open.filter((opportunity) => opportunity.stageId === stage.id);

          return {
            stageId: stage.id,
            stageName: stage.name,
            probability: stage.probability,
            count: rows.length,
            amount: sumMoney(rows.map((opportunity) => opportunity.amount)),
            weightedAmount: sumMoney(
              rows.map((opportunity) => weightedAmount(state, opportunity)),
            ),
          };
        });

      return {
        ownerId: ownerId ?? null,
        openCount: open.length,
        totalAmount: sumMoney(open.map((opportunity) => opportunity.amount)),
        totalWeightedAmount: sumMoney(
          open.map((opportunity) => weightedAmount(state, opportunity)),
        ),
        byStage,
      };
    },
  }),

  defineTool({
    name: "forecast_report",
    description:
      "Probability-weighted forecast for open opportunities. Each deal contributes its amount multiplied by its stage probability. Optionally limit to deals expected to close on or before a date.",
    inputSchema: schema({
      ownerId: S.string("Restrict the forecast to one owner."),
      closingOnOrBefore: S.string("Only deals with an expected close date on or before this date."),
      includeClosed: S.boolean("Include already won deals in the total (default false)."),
    }),
    run(state, input) {
      const ownerId = readOptionalString(input, "ownerId");
      const closingOnOrBefore = readOptionalDate(input, "closingOnOrBefore");
      const includeClosed = readBoolean(input, "includeClosed", false);

      if (ownerId) requireUser(state, ownerId);

      const rows = Object.values(state.opportunities)
        .filter((opportunity) =>
          includeClosed
            ? opportunity.status !== "lost"
            : opportunity.status === "open",
        )
        .filter((opportunity) => (ownerId ? opportunity.ownerId === ownerId : true))
        .filter((opportunity) =>
          closingOnOrBefore ? opportunity.expectedCloseDate <= closingOnOrBefore : true,
        )
        .sort((a, b) => a.id.localeCompare(b.id));

      return {
        ownerId: ownerId ?? null,
        closingOnOrBefore: closingOnOrBefore ?? null,
        includeClosed,
        count: rows.length,
        totalAmount: sumMoney(rows.map((opportunity) => opportunity.amount)),
        weightedAmount: sumMoney(rows.map((opportunity) => weightedAmount(state, opportunity))),
        opportunities: rows.map((opportunity) => ({
          id: opportunity.id,
          name: opportunity.name,
          ownerId: opportunity.ownerId,
          stageId: opportunity.stageId,
          amount: opportunity.amount,
          weightedAmount: weightedAmount(state, opportunity),
          expectedCloseDate: opportunity.expectedCloseDate,
        })),
      };
    },
  }),

  defineTool({
    name: "rep_performance",
    description:
      "Quota attainment per sales rep: closed-won total against quota, plus open pipeline. Attainment is null for users without a quota.",
    inputSchema: schema({
      activeOnly: S.boolean("Only users who are still active (default false)."),
    }),
    run(state, input) {
      const activeOnly = readBoolean(input, "activeOnly", false);

      const reps = Object.values(state.users)
        .filter((user) => user.role === "rep")
        .filter((user) => (activeOnly ? user.active : true))
        .sort((a, b) => a.id.localeCompare(b.id));

      return {
        activeOnly,
        results: reps.map((rep) => {
          const won = wonAmountFor(state, rep.id);

          return {
            userId: rep.id,
            name: rep.name,
            active: rep.active,
            quota: rep.quota,
            closedWon: won,
            openPipeline: openPipelineFor(state, rep.id),
            quotaAttainmentPercent:
              rep.quota.amount === 0
                ? null
                : Math.round((won.amount / rep.quota.amount) * 1000) / 10,
          };
        }),
      };
    },
  }),

  defineTool({
    name: "stale_opportunities",
    description:
      "Open opportunities that have not changed stage recently, newest first by how long they have been stuck. Use this to find deals that need attention.",
    inputSchema: schema({
      thresholdDays: S.integer(
        `Days in one stage before a deal counts as stale (default ${STALE_STAGE_DAYS}).`,
        { minimum: 1 },
      ),
      ownerId: S.string("Restrict to one owner."),
    }),
    run(state, input) {
      const threshold =
        readOptionalNumber(input, "thresholdDays", { min: 1, integer: true }) ?? STALE_STAGE_DAYS;
      const ownerId = readOptionalString(input, "ownerId");

      if (ownerId) requireUser(state, ownerId);

      const rows = Object.values(state.opportunities)
        .filter((opportunity) => isStale(state, opportunity, threshold))
        .filter((opportunity) => (ownerId ? opportunity.ownerId === ownerId : true))
        .sort((a, b) => daysInStage(state, b) - daysInStage(state, a) || a.id.localeCompare(b.id));

      const byOwner = new Map<string, number>();

      for (const opportunity of rows) {
        byOwner.set(opportunity.ownerId, (byOwner.get(opportunity.ownerId) ?? 0) + 1);
      }

      return {
        thresholdDays: threshold,
        ownerId: ownerId ?? null,
        count: rows.length,
        totalAmount: sumMoney(rows.map((opportunity) => opportunity.amount)),
        countByOwner: [...byOwner.entries()]
          .map(([userId, count]) => ({
            userId,
            name: state.users[userId]?.name ?? null,
            count,
          }))
          .sort((a, b) => b.count - a.count || a.userId.localeCompare(b.userId)),
        opportunities: rows.map((opportunity) => ({
          id: opportunity.id,
          name: opportunity.name,
          ownerId: opportunity.ownerId,
          ownerName: state.users[opportunity.ownerId]?.name ?? null,
          stageId: opportunity.stageId,
          amount: opportunity.amount,
          daysInStage: daysInStage(state, opportunity),
          expectedCloseDate: opportunity.expectedCloseDate,
        })),
      };
    },
  }),
];
