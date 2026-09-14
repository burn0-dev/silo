/**
 * The authoring commands: data, task, tool, verifier, env validate.
 *
 * Every one of these is a thin shell over `core/store.ts` and
 * `core/validate.ts`. No filesystem knowledge lives here, so the SDK and web UI
 * can offer the same operations without reimplementing any of it.
 */

import { readFile } from "node:fs/promises";

import {
  boolFlag,
  flag,
  parseArgs,
  printJson,
  requireEnv,
  requireFlag,
  requirePositional,
  type ParsedArgs,
} from "./args.js";
import { isSiloError } from "../core/errors.js";
import type { EnvironmentRef, JsonValue } from "../core/types.js";
import {
  getData,
  getTask,
  listData,
  listTasks,
  listTools,
  listVerifiers,
  putData,
  putTask,
  removeData,
  removeTask,
  scaffoldTool,
  scaffoldVerifier,
} from "../core/store.js";
import { validateEnvironment } from "../core/validate.js";

/** Every authoring command targets one environment inside the current project. */
function envRef(args: ParsedArgs): EnvironmentRef {
  return { name: requireEnv(args), cwd: process.cwd() };
}

/** Content may come from a file or straight from a flag, so agents can skip temp files. */
async function readContent(args: ParsedArgs): Promise<JsonValue> {
  const file = flag(args, "file");
  const inline = flag(args, "data");

  if (file && inline) {
    throw new Error("Pass either --file or --data, not both.");
  }

  const raw = file ? await readFile(file, "utf8") : inline;

  if (raw === undefined) {
    throw new Error("Missing --file <path> or --data <json>.");
  }

  try {
    return JSON.parse(raw) as JsonValue;
  } catch (error) {
    throw new Error(`Content is not valid JSON: ${(error as Error).message}`);
  }
}

async function dataCommand(args: ParsedArgs): Promise<void> {
  const action = requirePositional(args, 0, "list|show|add|update|remove");
  const json = boolFlag(args, "json");

  if (action === "list") {
    const entries = await listData(envRef(args));

    if (json) return printJson(entries);
    if (entries.length === 0) return console.log("No datasets.");

    for (const entry of entries) console.log(`${entry.name}\t${entry.file}\t${entry.bytes}B`);
    return;
  }

  if (action === "show") {
    const value = await getData(envRef(args), requirePositional(args, 1, "name"));

    return printJson(value);
  }

  if (action === "add" || action === "update") {
    const name = requirePositional(args, 1, "name");
    const mode = action === "add" ? "create" : "update";
    const file = await putData(envRef(args), name, await readContent(args), mode);

    if (json) return printJson({ ok: true, action, name, file });

    console.log(`${action === "add" ? "Created" : "Updated"} ${file}`);
    return;
  }

  if (action === "remove") {
    const name = requirePositional(args, 1, "name");
    const file = await removeData(envRef(args), name);

    if (json) return printJson({ ok: true, action, name, file });

    console.log(`Removed ${file}`);
    return;
  }

  throw new Error(`Unknown "silo data" action "${action}".`);
}

async function taskCommand(args: ParsedArgs): Promise<void> {
  const action = requirePositional(args, 0, "list|show|add|update|remove");
  const json = boolFlag(args, "json");

  if (action === "list") {
    const entries = await listTasks(envRef(args));

    if (json) return printJson(entries.map((entry) => entry.task));
    if (entries.length === 0) return console.log("No tasks.");

    for (const { task } of entries) {
      console.log(`${task.id}\t${task.difficulty}\t${task.verifierId}\t${task.title}`);
    }
    return;
  }

  if (action === "show") {
    const entry = await getTask(envRef(args), requirePositional(args, 1, "id"));

    return printJson(entry.task);
  }

  if (action === "add" || action === "update") {
    const ref = envRef(args);
    const id = flag(args, "id") ?? args.positionals[1];

    if (!id) throw new Error("Missing --id.");

    const existing =
      action === "update" ? (await getTask(ref, id)).task : undefined;

    const task = {
      id,
      title: flag(args, "title") ?? existing?.title ?? "",
      instruction: flag(args, "instruction") ?? existing?.instruction ?? "",
      verifierId: flag(args, "verifier") ?? existing?.verifierId ?? "",
      difficulty: flag(args, "difficulty") ?? existing?.difficulty ?? "unspecified",
    };

    const file = await putTask(ref, task, action === "add" ? "create" : "update");

    if (json) return printJson({ ok: true, action, task, file });

    console.log(`${action === "add" ? "Created" : "Updated"} ${file}`);
    return;
  }

  if (action === "remove") {
    const id = requirePositional(args, 1, "id");
    const file = await removeTask(envRef(args), id);

    if (json) return printJson({ ok: true, action, id, file });

    console.log(`Removed ${file}`);
    return;
  }

  throw new Error(`Unknown "silo task" action "${action}".`);
}

