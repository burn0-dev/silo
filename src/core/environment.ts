/**
 * The one way Silo opens an environment.
 *
 * Everything that knows where environments live, what their manifest looks
 * like, and how their runtime is imported belongs here — callers pass a name
 * and get back a loaded, validated environment.
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { tsImport } from "tsx/esm/api";

import { siloError } from "./errors.js";
import type { EnvironmentModule, EnvironmentRef, SiloTask } from "./types.js";

export const MANIFEST_FILENAME = "silo.environment.json";
export const TASKS_DIRNAME = "tasks";
const DEFAULT_ENTRYPOINT = "./index.ts";

/** Everything Silo owns in a project lives under this directory. */
export function siloDir(cwd: string): string {
  return join(cwd, ".silo");
}

export function environmentsDir(cwd: string): string {
  return join(siloDir(cwd), "environments");
}

export type EnvironmentManifest = {
  name: string;
  /** Null when the environment has no manifest to describe itself. */
  template: string | null;
  templateVersion: string | null;
  entrypoint: string;
  /**
   * Optional tool packs chosen at init. Recorded only; nothing binds them to
   * the runtime yet.
   */
  tools: string[];
};

export type OpenedEnvironment = {
  name: string;
  path: string;
  manifest: EnvironmentManifest;
  /** Absolute path of the module `runtime` was imported from. */
  entrypoint: string;
  runtime: EnvironmentModule;
  /** Discovered from `tasks/*.json`, sorted by id. */
  tasks: SiloTask[];
};

export function environmentPath(ref: EnvironmentRef): string {
  return join(environmentsDir(ref.cwd), ref.name);
}

export async function listEnvironments(cwd: string): Promise<string[]> {
  try {
    const entries = await readdir(environmentsDir(cwd), { withFileTypes: true });

    return entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name.toLowerCase());
  } catch {
    return [];
  }
}

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null;

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

async function readJsonFile(path: string): Promise<Record<string, unknown> | null> {
  let raw: string;

  try {
    raw = await readFile(path, "utf8");
  } catch {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw siloError("invalid_json", `"${path}" is not valid JSON.`, { path });
  }

  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : null;
}

/** Resolves an environment directory, failing with a listing if it is missing. */
export async function requireEnvironmentDir(ref: EnvironmentRef): Promise<string> {
  const path = environmentPath(ref);

  await assertEnvironmentDir(ref, path);

  return path;
}

async function assertEnvironmentDir(ref: EnvironmentRef, path: string): Promise<void> {
  try {
    if ((await stat(path)).isDirectory()) return;
  } catch {
    // Falls through to the not-found message below.
  }

  const available = await listEnvironments(ref.cwd);

  throw siloError(
    "environment_not_found",
    available.length
      ? `Environment "${ref.name}" was not found in .silo/environments. Available: ${available.join(", ")}.`
      : `Environment "${ref.name}" was not found. Run "silo init" to create one.`,
    { environment: ref.name, available },
  );
}

/** An environment without a manifest still loads from the conventional entrypoint. */
async function readManifest(ref: EnvironmentRef, path: string): Promise<EnvironmentManifest> {
  const manifest = await readJsonFile(join(path, MANIFEST_FILENAME));

  return {
    name: asString(manifest?.name) ?? ref.name,
    template: asString(manifest?.template),
    templateVersion: asString(manifest?.templateVersion),
    entrypoint: asString(manifest?.entrypoint) ?? DEFAULT_ENTRYPOINT,
    tools: asStringArray(manifest?.tools),
  };
}

function resolveEntrypoint(name: string, path: string, entrypoint: string): string {
  const resolved = resolve(path, entrypoint);
  const within = relative(path, resolved);

  if (within.startsWith("..") || isAbsolute(within)) {
    throw siloError(
      "entrypoint_outside_environment",
      `Environment "${name}" declares entrypoint "${entrypoint}", which resolves outside the environment directory.`,
      { environment: name, entrypoint },
    );
  }

  return resolved;
}

function assertRuntime(
  name: string,
  runtime: Partial<EnvironmentModule>,
): asserts runtime is EnvironmentModule {
  for (const method of ["createState", "bindTools"] as const) {
    if (typeof runtime[method] !== "function") {
      throw siloError(
        "runtime_contract_invalid",
        `Environment "${name}" does not export ${method}(). A runnable environment must export createState, bindTools and verifiers.`,
        { environment: name, missing: method },
      );
    }
  }

  if (!Array.isArray(runtime.verifiers)) {
    throw siloError(
      "runtime_contract_invalid",
      `Environment "${name}" does not export a verifiers array.`,
      { environment: name, missing: "verifiers" },
    );
  }
}

const TASK_FIELDS = ["id", "title", "instruction", "verifierId"] as const;

function parseTask(name: string, file: string, document: Record<string, unknown>): SiloTask {
  for (const field of TASK_FIELDS) {
    if (!asString(document[field])) {
      throw siloError(
        "task_invalid",
        `Task file "${file}" in environment "${name}" is missing a non-empty "${field}".`,
        { environment: name, file, field },
      );
    }
  }

  return {
    id: String(document.id),
    title: String(document.title),
    instruction: String(document.instruction),
    verifierId: String(document.verifierId),
    difficulty: asString(document.difficulty) ?? "unspecified",
  };
}

/**
 * Tasks are data, so they are discovered rather than registered. The module's
 * `tasks` export is a fallback for environments that have not moved to JSON.
 */
async function readTasks(
  name: string,
  path: string,
  runtime: EnvironmentModule,
): Promise<SiloTask[]> {
  const tasksDir = join(path, TASKS_DIRNAME);

  let files: string[];

  try {
    files = (await readdir(tasksDir)).filter((file) => file.endsWith(".json")).sort();
  } catch {
    files = [];
  }

  if (files.length === 0) {
    return runtime.tasks ?? [];
  }

  const tasks: SiloTask[] = [];
  const seen = new Map<string, string>();

  for (const file of files) {
    const document = await readJsonFile(join(tasksDir, file));

    if (!document) {
      throw siloError(
        "task_invalid",
        `Task file "${file}" in environment "${name}" is not a JSON object.`,
        { environment: name, file },
      );
    }

    const task = parseTask(name, file, document);
    const duplicate = seen.get(task.id);

    if (duplicate) {
      throw siloError(
        "task_invalid",
        `Task id "${task.id}" is declared twice in environment "${name}": ${duplicate} and ${file}.`,
        { environment: name, id: task.id, files: [duplicate, file] },
      );
    }

    seen.set(task.id, file);
    tasks.push(task);
  }

  return tasks.sort((a, b) => a.id.localeCompare(b.id));
}

export async function openEnvironment(ref: EnvironmentRef): Promise<OpenedEnvironment> {
  const { name } = ref;
  const path = environmentPath(ref);

  await assertEnvironmentDir(ref, path);

  const manifest = await readManifest(ref, path);
  const entrypoint = resolveEntrypoint(name, path, manifest.entrypoint);

  const runtime = (await tsImport(
    pathToFileURL(entrypoint).href,
    import.meta.url,
  )) as Partial<EnvironmentModule>;

  assertRuntime(name, runtime);

  const tasks = await readTasks(name, path, runtime);

  return { name, path, manifest, entrypoint, runtime, tasks };
}
