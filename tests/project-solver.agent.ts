/**
 * A scripted agent that solves each project-tracking task correctly.
 *
 * Deterministic on purpose. Its job is to prove the verifiers pass on correct
 * work — the no-op agent proves they do not pass on no work at all. Between the
 * two, a verifier that always passes or always fails is visible.
 *
 * It dispatches on the task instruction, the same text a model would read, and
 * it looks things up through the tools rather than hardcoding ids, so
 * renumbering the seed data does not break it.
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

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

async function rows(callTool: Call, tool: string, input: unknown): Promise<Record<string, unknown>[]> {
  const result = await callTool(tool, input);

  return asArray(asRecord(result.output)["results"]).map(asRecord);
}

/** The id of the first workflow state that counts as finished. */
async function doneStatusId(callTool: Call): Promise<string | null> {
  const states = await rows(callTool, "list_workflow_states", {});

  return str(states.find((state) => state["isDone"] === true)?.["id"]);
}

async function statusIdNamed(callTool: Call, name: string): Promise<string | null> {
  const states = await rows(callTool, "list_workflow_states", {});

  return str(states.find((state) => state["name"] === name)?.["id"]);
}

async function findWorkItem(callTool: Call, query: string): Promise<Record<string, unknown> | null> {
  const found = await rows(callTool, "search_work_items", { query });

  return found[0] ?? null;
}

async function findProjectId(callTool: Call, query: string): Promise<string | null> {
  const found = await rows(callTool, "search_projects", { query });

  return str(found[0]?.["id"]);
}

async function findMemberId(callTool: Call, query: string): Promise<string | null> {
  const found = await rows(callTool, "search_members", { query });

  return str(found[0]?.["id"]);
}

async function findSprint(
  callTool: Call,
  name: string,
): Promise<Record<string, unknown> | null> {
  const sprints = await rows(callTool, "list_sprints", {});

  return sprints.find((sprint) => sprint["name"] === name) ?? null;
}

// --- state-changing tasks --------------------------------------------------

async function signOffTaxRules(callTool: Call): Promise<string> {
  const item = await findWorkItem(callTool, "Tax rules engine");
  const status = await doneStatusId(callTool);
  const id = str(item?.["id"]);

  if (!id || !status) return "Could not find the tax rules engine work item.";

  const result = await callTool("set_work_item_status", {
    workItemId: id,
    status,
    actorMemberId: "MEM-001",
  });

  if (result.isError) return `Could not close ${id}: ${JSON.stringify(result.output)}`;

  return `Marked ${id} (tax rules engine) as done.`;
}

async function landRetryScheduler(callTool: Call): Promise<string> {
  const item = await findWorkItem(callTool, "Payment retry scheduler");
  const id = str(item?.["id"]);
  const status = await doneStatusId(callTool);

  if (!id || !status) return "Could not find the payment retry scheduler.";

  const detail = asRecord((await callTool("get_work_item", { workItemId: id })).output);
  const blockers = asArray(detail["unresolvedDependencies"]).map(String);
  const closed: string[] = [];

  for (const blockerId of blockers) {
    const result = await callTool("set_work_item_status", {
      workItemId: blockerId,
      status,
      actorMemberId: "MEM-001",
    });

    if (!result.isError) closed.push(blockerId);
  }

  const final = await callTool("set_work_item_status", {
    workItemId: id,
    status,
    actorMemberId: "MEM-001",
  });

  if (final.isError) return `Could not close ${id}: ${JSON.stringify(final.output)}`;

  return `Closed the blocking work (${closed.join(", ") || "none"}) and then finished ${id}.`;
}

async function rehomeDepartedWork(callTool: Call): Promise<string> {
  const departedId = await findMemberId(callTool, "Devon Ito");
  const newOwnerId = await findMemberId(callTool, "Farid Haddad");

  if (!departedId || !newOwnerId) return "Could not identify the members involved.";

  const open = await rows(callTool, "list_work_items", {
    assigneeId: departedId,
    openOnly: true,
  });

  const moved: string[] = [];

  for (const item of open) {
    const id = str(item["id"]);

    if (!id) continue;

    const result = await callTool("assign_work_item", {
      workItemId: id,
      assigneeId: newOwnerId,
      actorMemberId: "MEM-005",
    });

    if (!result.isError) moved.push(id);
  }

  return `Moved ${moved.length} unfinished work items (${moved.join(", ")}) from ${departedId} to ${newOwnerId}.`;
}

