/**
 * The environment resource store.
 *
 * One place that knows how an environment's files are laid out on disk. The
 * CLI, and later the SDK and web UI, all go through here so the three can never
 * drift into three different models of the same directory.
 *
 * JSON resources (data, tasks) get real CRUD. Code resources (tools,
 * verifiers) get scaffolding and inspection: arbitrary TypeScript is not a
 * record to be edited, so we generate a file and register it, then stop.
 */

import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { TASKS_DIRNAME, openEnvironment, requireEnvironmentDir } from "./environment.js";
import { siloError } from "./errors.js";
import type { EnvironmentRef, JsonValue, SiloTask } from "./types.js";

export const DATA_DIRNAME = "data";
export const TOOLS_DIRNAME = "tools";
export const VERIFIERS_DIRNAME = "verifiers";

/**
 * Resource names become filenames, so they may not contain separators or start
 * with a dot. This is what keeps `../../etc/passwd` from being a dataset name.
 */
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Generated files interpolate this as a bare type reference, so it must be an identifier. */
const SAFE_TYPE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function assertSafeTypeName(name: string): string {
  if (!SAFE_TYPE_NAME.test(name)) {
    throw siloError(
      "unsafe_name",
      `Invalid state type name "${name}". Use a TypeScript identifier, for example "State".`,
      { name },
    );
  }

  return name;
}

export function assertSafeName(kind: string, name: string): string {
  if (!SAFE_NAME.test(name)) {
    throw siloError(
      "unsafe_name",
      `Invalid ${kind} name "${name}". Use letters, numbers, dots, dashes and underscores, starting with a letter or number.`,
      { kind, name },
    );
  }

  return name;
}

async function readJson(path: string): Promise<unknown> {
  const raw = await readFile(path, "utf8");

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw siloError("invalid_json", `"${path}" is not valid JSON: ${(error as Error).message}`, { path });
  }
}

async function writeJson(path: string, value: JsonValue): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function listJsonFiles(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((file) => file.endsWith(".json")).sort();
  } catch {
    return [];
  }
}

/** Once a directory holds a real resource the placeholder is noise. */
async function dropGitkeep(dir: string): Promise<void> {
  await rm(join(dir, ".gitkeep"), { force: true });
}

async function ensureDir(path: string): Promise<string> {
  await mkdir(path, { recursive: true });

  return path;
}

// --- data -------------------------------------------------------------------

export type DataEntry = {
  name: string;
  file: string;
  bytes: number;
};

export async function listData(ref: EnvironmentRef): Promise<DataEntry[]> {
  const dir = join(await requireEnvironmentDir(ref), DATA_DIRNAME);
  const files = await listJsonFiles(dir);

  return Promise.all(
    files.map(async (file) => ({
      name: file.replace(/\.json$/, ""),
      file: `${DATA_DIRNAME}/${file}`,
      bytes: (await readFile(join(dir, file))).byteLength,
    })),
  );
}

export async function getData(ref: EnvironmentRef, name: string): Promise<JsonValue> {
  assertSafeName("dataset", name);

  const dir = join(await requireEnvironmentDir(ref), DATA_DIRNAME);

  try {
    return (await readJson(join(dir, `${name}.json`))) as JsonValue;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw siloError("data_not_found", `Dataset "${name}" was not found in environment "${ref.name}".`, { name });
    }

    throw error;
  }
}

export async function hasData(ref: EnvironmentRef, name: string): Promise<boolean> {
  const entries = await listData(ref);

  return entries.some((entry) => entry.name === name);
}

export type PutMode = "create" | "update" | "upsert";

export async function putData(
  ref: EnvironmentRef,
  name: string,
  value: JsonValue,
  mode: PutMode = "upsert",
): Promise<string> {
  assertSafeName("dataset", name);

  if (value === undefined) {
    throw siloError("invalid_json", `Dataset "${name}" has no content to write.`, { name });
  }

  const exists = await hasData(ref, name);

  if (mode === "create" && exists) {
    throw siloError(
      "data_already_exists",
      `Dataset "${name}" already exists in environment "${ref.name}". Use "silo data update" to replace it.`,
      { name },
    );
  }

  if (mode === "update" && !exists) {
    throw siloError(
      "data_not_found",
      `Dataset "${name}" does not exist in environment "${ref.name}". Use "silo data add" to create it.`,
      { name },
    );
  }

  const dir = await ensureDir(join(await requireEnvironmentDir(ref), DATA_DIRNAME));

  await writeJson(join(dir, `${name}.json`), value);
  await dropGitkeep(dir);

  return `${DATA_DIRNAME}/${name}.json`;
}

