#!/usr/bin/env node
import { isAuthoringCommand, runAuthoringCommand } from "./cli/authoring.js";
import { init } from "./cli/init.js";
import { run } from "./cli/run.js";

const HELP = `Silo — local-first simulation and evaluation for AI agents.

Every authoring command works non-interactively and takes --env <name>.
Add --json to any of them for machine-readable output.

Environments
  silo init                                  interactive wizard
  silo init <name> [--template blank|erp] [--tools a,b]
  silo env validate --env <env>              check an environment without running it

Data — raw facts, stored as data/<name>.json
  silo data list --env <env>
  silo data show <name> --env <env>
  silo data add <name> --env <env> (--file <path> | --data <json>)
  silo data update <name> --env <env> (--file <path> | --data <json>)
  silo data remove <name> --env <env>

Tasks — objectives, stored as tasks/<id>.json
  silo task list --env <env>
  silo task show <id> --env <env>
  silo task add --env <env> --id <id> --title <t> --instruction <i>
                --verifier <VER-ID> [--difficulty easy|medium|hard]
  silo task update --env <env> --id <id> [--title ...] [--instruction ...]
  silo task remove <id> --env <env>

Tools — TypeScript the agent can call
  silo tool list --env <env>
  silo tool add <name> --env <env> [--description <d>] [--state <TypeName>]

Verifiers — TypeScript that decides success
  silo verifier list --env <env>
  silo verifier add <VER-ID> --env <env> --task <TASK-ID> [--name <n>] [--state <TypeName>]

Running
  silo run --env <env> --task <id> [--agent ./silo.agent.ts]
           [--max-tool-calls 100] [--timeout-ms 120000]

"tool add" and "verifier add" generate a compiling stub and register it. They
never write business logic: implement the TODO they leave behind, then run
"silo env validate".
`;

const [, , command, ...argv] = process.argv;

if (command === "init") {
  await init(argv);
} else if (command === "run") {
  await run();
} else if (isAuthoringCommand(command)) {
  await runAuthoringCommand(command as string, argv);
} else if (command === undefined || command === "--help" || command === "-h" || command === "help") {
  console.log(HELP);
} else {
  console.error(`error: unknown command "${command}". Run "silo --help".`);
  process.exitCode = 1;
}
