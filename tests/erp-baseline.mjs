#!/usr/bin/env node
/**
 * ERP regression gate.
 *
 * Scaffolds a throwaway environment from the CURRENT `templates/erp` and runs
 * every task with an agent that changes nothing, so each result is a pure
 * function of the seed data and the verifier logic. Any migration that alters
 * either shows up here as a diff.
 *
 * Scaffolding fresh matters: an environment already sitting in `.silo/` is a
 * copy taken when it was created, so testing one would pass no matter what the
 * template does.
 *
 * Usage:  npm run test:erp [-- --update]
 */

import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runTask } from "../src/core/run.js";
import { scaffoldEnvironment } from "../src/core/scaffold.js";

const BASELINE_DIR = new URL("./baselines/erp/", import.meta.url).pathname;
const AGENT = new URL("./noop.agent.ts", import.meta.url).pathname;
const ENVIRONMENT = "erp-baseline";
const update = process.argv.includes("--update");

const project = await mkdtemp(join(tmpdir(), "silo-erp-"));
const runsDir = join(project, "runs");

// Environment modules are ESM; without this the loader treats them as CommonJS
// and the contract exports end up nested under `.default`.
await writeFile(join(project, "package.json"), '{"name":"silo-erp-baseline","type":"module"}\n');

await scaffoldEnvironment({ name: ENVIRONMENT, template: "erp", tools: [], cwd: project });

const taskIds = (await readdir(BASELINE_DIR))
  .filter((file) => file.endsWith(".result.json"))
  .map((file) => file.replace(".result.json", ""))
  .sort();

let failures = 0;

try {
  for (const taskId of taskIds) {
    const result = await runTask({
      environmentName: ENVIRONMENT,
      cwd: project,
      taskId,
      agentPath: AGENT,
      runsDir,
    });

    for (const artifact of ["result", "state-diff"]) {
      const actual = await readFile(join(result.runDir, `${artifact}.json`), "utf8");
      const path = join(BASELINE_DIR, `${taskId}.${artifact}.json`);

      if (update) {
        await writeFile(path, actual);
        continue;
      }

      if (actual !== (await readFile(path, "utf8"))) {
        console.error(`DRIFT  ${taskId} ${artifact}.json`);
        failures += 1;
      }
    }

    if (!update) console.log(`ok     ${taskId}  reward=${result.reward}`);
  }
} finally {
  await rm(project, { recursive: true, force: true });
}

if (update) {
  console.log(`updated ${taskIds.length} baselines from templates/erp`);
} else if (failures) {
  console.error(`\n${failures} artifact(s) drifted from baseline.`);
  process.exitCode = 1;
} else {
  console.log(`\nall ${taskIds.length} ERP tasks match baseline`);
}
