#!/usr/bin/env node
/**
 * Project-tracking regression gate.
 *
 * Like the CRM gate, this runs a scripted agent that actually solves each task,
 * so the recorded artifacts cover the tool bodies, the state each task leaves
 * behind and the verifier's pass path — not just its judgement on pristine data.
 *
 * Every task is expected to pass. A template whose own tasks cannot be solved
 * is not a usable starting point, so a reward below 1.00 fails the gate even if
 * it matches what was recorded.
 *
 * Usage:  npm run test:project [-- --update]
 */

import { runTemplateBaseline } from "./harness.mjs";

let unsolved = 0;

const drifted = await runTemplateBaseline({
  template: "project",
  label: "Project",
  baselineDir: new URL("./baselines/project/", import.meta.url).pathname,
  agentPath: new URL("./project-solver.agent.ts", import.meta.url).pathname,
  update: process.argv.includes("--update"),
  describe(result) {
    if (!result.passed) unsolved += 1;

    return `${result.passed ? "PASS" : "FAIL"}  reward=${result.reward}`;
  },
});

if (unsolved) {
  console.error(`\n${unsolved} task(s) the scripted solver could not solve.`);
}

process.exitCode = drifted || unsolved ? 1 : 0;
