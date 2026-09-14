/**
 * The programmatic authoring API.
 *
 * This is a thin, environment-scoped facade over `core/store.ts`,
 * `core/validate.ts` and `core/environment.ts` — the same functions the CLI
 * calls. There is no second implementation of anything, so the CLI, the SDK and
 * a future UI cannot drift apart.
 *
 * It authors resources. It does not write business logic: `state.ts`,
 * `environment.ts`, tool bodies and verifier bodies stay yours.
 */

import { stat } from "node:fs/promises";
import { resolve } from "node:path";

import { listEnvironments } from "./core/environment.js";
import { siloError } from "./core/errors.js";
import { scaffoldEnvironment } from "./core/scaffold.js";
import { DEFAULT_TEMPLATE_ID, type TemplateId } from "./core/templates.js";
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
  type DataEntry,
  type ScaffoldResult,
  type ToolEntry,
  type VerifierEntry,
} from "./core/store.js";
import type { EnvironmentRef, JsonValue, SiloTask } from "./core/types.js";
import { validateEnvironment, type ValidationReport } from "./core/validate.js";

export type SiloOptions = {
  /** Project root holding `.silo/`. Defaults to the current working directory. */
  cwd?: string;
};

export type CreateEnvironmentOptions = {
  name: string;
  template?: TemplateId;
  /** Optional tool packs, recorded in the manifest. */
  tools?: string[];
};

export type ScaffoldToolOptions = {
  name: string;
  description?: string;
  /** Overrides the state type detected from `state.ts`. */
  stateType?: string;
};

export type ScaffoldVerifierOptions = {
  id: string;
  taskId: string;
  name?: string;
  stateType?: string;
};

/** Datasets: arbitrary JSON, one document per name, stored at `data/<name>.json`. */
class DataResources {
  constructor(private readonly ref: EnvironmentRef) {}

  list(): Promise<DataEntry[]> {
    return listData(this.ref);
  }

  get(name: string): Promise<JsonValue> {
    return getData(this.ref, name);
  }

  add(name: string, value: JsonValue): Promise<string> {
    return putData(this.ref, name, value, "create");
  }

  update(name: string, value: JsonValue): Promise<string> {
    return putData(this.ref, name, value, "update");
  }

  /** Creates or replaces, whichever applies. */
  put(name: string, value: JsonValue): Promise<string> {
    return putData(this.ref, name, value, "upsert");
  }

  remove(name: string): Promise<string> {
    return removeData(this.ref, name);
  }
}

/** Tasks: objectives, stored at `tasks/<id>.json` and discovered from there. */
class TaskResources {
  constructor(private readonly ref: EnvironmentRef) {}

  async list(): Promise<SiloTask[]> {
    return (await listTasks(this.ref)).map((entry) => entry.task);
  }

  async get(id: string): Promise<SiloTask> {
    return (await getTask(this.ref, id)).task;
  }

  add(task: SiloTask): Promise<string> {
    return putTask(this.ref, task, "create");
  }

  update(task: SiloTask): Promise<string> {
    return putTask(this.ref, task, "update");
  }

  put(task: SiloTask): Promise<string> {
    return putTask(this.ref, task, "upsert");
  }

  remove(id: string): Promise<string> {
    return removeTask(this.ref, id);
  }
}

/**
 * Tools are code, so this scaffolds and inspects rather than pretending to CRUD.
 * `list` imports the environment, reporting what an agent would actually receive.
 */
class ToolResources {
  constructor(private readonly ref: EnvironmentRef) {}

  list(): Promise<ToolEntry[]> {
    return listTools(this.ref);
  }

  /** Writes `tools/<name>.ts` with a failing stub and registers it. */
  scaffold(options: ScaffoldToolOptions): Promise<ScaffoldResult> {
    return scaffoldTool({ ref: this.ref, ...options });
  }
}

class VerifierResources {
  constructor(private readonly ref: EnvironmentRef) {}

  list(): Promise<VerifierEntry[]> {
    return listVerifiers(this.ref);
  }

  /** Writes `verifiers/<id>.ts` with a deliberately failing check and registers it. */
  scaffold(options: ScaffoldVerifierOptions): Promise<ScaffoldResult> {
    return scaffoldVerifier({ ref: this.ref, ...options });
  }
}

export class SiloEnvironment {
  readonly name: string;
  readonly cwd: string;

  readonly data: DataResources;
  readonly tasks: TaskResources;
  readonly tools: ToolResources;
  readonly verifiers: VerifierResources;

  constructor(ref: EnvironmentRef) {
    this.name = ref.name;
    this.cwd = ref.cwd;

    this.data = new DataResources(ref);
    this.tasks = new TaskResources(ref);
    this.tools = new ToolResources(ref);
    this.verifiers = new VerifierResources(ref);
  }

  /** The same report `silo env validate --json` prints, typecheck included. */
  validate(): Promise<ValidationReport> {
    return validateEnvironment({ name: this.name, cwd: this.cwd });
  }
}

class EnvironmentRegistry {
  constructor(private readonly cwd: string) {}

  list(): Promise<string[]> {
    return listEnvironments(this.cwd);
  }

  /** Scaffolds a new environment, exactly as `silo init <name>` does. */
  async create(options: CreateEnvironmentOptions): Promise<SiloEnvironment> {
    await scaffoldEnvironment({
      name: options.name,
      template: options.template ?? DEFAULT_TEMPLATE_ID,
      tools: options.tools ?? [],
      cwd: this.cwd,
    });

    return new SiloEnvironment({ name: options.name, cwd: this.cwd });
  }

  /** Fails with `environment_not_found` if it is not on disk. */
  async open(name: string): Promise<SiloEnvironment> {
    if (!(await this.list()).includes(name.toLowerCase())) {
      throw siloError("environment_not_found", `Environment "${name}" was not found.`, { name });
    }

    return new SiloEnvironment({ name, cwd: this.cwd });
  }
}

export class Silo {
  readonly cwd: string;
  readonly environments: EnvironmentRegistry;

  private constructor(cwd: string) {
    this.cwd = cwd;
    this.environments = new EnvironmentRegistry(cwd);
  }

  /**
   * Binds to one project root. The path is captured here rather than read from
   * `process.cwd()` further down, so one process can serve several projects.
   */
  static async open(options: SiloOptions = {}): Promise<Silo> {
    const cwd = resolve(options.cwd ?? process.cwd());

    try {
      if (!(await stat(cwd)).isDirectory()) throw new Error("not a directory");
    } catch {
      throw siloError("environment_not_found", `Project directory "${cwd}" was not found.`, { cwd });
    }

    return new Silo(cwd);
  }

  /** Shorthand for `silo.environments.open(name)`. */
  environment(name: string): Promise<SiloEnvironment> {
    return this.environments.open(name);
  }
}