async function assignUsageMetering(callTool: Call): Promise<string> {
  const item = await findWorkItem(callTool, "Usage metering");
  const id = str(item?.["id"]);
  const points = num(item?.["estimatePoints"]);

  if (!id || points === null) return "Could not find the usage metering work item.";

  const teams = await rows(callTool, "list_teams", {});
  const platformId = str(teams.find((team) => team["name"] === "Platform")?.["id"]);

  if (!platformId) return "Could not find the Platform team.";

  const load = await rows(callTool, "member_load", { teamId: platformId, activeOnly: true });

  const candidates = load
    .map((row) => ({
      id: str(row["memberId"]),
      remainingAfter: (num(row["remainingCapacityPoints"]) ?? 0) - points,
    }))
    .filter((candidate) => candidate.id !== null && candidate.remainingAfter >= 0)
    .sort(
      (a, b) => a.remainingAfter - b.remainingAfter || (a.id ?? "").localeCompare(b.id ?? ""),
    );

  const chosen = candidates[0];

  if (!chosen?.id) return "Nobody on the Platform team can absorb the estimate.";

  const result = await callTool("assign_work_item", {
    workItemId: id,
    assigneeId: chosen.id,
    actorMemberId: "MEM-001",
  });

  if (result.isError) return `Could not assign ${id}: ${JSON.stringify(result.output)}`;

  return `Assigned ${id} (${points} points) to ${chosen.id}, who has ${chosen.remainingAfter} points of room left afterwards.`;
}

async function noteTheBlocker(callTool: Call): Promise<string> {
  const bug = await findWorkItem(callTool, "Duplicate invoice emails");
  const blocker = await findWorkItem(callTool, "Email service upgrade");
  const bugId = str(bug?.["id"]);
  const blockerId = str(blocker?.["id"]);

  if (!bugId || !blockerId) return "Could not find the bug or its blocker.";

  const result = await callTool("add_comment", {
    workItemId: bugId,
    body: `Held up by ${blockerId} (email service upgrade); nothing can move here until that lands.`,
    actorMemberId: "MEM-008",
  });

  if (result.isError) return `Could not comment on ${bugId}: ${JSON.stringify(result.output)}`;

  return `Commented on ${bugId} that it is waiting on ${blockerId}.`;
}

async function fillNextSprint(callTool: Call): Promise<string> {
  const projectId = await findProjectId(callTool, "ATL");
  const sprint = await findSprint(callTool, "Atlas Sprint 13");
  const sprintId = str(sprint?.["id"]);
  const backlogId = await statusIdNamed(callTool, "Backlog");

  if (!projectId || !sprintId || !backlogId) return "Could not find the project or the sprint.";

  const backlog = await rows(callTool, "list_work_items", {
    projectId,
    status: backlogId,
    unassigned: true,
  });

  const moved: string[] = [];

  for (const item of backlog) {
    const id = str(item["id"]);

    if (!id) continue;

    const result = await callTool("move_work_item_to_sprint", {
      workItemId: id,
      sprintId,
      actorMemberId: "MEM-001",
    });

    if (!result.isError) moved.push(id);
  }

  return `Moved ${moved.length} unassigned backlog items (${moved.join(", ")}) into ${sprintId}.`;
}

async function turnOverSprint(callTool: Call): Promise<string> {
  const finished = await findSprint(callTool, "Atlas Sprint 12");
  const next = await findSprint(callTool, "Atlas Sprint 13");
  const finishedId = str(finished?.["id"]);
  const nextId = str(next?.["id"]);

  if (!finishedId || !nextId) return "Could not find the sprints.";

  const completed = await callTool("complete_sprint", {
    sprintId: finishedId,
    actorMemberId: "MEM-001",
  });

  if (completed.isError) {
    return `Could not complete ${finishedId}: ${JSON.stringify(completed.output)}`;
  }

  const started = await callTool("start_sprint", { sprintId: nextId, actorMemberId: "MEM-001" });

  if (started.isError) return `Could not start ${nextId}: ${JSON.stringify(started.output)}`;

  return `Completed ${finishedId} and started ${nextId}.`;
}

async function closeLedgerProject(callTool: Call): Promise<string> {
  const projectId = await findProjectId(callTool, "LED");
  const status = await doneStatusId(callTool);

  if (!projectId || !status) return "Could not find the ledger migration project.";

  const open = await rows(callTool, "list_work_items", { projectId, openOnly: true });
  const finished: string[] = [];

  for (const item of open) {
    const id = str(item["id"]);

    if (!id) continue;

    const result = await callTool("set_work_item_status", {
      workItemId: id,
      status,
      actorMemberId: "MEM-007",
    });

    if (!result.isError) finished.push(id);
  }

  const closed = await callTool("close_project", { projectId, actorMemberId: "MEM-007" });

  if (closed.isError) {
    return `Could not close ${projectId}: ${JSON.stringify(closed.output)}`;
  }

  return `Finished ${finished.join(", ") || "nothing outstanding"} and closed ${projectId}.`;
}

// --- answer-producing tasks ------------------------------------------------