export async function removeData(ref: EnvironmentRef, name: string): Promise<string> {
  assertSafeName("dataset", name);

  if (!(await hasData(ref, name))) {
    throw siloError("data_not_found", `Dataset "${name}" was not found in environment "${ref.name}".`, { name });
  }

  const dir = join(await requireEnvironmentDir(ref), DATA_DIRNAME);

  await rm(join(dir, `${name}.json`));

  return `${DATA_DIRNAME}/${name}.json`;
}

// --- tasks ------------------------------------------------------------------

const REQUIRED_TASK_FIELDS = ["id", "title", "instruction", "verifierId"] as const;

export function parseTaskDocument(source: string, document: unknown): SiloTask {
  if (typeof document !== "object" || document === null || Array.isArray(document)) {
    throw siloError("task_invalid", `${source} is not a JSON object.`, { source });
  }

  const record = document as Record<string, unknown>;

  for (const field of REQUIRED_TASK_FIELDS) {
    const value = record[field];

    if (typeof value !== "string" || value.trim() === "") {
      throw siloError("task_invalid", `${source} is missing a non-empty "${field}".`, { source, field });
    }
  }

  const difficulty = record.difficulty;

  return {
    id: String(record.id),
    title: String(record.title),
    instruction: String(record.instruction),
    verifierId: String(record.verifierId),
    difficulty: typeof difficulty === "string" && difficulty.trim() !== "" ? difficulty : "unspecified",
  };
}

export type TaskEntry = {
  task: SiloTask;
  file: string;
};

export async function listTasks(ref: EnvironmentRef): Promise<TaskEntry[]> {
  const dir = join(await requireEnvironmentDir(ref), TASKS_DIRNAME);
  const files = await listJsonFiles(dir);

  const entries: TaskEntry[] = [];

  for (const file of files) {
    const document = await readJson(join(dir, file));

    entries.push({
      task: parseTaskDocument(`Task file "${TASKS_DIRNAME}/${file}"`, document),
      file: `${TASKS_DIRNAME}/${file}`,
    });
  }

  return entries.sort((a, b) => a.task.id.localeCompare(b.task.id));
}

export async function getTask(ref: EnvironmentRef, id: string): Promise<TaskEntry> {
  const entry = (await listTasks(ref)).find((candidate) => candidate.task.id === id);

  if (!entry) {
    throw siloError("task_not_found", `Task "${id}" was not found in environment "${ref.name}".`, { id });
  }

  return entry;
}

export async function putTask(
  ref: EnvironmentRef,
  task: SiloTask,
  mode: PutMode = "upsert",
): Promise<string> {
  assertSafeName("task id", task.id);
  parseTaskDocument(`Task "${task.id}"`, task);

  const entries = await listTasks(ref);
  const existing = entries.find((candidate) => candidate.task.id === task.id);

  if (mode === "create" && existing) {
    throw siloError(
      "task_already_exists",
      `Task "${task.id}" already exists in environment "${ref.name}" (${existing.file}).`,
      { id: task.id, file: existing.file },
    );
  }

  if (mode === "update" && !existing) {
    throw siloError("task_not_found", `Task "${task.id}" does not exist in environment "${ref.name}".`, { id: task.id });
  }

  const dir = await ensureDir(join(await requireEnvironmentDir(ref), TASKS_DIRNAME));

  await writeJson(join(dir, `${task.id}.json`), task);
  await dropGitkeep(dir);

  return `${TASKS_DIRNAME}/${task.id}.json`;
}

export async function removeTask(ref: EnvironmentRef, id: string): Promise<string> {
  const entry = await getTask(ref, id);
  const dir = join(await requireEnvironmentDir(ref), TASKS_DIRNAME);

  await rm(join(dir, entry.file.replace(`${TASKS_DIRNAME}/`, "")));

  return entry.file;
}

// --- code resources ---------------------------------------------------------

export type ToolEntry = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

/**
 * Tools are code, so they are read by importing the environment rather than by
 * parsing its source. That also means a broken environment surfaces its real
 * error here instead of a half-truth from a regex.
 */
export async function listTools(ref: EnvironmentRef): Promise<ToolEntry[]> {
  const opened = await openEnvironment(ref);
  const bound = opened.runtime.bindTools(opened.runtime.createState());

  return bound.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema as Record<string, unknown>,
  }));
}

export type VerifierEntry = {
  id: string;
  taskId: string;
  name: string;
};

export async function listVerifiers(ref: EnvironmentRef): Promise<VerifierEntry[]> {
  const opened = await openEnvironment(ref);

  return opened.runtime.verifiers.map((verifier) => ({
    id: verifier.id,
    taskId: verifier.taskId,
    name: verifier.name,
  }));
}

