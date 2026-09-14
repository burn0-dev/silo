import { mkdir, writeFile, appendFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { tsImport } from "tsx/esm/api";

import { openEnvironment } from "./environment.js";
import type {
  SiloTask,
  TerminationReason,
  Tool,
  TraceEvent,
  VerifierOutcome,
} from "./types.js";

export type RunOptions = {
  environmentName: string;
  /** Project root holding `.silo/`. Defaults to the current working directory. */
  cwd?: string;
  taskId: string;
  agentPath: string;
  maxToolCalls?: number;
  timeoutMs?: number;
  runsDir?: string;
};

export type RunArtifact = {
  runId: string;
  environment: string;
  taskId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  terminationReason: TerminationReason;
  toolCallCount: number;
};

export type RunResult = {
  run: RunArtifact;
  task: SiloTask;
  agentOutput: unknown;
  passed: boolean;
  reward: number;
  verifier: VerifierOutcome;
  toolErrors: number;
  trace: TraceEvent[];
  runDir: string;
  error: string | null;
};

const DEFAULT_MAX_TOOL_CALLS = 100;
const DEFAULT_TIMEOUT_MS = 120_000;

/** Raised internally to unwind an agent that has hit a run limit. */
class RunLimitError extends Error {
  readonly reason: TerminationReason;

  constructor(reason: TerminationReason, message: string) {
    super(message);
    this.name = "RunLimitError";
    this.reason = reason;
  }
}

function createRunId(startedAt: Date): string {
  const stamp = startedAt.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return `run_${stamp}_${process.pid.toString(36)}`;
}

/** Agents may return any shape; verifiers are handed text they can parse. */
function asOutputText(output: unknown): string {
  if (typeof output === "string") return output;
  if (output === null || output === undefined) return "";

  return JSON.stringify(output) ?? "";
}

async function loadAgentModule<T>(path: string): Promise<T> {
  return (await tsImport(pathToFileURL(resolve(path)).href, import.meta.url)) as T;
}

/**
 * Shallow structural diff: which collections gained, lost or changed entities.
 * Enough to see what a rollout touched without serialising two whole worlds.
 */
function diffState(initial: unknown, final: unknown) {
  const before = initial as Record<string, unknown>;
  const after = final as Record<string, unknown>;
  const collections: Record<string, { added: string[]; removed: string[]; changed: string[] }> = {};
  const scalars: Array<{ field: string; from: unknown; to: unknown }> = [];

  /** Rows carrying a string `id` diff like a collection, wherever they are stored. */
  const keyById = (value: unknown): Record<string, unknown> | null => {
    if (!Array.isArray(value)) return null;

    const entries: Array<[string, unknown]> = [];

    for (const [index, row] of value.entries()) {
      const id =
        typeof row === "object" && row !== null && typeof (row as { id?: unknown }).id === "string"
          ? (row as { id: string }).id
          : String(index);

      entries.push([id, row]);
    }

    return Object.fromEntries(entries);
  };

  for (const key of Object.keys(after ?? {})) {
    const beforeValue = before?.[key];
    const afterValue = after[key];

    // An append-only log is an array, not a keyed map, but its entries still
    // matter: without this, everything written to one is invisible in the diff.
    const beforeRows = keyById(beforeValue);
    const afterRows = keyById(afterValue);

    const isCollection =
      typeof afterValue === "object" &&
      afterValue !== null &&
      !Array.isArray(afterValue) &&
      typeof beforeValue === "object" &&
      beforeValue !== null;

    if (!isCollection && !(beforeRows && afterRows)) {
      if (typeof afterValue !== "object" && beforeValue !== afterValue) {
        scalars.push({ field: key, from: beforeValue, to: afterValue });
      }
      continue;
    }

    const beforeMap = (beforeRows ?? beforeValue) as Record<string, unknown>;
    const afterMap = (afterRows ?? afterValue) as Record<string, unknown>;

    const added = Object.keys(afterMap).filter((id) => !(id in beforeMap));
    const removed = Object.keys(beforeMap).filter((id) => !(id in afterMap));
    const changed = Object.keys(afterMap).filter(
      (id) => id in beforeMap && JSON.stringify(beforeMap[id]) !== JSON.stringify(afterMap[id]),
    );

    if (added.length || removed.length || changed.length) {
      collections[key] = { added, removed, changed };
    }
  }

  return { scalars, collections };
}

export async function runTask(options: RunOptions): Promise<RunResult> {
  const maxToolCalls = options.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const cwd = options.cwd ?? process.cwd();
  const environment = await openEnvironment({ name: options.environmentName, cwd });
  const { runtime } = environment;

  if (environment.tasks.length === 0) {
    throw new Error(
      `No tasks found in environment "${options.environmentName}".\nAdd a task before running.`,
    );
  }

  const task = environment.tasks.find((candidate) => candidate.id === options.taskId);

  if (!task) {
    throw new Error(`Task "${options.taskId}" was not found in ${options.environmentName}.`);
  }

  const verifier = runtime.verifiers.find((candidate) => candidate.id === task.verifierId);

  if (!verifier) {
    throw new Error(`Verifier "${task.verifierId}" for task "${task.id}" was not found.`);
  }

  const agentModule = await loadAgentModule<{ default?: unknown }>(options.agentPath);

  if (typeof agentModule.default !== "function") {
    throw new Error(`Agent "${options.agentPath}" must default-export a function.`);
  }

  const agent = agentModule.default as (input: {
    task: string;
    tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
    callTool: (name: string, input: unknown) => Promise<{ output: unknown; isError?: boolean }>;
    signal: AbortSignal;
  }) => Promise<{ output: unknown }>;

  // Every rollout starts from a fresh deterministic world.
  const state = runtime.createState();
  const initialState = structuredClone(state);
  const tools: Tool[] = runtime.bindTools(state);
  const toolMap = new Map(tools.map((tool) => [tool.name, tool]));

  const startedAtDate = new Date();
  const runId = createRunId(startedAtDate);
  const runsDir = options.runsDir ?? join(cwd, ".silo", "runs");
  const runDir = join(runsDir, runId);
  await mkdir(runDir, { recursive: true });

  const tracePath = join(runDir, "trace.jsonl");
  const trace: TraceEvent[] = [];
  let seq = 0;
  let toolCallCount = 0;
  let toolErrors = 0;
  let terminationReason: TerminationReason = "completed";

  // Written incrementally so a crashed run still leaves everything up to the crash.
  const record = async (event: TraceEvent) => {
    trace.push(event);
    await appendFile(tracePath, `${JSON.stringify(event)}\n`);
  };

  const controller = new AbortController();
  const startedAt = Date.now();

  const timer = setTimeout(() => {
    terminationReason = "timeout";
    controller.abort();
  }, timeoutMs);

  const callTool = async (name: string, input: unknown) => {
    if (controller.signal.aborted) {
      throw new RunLimitError(terminationReason, `Run ended: ${terminationReason}.`);
    }

    if (toolCallCount >= maxToolCalls) {
      terminationReason = "max_tool_calls";
      controller.abort();
      throw new RunLimitError("max_tool_calls", `Tool call limit exceeded (${maxToolCalls}).`);
    }

    toolCallCount += 1;
    seq += 1;
    await record({ seq, type: "tool_call", at: new Date().toISOString(), tool: name, input });

    const tool = toolMap.get(name);

    const result = tool
      ? await tool.execute(input)
      : {
          output: { code: "tool_not_found", message: `Unknown tool "${name}".` },
          isError: true,
        };

    const isError = result.isError === true;
    if (isError) toolErrors += 1;

    seq += 1;
    await record({
      seq,
      type: "tool_result",
      at: new Date().toISOString(),
      tool: name,
      output: result.output,
      isError,
    });

    return result;
  };

  let agentOutput: unknown = null;
  let error: string | null = null;

  try {
    const outcome = await agent({
      task: task.instruction,
      tools: tools.map(({ name, description, inputSchema }) => ({
        name,
        description,
        inputSchema: inputSchema as Record<string, unknown>,
      })),
      callTool,
      signal: controller.signal,
    });

    agentOutput = outcome?.output ?? null;
  } catch (thrown) {
    if (thrown instanceof RunLimitError) {
      terminationReason = thrown.reason;
      error = thrown.message;
    } else {
      terminationReason = controller.signal.aborted ? terminationReason : "agent_error";
      error = thrown instanceof Error ? thrown.message : String(thrown);
    }
  } finally {
    clearTimeout(timer);
  }

  // The verifier runs whatever happened — a timed-out rollout still gets graded.
  const verifierOutcome = verifier.check(state, initialState, {
    agentOutput: asOutputText(agentOutput),
    task,
  });

  const finishedAtDate = new Date();

  const run: RunArtifact = {
    runId,
    environment: options.environmentName,
    taskId: task.id,
    startedAt: startedAtDate.toISOString(),
    finishedAt: finishedAtDate.toISOString(),
    durationMs: finishedAtDate.getTime() - startedAt,
    terminationReason,
    toolCallCount,
  };

  const resultFile = {
    passed: verifierOutcome.passed,
    reward: verifierOutcome.reward,
    requiredPassed: verifierOutcome.requiredPassed,
    requiredTotal: verifierOutcome.requiredTotal,
    failedRequired: verifierOutcome.failedRequired,
    checksPassed: verifierOutcome.checks.filter((check) => check.passed).length,
    checksFailed: verifierOutcome.checks.filter((check) => !check.passed).length,
    toolCalls: toolCallCount,
    toolErrors,
    terminationReason,
    agentOutput,
    error,
    checks: verifierOutcome.checks,
  };

  await Promise.all([
    writeFile(join(runDir, "run.json"), `${JSON.stringify(run, null, 2)}\n`),
    writeFile(join(runDir, "result.json"), `${JSON.stringify(resultFile, null, 2)}\n`),
    writeFile(
      join(runDir, "state-diff.json"),
      `${JSON.stringify(diffState(initialState, state), null, 2)}\n`,
    ),
  ]);

  return {
    run,
    task,
    agentOutput,
    passed: verifierOutcome.passed,
    reward: verifierOutcome.reward,
    verifier: verifierOutcome,
    toolErrors,
    trace,
    runDir,
    error,
  };
}