async function reportBlockedWork(callTool: Call): Promise<string> {
  const report = asRecord((await callTool("blocked_items", {})).output);
  const count = num(report["count"]);
  const ids = asArray(report["workItems"]).map((row) => str(asRecord(row)["id"])).filter(Boolean);

  if (count === null) return "Could not read the blocked work items.";

  return `${count} work items are held up by an unfinished dependency: ${ids.join(", ")}.`;
}

async function reportBestSprint(callTool: Call): Promise<string> {
  const report = asRecord((await callTool("velocity_report", { completedOnly: true })).output);

  const best = asArray(report["sprints"])
    .map(asRecord)
    .sort((a, b) => (num(b["deliveredPoints"]) ?? 0) - (num(a["deliveredPoints"]) ?? 0))[0];

  if (!best) return "No completed sprints to compare.";

  return `${String(best["name"])} delivered the most, with ${String(best["deliveredPoints"])} points.`;
}

async function reportBillingHours(callTool: Call): Promise<string> {
  const projectId = await findProjectId(callTool, "ATL");

  if (!projectId) return "Could not find the billing platform project.";

  const report = asRecord((await callTool("project_time_report", { projectId })).output);
  const total = num(report["totalHours"]);

  if (total === null) return "Could not read the logged hours.";

  return `The total time logged against the Atlas billing platform is ${total} hours.`;
}

async function reportActiveOverduePoints(callTool: Call): Promise<string> {
  const report = asRecord(
    (await callTool("overdue_items", { activeAssigneesOnly: true })).output,
  );
  const points = num(report["overduePoints"]);

  if (points === null) return "Could not read the overdue work.";

  return `Overdue work held by members who are still active comes to ${points} points.`;
}

async function reportOverCommitted(callTool: Call): Promise<string> {
  const report = asRecord((await callTool("member_load", {})).output);

  const over = asArray(report["results"])
    .map(asRecord)
    .filter((row) => (num(row["overCapacityBy"]) ?? 0) > 0)
    .sort((a, b) => (num(b["overCapacityBy"]) ?? 0) - (num(a["overCapacityBy"]) ?? 0))[0];

  if (!over) return "Nobody is over their weekly capacity.";

  return `${String(over["name"])} is over capacity by ${String(over["overCapacityBy"])} points.`;
}

async function reportBacklogSize(callTool: Call): Promise<string> {
  const backlogId = await statusIdNamed(callTool, "Backlog");

  if (!backlogId) return "Could not find the Backlog state.";

  const result = asRecord((await callTool("list_work_items", { status: backlogId })).output);
  const total = num(result["total"]);

  if (total === null) return "Could not count the backlog.";

  return `There are ${total} work items in the Backlog state.`;
}

async function reportCarryOverSprint(callTool: Call): Promise<string> {
  const report = asRecord((await callTool("velocity_report", { completedOnly: true })).output);

  const carried = asArray(report["sprints"])
    .map(asRecord)
    .filter((row) => (num(row["carriedOverPoints"]) ?? 0) > 0)[0];

  if (!carried) return "No completed sprint has unfinished work in it.";

  return `${String(carried["name"])} was closed with work still unfinished: ${String(
    carried["carriedOverPoints"],
  )} points remain in it.`;
}

export default async function projectSolverAgent({ task, callTool }: AgentInput) {
  if (task.includes("tax rules engine")) {
    return { output: await signOffTaxRules(callTool) };
  }

  if (task.includes("payment retry scheduler")) {
    return { output: await landRetryScheduler(callTool) };
  }

  if (task.includes("Devon Ito")) {
    return { output: await rehomeDepartedWork(callTool) };
  }

  if (task.includes("Usage metering")) {
    return { output: await assignUsageMetering(callTool) };
  }

  if (task.includes("Leave a note")) {
    return { output: await noteTheBlocker(callTool) };
  }

  if (task.includes("Atlas Sprint 13 is empty")) {
    return { output: await fillNextSprint(callTool) };
  }

  if (task.includes("ran to its end date")) {
    return { output: await turnOverSprint(callTool) };
  }

  if (task.includes("ledger data migration")) {
    return { output: await closeLedgerProject(callTool) };
  }

  if (task.includes("held up by an unfinished dependency")) {
    return { output: await reportBlockedWork(callTool) };
  }

  if (task.includes("delivered the most points")) {
    return { output: await reportBestSprint(callTool) };
  }

  if (task.includes("total number of hours")) {
    return { output: await reportBillingHours(callTool) };
  }

  if (task.includes("who is still active")) {
    return { output: await reportActiveOverduePoints(callTool) };
  }

  if (task.includes("weekly capacity allows")) {
    return { output: await reportOverCommitted(callTool) };
  }

  if (task.includes("Backlog state right now")) {
    return { output: await reportBacklogSize(callTool) };
  }

  if (task.includes("closed out while work was still unfinished")) {
    return { output: await reportCarryOverSprint(callTool) };
  }

  return { output: "No scripted solution for this task." };
}
