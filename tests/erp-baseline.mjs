#!/usr/bin/env node
/**
 * ERP regression gate.
 *
 * Runs every ERP task with an agent that changes nothing, so each result is a
 * pure function of the seed data and the verifier logic. Any migration that
 * alters either shows up here as a diff.
 *
 * Tool bodies are NOT exercised by this gate — the no-op agent never calls one.
 * `npm run test:tools` covers that path.
 *
 * Usage:  npm run test:erp [-- --update]
 */

import { runTemplateBaseline } from "./harness.mjs";

process.exitCode = await runTemplateBaseline({
  template: "erp",
  label: "ERP",
  baselineDir: new URL("./baselines/erp/", import.meta.url).pathname,
  agentPath: new URL("./noop.agent.ts", import.meta.url).pathname,
  update: process.argv.includes("--update"),
})
  ? 1
  : 0;
