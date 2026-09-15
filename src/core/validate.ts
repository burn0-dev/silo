/**
 * Static checks over an environment, short of running an agent.
 *
 * Everything here is cheap and deterministic: parse the JSON, load the runtime
 * once, and confirm the pieces refer to each other correctly. It deliberately
 * does not analyse the bodies of tools or verifiers — that is what a run is for.
 */

import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import ts from "typescript";

import { MANIFEST_FILENAME, openEnvironment, requireEnvironmentDir } from "./environment.js";
import { DATA_DIRNAME } from "./store.js";
import type { EnvironmentRef, SiloTask } from "./types.js";

export type FindingLevel = "error" | "warning";

export type Finding = {
  level: FindingLevel;
  code: string;
  message: string;
};

export type ValidationReport = {
  environment: string;
  ok: boolean;
  findings: Finding[];
  counts: {
    data: number;
    tasks: number;
    tools: number;
    verifiers: number;
  };
};

/** Compiler settings used when a project has no `.silo/tsconfig.json`. */
const FALLBACK_COMPILER_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  strict: true,
  verbatimModuleSyntax: true,
  resolveJsonModule: true,
  esModuleInterop: true,
  skipLibCheck: true,
};

async function collectTypeScriptFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const path = join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectTypeScriptFiles(path)));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      files.push(path);
    }
  }

  return files;
}

/**
 * Runs the real TypeScript compiler over the environment's own files.
 *
 * An environment that loads at runtime can still be uncompilable, because
 * type-only imports are erased before execution — so "it ran" is not evidence
 * that it is correct. Diagnostics are scoped to files inside the environment so
 * a user's unrelated application code is never dragged in.
 */
async function typecheck(path: string): Promise<Finding[]> {
  const rootNames = await collectTypeScriptFiles(path);

  if (rootNames.length === 0) return [];

  const configPath = join(path, "..", "..", "tsconfig.json");
  let options: ts.CompilerOptions = FALLBACK_COMPILER_OPTIONS;

  if (ts.sys.fileExists(configPath)) {
    const read = ts.readConfigFile(configPath, ts.sys.readFile);

    if (read.error) {
      return [
        {
          level: "error",
          code: "typecheck_config_invalid",
          message: `.silo/tsconfig.json could not be read: ${ts.flattenDiagnosticMessageText(read.error.messageText, " ")}`,
        },
      ];
    }

    options = ts.parseJsonConfigFileContent(
      read.config,
      ts.sys,
      dirname(configPath),
    ).options;
  }

  const program = ts.createProgram(rootNames, { ...options, noEmit: true });
  const findings: Finding[] = [];
  const root = resolve(path);

  for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");

    if (!diagnostic.file) {
      findings.push({ level: "error", code: "typecheck", message });
      continue;
    }

    const file = resolve(diagnostic.file.fileName);

    if (!file.startsWith(root)) continue;

    const at = diagnostic.start ?? 0;
    const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(at);
    const where = `${relative(root, file)}:${line + 1}:${character + 1}`;

    findings.push({ level: "error", code: "typecheck", message: `${where} ${message}` });
  }

  return findings;
}

export async function validateEnvironment(ref: EnvironmentRef): Promise<ValidationReport> {
  const findings: Finding[] = [];
  const counts = { data: 0, tasks: 0, tools: 0, verifiers: 0 };

  const error = (code: string, message: string) =>
    findings.push({ level: "error", code, message });
  const warn = (code: string, message: string) =>
    findings.push({ level: "warning", code, message });

  const path = await requireEnvironmentDir(ref);

  // --- data ---------------------------------------------------------------
  const dataDir = join(path, DATA_DIRNAME);

  let dataFiles: string[] = [];

  try {
    dataFiles = (await readdir(dataDir)).filter((file) => file.endsWith(".json"));
  } catch {
    warn("data_dir_missing", `No ${DATA_DIRNAME}/ directory.`);
  }

  for (const file of dataFiles) {
    try {
      JSON.parse(await readFile(join(dataDir, file), "utf8"));
      counts.data += 1;
    } catch (thrown) {
      error("data_invalid_json", `${DATA_DIRNAME}/${file} is not valid JSON: ${(thrown as Error).message}`);
    }
  }

  // --- runtime ------------------------------------------------------------
  // Tasks come from the opened environment rather than straight off disk, so
  // validation resolves them exactly the way a run does — JSON files first,
  // falling back to the module's `tasks` export.
  let tasks: SiloTask[] = [];
  let verifierIds: string[] = [];

  try {
    const opened = await openEnvironment(ref);

    tasks = opened.tasks;
    counts.tasks = tasks.length;

    try {
      JSON.parse(await readFile(join(path, MANIFEST_FILENAME), "utf8"));
    } catch {
      warn("manifest_missing", `No ${MANIFEST_FILENAME}; defaults were used.`);
    }

    let state: unknown;

    try {
      state = opened.runtime.createState();
    } catch (thrown) {
      error("create_state_failed", `createState() threw: ${(thrown as Error).message}`);
    }

    if (state !== undefined) {
      try {
        const tools = opened.runtime.bindTools(state);

        counts.tools = tools.length;

        const seenTools = new Set<string>();

        for (const tool of tools) {
          if (!tool.name || typeof tool.name !== "string") {
            error("tool_unnamed", "A bound tool has no name.");
            continue;
          }

          if (seenTools.has(tool.name)) {
            error("tool_duplicate_name", `Tool name "${tool.name}" is registered more than once.`);
          }

          seenTools.add(tool.name);

          if (!tool.description) {
            warn("tool_no_description", `Tool "${tool.name}" has no description; the agent sees this.`);
          }
        }
      } catch (thrown) {
        error("bind_tools_failed", `bindTools(state) threw: ${(thrown as Error).message}`);
      }
    }

    const verifiers = opened.runtime.verifiers;

    counts.verifiers = verifiers.length;
    verifierIds = verifiers.map((verifier) => verifier.id);

    const seenVerifiers = new Set<string>();

    for (const verifier of verifiers) {
      if (seenVerifiers.has(verifier.id)) {
        error("verifier_duplicate_id", `Verifier id "${verifier.id}" is registered more than once.`);
      }

      seenVerifiers.add(verifier.id);

      const task = tasks.find((candidate) => candidate.id === verifier.taskId);

      if (!task) {
        warn(
          "verifier_orphan",
          `Verifier "${verifier.id}" names task "${verifier.taskId}", which does not exist.`,
        );
      } else if (task.verifierId !== verifier.id) {
        error(
          "verifier_task_mismatch",
          `Verifier "${verifier.id}" claims task "${verifier.taskId}", but that task is graded by "${task.verifierId}".`,
        );
      }
    }
  } catch (thrown) {
    error("runtime_load_failed", (thrown as Error).message);
  }

  // --- cross references ---------------------------------------------------
  for (const task of tasks) {
    if (!verifierIds.includes(task.verifierId)) {
      error(
        "task_verifier_unresolved",
        `Task "${task.id}" names verifier "${task.verifierId}", which is not registered.`,
      );
    }
  }

  if (tasks.length === 0) {
    warn("no_tasks", "No tasks defined, so this environment cannot be run yet.");
  }

  if (counts.tools === 0) {
    warn("no_tools", "No tools registered, so the agent cannot observe or change anything.");
  }

  findings.push(...(await typecheck(path)));

  return {
    environment: ref.name,
    ok: !findings.some((finding) => finding.level === "error"),
    findings,
    counts,
  };
}