/** Turns `get_profits` into `getProfits` and `VER-001` into `ver001`. */
export function toIdentifier(name: string): string {
  // An all-caps segment is an acronym, not camelCase worth preserving.
  const parts = name
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => (/^[A-Z0-9]+$/.test(part) ? part.toLowerCase() : part));

  const [first = "resource", ...rest] = parts;

  return (
    first.charAt(0).toLowerCase() +
    first.slice(1) +
    rest.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join("")
  );
}

/** Turns `get_profits` into `get-profits` for the filename. */
export function toFileStem(name: string): string {
  return name
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .join("-")
    .toLowerCase();
}

/**
 * Finds the environment's state type so generated code can import it.
 * `state.ts` is the file whose whole job is to declare it, so that is where we
 * look; `--state` overrides when an environment names it something unusual.
 */
export async function detectStateType(ref: EnvironmentRef): Promise<string> {
  const path = join(await requireEnvironmentDir(ref), "state.ts");

  let source: string;

  try {
    source = await readFile(path, "utf8");
  } catch {
    throw siloError(
      "state_type_not_found",
      `Could not read state.ts in environment "${ref.name}". Name the state type explicitly instead.`,
      { environment: ref.name },
    );
  }

  // `State` is the convention every template ships with, so it wins outright.
  if (/export\s+type\s+State\b/.test(source)) {
    return "State";
  }

  const match = source.match(/export\s+type\s+([A-Za-z0-9_]*State)\b/);

  if (!match?.[1]) {
    throw siloError(
      "state_type_not_found",
      `Could not find an exported "State" type in state.ts of environment "${ref.name}". Export "type State" or name the type explicitly.`,
      { environment: ref.name },
    );
  }

  return match[1];
}

/**
 * Inserts an import and a registry entry into a barrel file.
 *
 * This is the only place Silo edits TypeScript, and it is deliberately narrow:
 * it appends one import line and one identifier inside one named array. If the
 * array cannot be located the caller is told to register by hand rather than
 * having its file rewritten by guesswork.
 */
function registerInBarrel(
  source: string,
  options: { arrayName: string; identifier: string; importPath: string; file: string },
): string {
  const { arrayName, identifier, importPath, file } = options;

  const declaration = new RegExp(`export\\s+const\\s+${arrayName}\\s*:[^=]*=\\s*\\[`);
  const match = declaration.exec(source);

  if (!match) {
    throw siloError(
      "registry_not_found",
      `Could not find "export const ${arrayName}" in ${file}. Register ${identifier} manually.`,
      { file, arrayName, identifier },
    );
  }

  const open = match.index + match[0].length;
  const close = source.indexOf("]", open);

  if (close === -1) {
    throw siloError("registry_not_found", `Could not find the end of the ${arrayName} array in ${file}.`, { file, arrayName });
  }

  const body = source.slice(open, close);

  if (new RegExp(`\\b${identifier}\\b`).test(source)) {
    throw siloError("already_registered", `"${identifier}" is already registered in ${file}.`, { file, identifier });
  }

  const entries = body.trim();
  const nextBody = entries === "" ? identifier : `${entries.replace(/,$/, "")}, ${identifier}`;

  const withEntry = `${source.slice(0, open)}${nextBody}${source.slice(close)}`;

  const importLine = `import { ${identifier} } from "${importPath}";`;
  const imports = [...withEntry.matchAll(/^import .*;$/gm)];
  const last = imports.at(-1);

  if (!last?.index) {
    return `${importLine}\n\n${withEntry}`;
  }

  const insertAt = last.index + last[0].length;

  return `${withEntry.slice(0, insertAt)}\n${importLine}${withEntry.slice(insertAt)}`;
}

export type ScaffoldResult = {
  created: string;
  registeredIn: string;
  identifier: string;
};

