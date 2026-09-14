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

export async function run() {
  const environmentName = getFlag("--env");
  const taskId = getFlag("--task");
  const agentPath = getFlag("--agent") ?? "./silo.agent.ts";
  const maxToolCalls = Number(getFlag("--max-tool-calls") ?? 100);
  const timeoutMs = Number(getFlag("--timeout-ms") ?? 120_000);

  if (!environmentName) throw new Error("Missing --env.");
  if (!taskId) throw new Error("Missing --task.");

  let result: RunResult;

  try {
    result = await runTask({
      environmentName,
      taskId,
      agentPath,
      maxToolCalls,
      timeoutMs,
    });
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

  const instance = render(<Result result={result} />);
  await instance.waitUntilExit();

  if (!result.passed) process.exitCode = 1;
}