async function toolCommand(args: ParsedArgs): Promise<void> {
  const action = requirePositional(args, 0, "list|add");
  const json = boolFlag(args, "json");

  if (action === "list") {
    const tools = await listTools(envRef(args));

    if (json) return printJson(tools);
    if (tools.length === 0) return console.log("No tools.");

    for (const tool of tools) console.log(`${tool.name}\t${tool.description}`);
    return;
  }

  if (action === "add") {
    const name = requirePositional(args, 1, "name");
    const options = {
      ref: envRef(args),
      name,
      ...(flag(args, "description") ? { description: flag(args, "description") as string } : {}),
      ...(flag(args, "state") ? { stateType: flag(args, "state") as string } : {}),
    };

    const result = await scaffoldTool(options);

    if (json) return printJson({ ok: true, action, name, ...result });

    console.log(`Created ${result.created}`);
    console.log(`Registered ${result.identifier} in ${result.registeredIn}`);
    console.log(`Next: implement run() in ${result.created} (look for TODO).`);
    return;
  }

  throw new Error(`Unknown "silo tool" action "${action}".`);
}

async function verifierCommand(args: ParsedArgs): Promise<void> {
  const action = requirePositional(args, 0, "list|add");
  const json = boolFlag(args, "json");

  if (action === "list") {
    const verifiers = await listVerifiers(envRef(args));

    if (json) return printJson(verifiers);
    if (verifiers.length === 0) return console.log("No verifiers.");

    for (const verifier of verifiers) {
      console.log(`${verifier.id}\t${verifier.taskId}\t${verifier.name}`);
    }
    return;
  }

  if (action === "add") {
    const id = requirePositional(args, 1, "id");
    const options = {
      ref: envRef(args),
      id,
      taskId: requireFlag(args, "task"),
      ...(flag(args, "name") ? { name: flag(args, "name") as string } : {}),
      ...(flag(args, "state") ? { stateType: flag(args, "state") as string } : {}),
    };

    const result = await scaffoldVerifier(options);

    if (json) return printJson({ ok: true, action, id, ...result });

    console.log(`Created ${result.created}`);
    console.log(`Registered ${result.identifier} in ${result.registeredIn}`);
    console.log(`Next: replace the failing TODO check in ${result.created}.`);
    return;
  }

  throw new Error(`Unknown "silo verifier" action "${action}".`);
}

async function envCommand(args: ParsedArgs): Promise<void> {
  const action = requirePositional(args, 0, "validate");

  if (action !== "validate") {
    throw new Error(`Unknown "silo env" action "${action}".`);
  }

  const report = await validateEnvironment(envRef(args));

  if (boolFlag(args, "json")) {
    printJson(report);
  } else {
    for (const finding of report.findings) {
      console.log(`${finding.level.toUpperCase()}\t${finding.code}\t${finding.message}`);
    }

    const { data, tasks, tools, verifiers } = report.counts;

    console.log(
      `${report.ok ? "OK" : "FAILED"}\t${report.environment}\tdata=${data} tasks=${tasks} tools=${tools} verifiers=${verifiers}`,
    );
  }

  if (!report.ok) process.exitCode = 1;
}

const COMMANDS: Record<string, (args: ParsedArgs) => Promise<void>> = {
  data: dataCommand,
  task: taskCommand,
  tool: toolCommand,
  verifier: verifierCommand,
  env: envCommand,
};

export function isAuthoringCommand(name: string | undefined): boolean {
  return name !== undefined && name in COMMANDS;
}

export async function runAuthoringCommand(name: string, argv: string[]): Promise<void> {
  const command = COMMANDS[name];

  if (!command) throw new Error(`Unknown command "${name}".`);

  try {
    await command(parseArgs(argv));
  } catch (error) {
    // SiloError carries a stable code; everything else is unexpected.
    const message = error instanceof Error ? error.message : String(error);
    const code = isSiloError(error) ? `${error.code}: ` : "";

    console.error(`error: ${code}${message}`);
    process.exitCode = 1;
  }
}