async function scaffold(options: {
  ref: EnvironmentRef;
  dirname: string;
  stem: string;
  identifier: string;
  arrayName: string;
  contents: string;
}): Promise<ScaffoldResult> {
  const { ref, dirname, stem, identifier, arrayName, contents } = options;

  const dir = await ensureDir(join(await requireEnvironmentDir(ref), dirname));
  const filePath = join(dir, `${stem}.ts`);
  const barrelPath = join(dir, "index.ts");
  const relative = `${dirname}/${stem}.ts`;

  const existing = await readdir(dir);

  if (existing.includes(`${stem}.ts`)) {
    throw siloError(
      dirname === TOOLS_DIRNAME ? "tool_already_exists" : "verifier_already_exists",
      `"${relative}" already exists in environment "${ref.name}".`,
      { file: relative },
    );
  }

  let barrel: string;

  try {
    barrel = await readFile(barrelPath, "utf8");
  } catch {
    throw siloError(
      "registry_not_found",
      `Environment "${ref.name}" has no ${dirname}/index.ts to register in. Create one exporting "${arrayName}".`,
      { file: `${dirname}/index.ts`, arrayName },
    );
  }

  // Registry first: a scaffolded file that is not wired up would be invisible,
  // so fail before writing rather than leaving an orphan behind.
  const nextBarrel = registerInBarrel(barrel, {
    arrayName,
    identifier,
    importPath: `./${stem}.js`,
    file: `${dirname}/index.ts`,
  });

  await writeFile(filePath, contents);
  await writeFile(barrelPath, nextBarrel);
  await dropGitkeep(dir);

  return { created: relative, registeredIn: `${dirname}/index.ts`, identifier };
}

export async function scaffoldTool(options: {
  ref: EnvironmentRef;
  name: string;
  description?: string;
  stateType?: string;
}): Promise<ScaffoldResult> {
  const { ref, name } = options;

  assertSafeName("tool", name);

  const stateType = assertSafeTypeName(options.stateType ?? (await detectStateType(ref)));
  const identifier = toIdentifier(name);
  const stem = toFileStem(name);
  const description = options.description ?? `TODO: describe what ${name} does.`;

  const contents = `import { defineTool, toolError } from "@burn0/silo";

import type { ${stateType} } from "../state.js";

export const ${identifier} = defineTool<${stateType}>({
  name: ${JSON.stringify(name)},
  description: ${JSON.stringify(description)},
  inputSchema: {
    type: "object",
    properties: {
      // TODO: describe each argument the agent may pass.
    },
    required: [],
    additionalProperties: false,
  },
  run(state, input) {
    // TODO: implement. Read or mutate \`state\` directly; Silo clones whatever
    // you return. Validate \`input\` before using it, and throw
    // toolError("invalid_input", "...") or toolError("not_found", "...") to
    // report a failure the agent can understand.
    throw toolError("invalid_state", ${JSON.stringify(`Tool "${name}" is not implemented yet.`)});
  },
});
`;

  return scaffold({
    ref,
    dirname: TOOLS_DIRNAME,
    stem,
    identifier,
    arrayName: "tools",
    contents,
  });
}

export async function scaffoldVerifier(options: {
  ref: EnvironmentRef;
  id: string;
  taskId: string;
  name?: string;
  stateType?: string;
}): Promise<ScaffoldResult> {
  const { ref, id, taskId } = options;

  assertSafeName("verifier id", id);
  assertSafeName("task id", taskId);

  const stateType = assertSafeTypeName(options.stateType ?? (await detectStateType(ref)));
  const identifier = toIdentifier(id);
  const name = options.name ?? `TODO: name what ${id} proves.`;

  const contents = `/**
 * Grades ${taskId}.
 *
 * Two shapes of task, two ways to grade:
 *
 * State-changing task — the agent must change the world.
 *   Derive truth from finalState, comparing against initialState where a delta
 *   matters. Example: final.customers["CUS-001"].status === "blocked".
 *
 * Question-answer task — the agent must report something, and correct
 * behaviour may change nothing at all.
 *   Derive the expected answer from initialState using your own domain helpers,
 *   then compare it against context.agentOutput.
 *   Example: totalProfit(initial) === parseAnswer(context.agentOutput).
 *
 * Never hardcode an answer that can be derived from the simulated world: a
 * verifier that reads the world keeps working when the data changes.
 *
 * Do not grade which tools were called, or in what order, unless the process
 * itself is what the task asks for.
 */

import { check, defineVerifier, optional } from "@burn0/silo";

import type { ${stateType} } from "../state.js";

export const ${identifier} = defineVerifier<${stateType}>({
  id: ${JSON.stringify(id)},
  taskId: ${JSON.stringify(taskId)},
  name: ${JSON.stringify(name)},
  check(finalState, initialState, context) {
    // TODO: replace this with the real success condition. It fails on purpose
    // so an unimplemented verifier can never report a passing run.
    return [
      check(
        "TODO: define success condition",
        false,
        ${JSON.stringify(`Verifier "${id}" is not implemented yet.`)},
      ),
      // optional("Corroborating evidence", true, "detail"),
    ];
  },
});
`;

  return scaffold({
    ref,
    dirname: VERIFIERS_DIRNAME,
    stem: id,
    identifier,
    arrayName: "verifiers",
    contents,
  });
}
