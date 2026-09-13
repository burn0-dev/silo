#!/usr/bin/env node
import { init } from "./cli/init.js";
import { run } from "./cli/run.js";

const command = process.argv[2];

switch (command) {
  case "init":
    await init();
    break;

  case "run":
    await run();
    break;

  default:
    console.log(`
Silo

Usage:
  silo init
  silo run --env <name> --task <id> [--agent ./silo.agent.ts]
`);
}
