/**
 * A scripted agent that solves each CRM task correctly.
 *
 * Deterministic on purpose. Its job is to prove the verifiers pass on correct
 * work — the no-op agent proves they do not pass on no work at all. Between the
 * two, a verifier that always passes or always fails is visible.
 *
 * It dispatches on the task instruction, the same text a model would read.
 */

type ToolResult = { output: unknown; isError?: boolean };

type AgentInput = {
  task: string;
  tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
  callTool: (name: string, input: unknown) => Promise<ToolResult>;
  signal: AbortSignal;
};

type Call = (name: string, input: unknown) => Promise<ToolResult>;

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function amountOf(value: unknown): number | null {
  const money = asRecord(value);

  return typeof money["amount"] === "number" ? money["amount"] : null;
}

async function convertFjordLead(callTool: Call): Promise<string> {
  const found = await callTool("search_leads", { query: "Fjord Maritime" });
  const lead = asRecord(asArray(asRecord(found.output)["results"])[0]);
  const leadId = lead["id"];

  if (typeof leadId !== "string") {
    return "Could not find the Fjord Maritime lead.";
  }

  const converted = await callTool("convert_lead", {
    leadId,
    createOpportunity: true,
    opportunityName: "Fjord Maritime fleet rollout",
    amount: 140000,
    expectedCloseDate: "2026-06-30",
    actorUserId: "USR-002",
  });

  if (converted.isError) {
    return `Conversion failed: ${JSON.stringify(converted.output)}`;
  }

  const result = asRecord(converted.output);
  const opportunity = asRecord(result["opportunity"]);

  return `Converted ${leadId} into account ${String(asRecord(result["account"])["id"])}, contact ${String(
    asRecord(result["contact"])["id"],
  )} and opportunity ${String(opportunity["id"])} worth 140000, closing 2026-06-30.`;
}

async function rehomeDepartedPipeline(callTool: Call): Promise<string> {
  const open = await callTool("list_opportunities", { ownerId: "USR-004", status: "open" });
  const rows = asArray(asRecord(open.output)["results"]);
  const moved: string[] = [];

  for (const row of rows) {
    const id = asRecord(row)["id"];

    if (typeof id !== "string") continue;

    const result = await callTool("reassign_opportunity", {
      opportunityId: id,
      newOwnerId: "USR-003",
      actorUserId: "USR-001",
    });

    if (!result.isError) moved.push(id);
  }

  return `Moved ${moved.length} open opportunities (${moved.join(", ")}) from USR-004 to USR-003.`;
}

async function bookLumenWin(callTool: Call): Promise<string> {
  const won = await callTool("close_opportunity_won", {
    opportunityId: "OPP-007",
    finalAmount: 118000,
    actorUserId: "USR-005",
  });

  if (won.isError) {
    return `Could not close OPP-007: ${JSON.stringify(won.output)}`;
  }

  await callTool("log_activity", {
    type: "note",
    subject: "Signed contract received",
    relatedType: "opportunity",
    relatedId: "OPP-007",
    ownerId: "USR-005",
    notes: "Countersigned contract returned today at the agreed 118000.",
    actorUserId: "USR-005",
  });

  return "Closed OPP-007 as won at 118000 and noted that the signed contract arrived today.";
}

async function reportWeightedPipeline(callTool: Call): Promise<string> {
  const forecast = await callTool("forecast_report", {});
  const weighted = amountOf(asRecord(forecast.output)["weightedAmount"]);

  if (weighted === null) {
    return "Could not read the weighted pipeline total.";
  }

  return `The probability-weighted value of all open pipeline is ${weighted}`;
}

async function reportStalledLeader(callTool: Call): Promise<string> {
  const stale = await callTool("stale_opportunities", {});
  const top = asRecord(asArray(asRecord(stale.output)["countByOwner"])[0]);
  const name = top["name"];
  const count = top["count"];

  if (typeof name !== "string" || typeof count !== "number") {
    return "Could not determine which rep has the most stalled deals.";
  }

  return `${name} has the most stalled deals, with ${count}`;
}

async function reportWeakestActiveRep(callTool: Call): Promise<string> {
  const performance = await callTool("rep_performance", { activeOnly: true });
  const rows = asArray(asRecord(performance.output)["results"])
    .map(asRecord)
    .filter((row) => typeof row["quotaAttainmentPercent"] === "number");

  const weakest = rows.sort(
    (a, b) => (a["quotaAttainmentPercent"] as number) - (b["quotaAttainmentPercent"] as number),
  )[0];

  if (!weakest) {
    return "Could not determine quota attainment.";
  }

  return `${String(weakest["name"])} is furthest behind, at ${String(
    weakest["quotaAttainmentPercent"],
  )}% of quota`;
}

export default async function crmSolverAgent({ task, callTool }: AgentInput) {
  if (task.includes("Fjord Maritime")) {
    return { output: await convertFjordLead(callTool) };
  }

  if (task.includes("Tomas Bergstrom")) {
    return { output: await rehomeDepartedPipeline(callTool) };
  }

  if (task.includes("Lumen Retail")) {
    return { output: await bookLumenWin(callTool) };
  }

  if (task.includes("probability-weighted")) {
    return { output: await reportWeightedPipeline(callTool) };
  }

  if (task.includes("not moved stage")) {
    return { output: await reportStalledLeader(callTool) };
  }

  if (task.includes("quota attainment")) {
    return { output: await reportWeakestActiveRep(callTool) };
  }

  return { output: "No scripted solution for this task." };
}
