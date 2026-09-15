import React from "react";
import { relative } from "node:path";
import { Box, Text, render } from "ink";

import { runTask, type RunResult } from "../core/run.js";

function getFlag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? undefined : process.argv[index + 1];

  return value === undefined || value.startsWith("--") ? undefined : value;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Box width={14}>
        <Text dimColor>{label}</Text>
      </Box>

      <Text bold>{value}</Text>
    </Box>
  );
}

function Result({ result }: { result: RunResult }) {
  const { verifier, run } = result;
  const successfulCalls = run.toolCallCount - result.toolErrors;
  const checksPassed = verifier.checks.filter((check) => check.passed).length;

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold>Silo Run</Text>

      <Box flexDirection="column" marginTop={1}>
        <Row label="Task" value={`${result.task.id} — ${result.task.title}`} />
        <Row label="Result" value={result.passed ? "PASS" : "FAIL"} />
        <Row label="Reward" value={result.reward.toFixed(2)} />
        <Row label="Duration" value={`${(run.durationMs / 1000).toFixed(1)}s`} />
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Row label="Tool calls" value={String(run.toolCallCount)} />
        <Row label="Successful" value={String(successfulCalls)} />
        <Row label="Errors" value={String(result.toolErrors)} />
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Row label="Checks" value={`${checksPassed} / ${verifier.checks.length}`} />
        <Row label="Required" value={`${verifier.requiredPassed} / ${verifier.requiredTotal}`} />
      </Box>

      {run.terminationReason !== "completed" && (
        <Box marginTop={1}>
          <Text color="yellow">Ended early: {run.terminationReason}</Text>
        </Box>
      )}

      {result.error && (
        <Box marginTop={1}>
          <Text color="red">{result.error}</Text>
        </Box>
      )}

      {verifier.failedRequired.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Failed</Text>

          {verifier.failedRequired.map((label) => (
            <Text key={label} color="red">
              ✗ {label}
            </Text>
          ))}
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>Run saved: {relative(process.cwd(), result.runDir)}</Text>
      </Box>
    </Box>
  );
}

/** How a task scored across repeated rollouts. */
function Summary({ results }: { results: RunResult[] }) {
  const passed = results.filter((result) => result.passed).length;
  const rewards = results.map((result) => result.reward);
  const mean = rewards.reduce((total, reward) => total + reward, 0) / rewards.length;
  const first = results[0];

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold>Silo Runs</Text>

      <Box flexDirection="column" marginTop={1}>
        <Row label="Task" value={`${first!.task.id} — ${first!.task.title}`} />
        <Row label="Rollouts" value={String(results.length)} />
        <Row label="Passed" value={`${passed} / ${results.length}`} />
        <Row label="Mean reward" value={mean.toFixed(2)} />
        <Row label="Best" value={Math.max(...rewards).toFixed(2)} />
        <Row label="Worst" value={Math.min(...rewards).toFixed(2)} />
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {results.map((result, index) => (
          <Box key={result.run.runId}>
            <Box width={14}>
              <Text dimColor>{`run ${index + 1}`}</Text>
            </Box>

            <Box width={8}>
              <Text color={result.passed ? "green" : "red"}>
                {result.passed ? "PASS" : "FAIL"}
              </Text>
            </Box>

            <Text dimColor>
              {`reward ${result.reward.toFixed(2)}  ·  ${result.run.toolCallCount} calls  ·  ${result.run.terminationReason}`}
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

export async function run() {
  const environmentName = getFlag("--env");
  const taskId = getFlag("--task");
  const agentPath = getFlag("--agent") ?? "./silo.agent.ts";
  const maxToolCalls = Number(getFlag("--max-tool-calls") ?? 100);
  const timeoutMs = Number(getFlag("--timeout-ms") ?? 120_000);
  const runs = Math.max(1, Number(getFlag("--runs") ?? 1));

  if (!environmentName) throw new Error("Missing --env.");
  if (!taskId) throw new Error("Missing --task.");

  const results: RunResult[] = [];

  try {
    // Sequential on purpose: rollouts share a process, and a local model has
    // one set of weights loaded. Running them at once would measure contention.
    for (let index = 0; index < runs; index += 1) {
      results.push(
        await runTask({ environmentName, taskId, agentPath, maxToolCalls, timeoutMs }),
      );
    }
  } catch (error) {
    // A misconfigured environment is a user error, not a crash: say what is
    // wrong instead of printing a stack trace.
    const instance = render(
      <Box paddingX={2} paddingY={1}>
        <Text color="red">{error instanceof Error ? error.message : String(error)}</Text>
      </Box>,
    );

    await instance.waitUntilExit();

    process.exitCode = 1;
    return;
  }

  const instance = render(
    results.length === 1 ? <Result result={results[0]!} /> : <Summary results={results} />,
  );

  await instance.waitUntilExit();

  // Non-zero unless every rollout passed, so CI cannot be fooled by one good run.
  if (results.some((result) => !result.passed)) process.exitCode = 1;
}
