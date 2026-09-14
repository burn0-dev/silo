#!/usr/bin/env node
/**
 * ERP tool-path gate.
 *
 * `npm run test:erp` proves the seed data and the verifiers are unchanged, but
 * its agent never calls a tool, so none of the 185 tool bodies run. This gate
 * walks a scripted agent through read, write, read-back, two rejected argument
 * shapes and an unknown tool, then byte-compares the artifacts.
 *
 * It does not execute every tool. It covers the path every tool goes through:
 * binding, argument validation, output cloning, error mapping and dispatch.
 *
 * Usage:  npm run test:tools [-- --update]
 */

import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runTask } from "../src/core/run.js";
import { scaffoldEnvironment } from "../src/core/scaffold.js";

const BASELINE_DIR = new URL("./baselines/erp-tool-path/", import.meta.url).pathname;
const AGENT = new URL("./tool-path.agent.ts", import.meta.url).pathname;
const ENVIRONMENT = "erp-tool-path";
const TASK = "TASK-013";
const update = process.argv.includes("--update");

const project = await mkdtemp(join(tmpdir(), "silo-tools-"));
const runsDir = join(project, "runs");

await writeFile(join(project, "package.json"), '{"name":"silo-tool-path","type":"module"}\n');

const packageRoot = new URL("../", import.meta.url).pathname;
await mkdir(join(project, "node_modules", "@burn0"), { recursive: true });
await symlink(packageRoot, join(project, "node_modules", "@burn0", "silo"), "dir");

await scaffoldEnvironment({ name: ENVIRONMENT, template: "erp", tools: [], cwd: project });
await mkdir(BASELINE_DIR, { recursive: true });

let failures = 0;

try {
  const result = await runTask({
    environmentName: ENVIRONMENT,
    cwd: project,
    taskId: TASK,
    agentPath: AGENT,
    runsDir,
  });

  for (const artifact of ["result", "state-diff"]) {
    const actual = await readFile(join(result.runDir, `${artifact}.json`), "utf8");
    const path = join(BASELINE_DIR, `${TASK}.${artifact}.json`);

    if (update) {
      await writeFile(path, actual);
      continue;
    }

    if (actual !== (await readFile(path, "utf8"))) {
      console.error(`DRIFT  ${TASK} ${artifact}.json`);
      failures += 1;
    }
  }

  // Tool outputs live in the trace, which carries timestamps, so compare the
  // parts that describe behaviour rather than the line as written.
  const trace = (await readFile(join(result.runDir, "trace.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .filter((event) => event.type === "tool_call" || event.type === "tool_result")
    .map(({ at, durationMs, ...rest }) => rest);

  const tracePath = join(BASELINE_DIR, `${TASK}.tool-events.json`);
  const actualTrace = `${JSON.stringify(trace, null, 2)}\n`;

  if (update) {
    await writeFile(tracePath, actualTrace);
  } else if (actualTrace !== (await readFile(tracePath, "utf8"))) {
    console.error(`DRIFT  ${TASK} tool events (inputs, outputs or error payloads changed)`);
    failures += 1;
  }

  if (!update) {
    console.log(`ok     ${TASK}  ${trace.length / 2} tool calls  reward=${result.reward}`);
    console.log(`       ${result.agentOutput}`);
  }
} finally {
  await rm(project, { recursive: true, force: true });
}

if (update) {
  console.log("updated tool-path baselines from templates/erp");
} else if (failures) {
  console.error(`\n${failures} artifact(s) drifted from baseline.`);
  process.exitCode = 1;
} else {
  console.log("\ntool path matches baseline");
}
