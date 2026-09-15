/**
 * Shared machinery for the per-template regression gates.
 *
 * Every gate does the same thing: scaffold a throwaway environment from the
 * CURRENT template, run its tasks with a fixed agent, and byte-compare the
 * artifacts that carry no timestamps or run ids.
 *
 * Scaffolding fresh matters. An environment already sitting in `.silo/` is a
 * copy taken when it was created, so testing one would pass no matter what the
 * template does.
 */

import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runTask } from "../src/core/run.js";
import { scaffoldEnvironment } from "../src/core/scaffold.js";

/** The artifacts with no timestamps or run ids in them — the regression oracle. */
const ARTIFACTS = ["result", "state-diff"];

/**
 * Creates a temp project a scaffolded environment can actually run inside.
 *
 * It needs `{"type":"module"}` or the loader treats environment modules as
 * CommonJS and the contract exports end up nested under `.default`, and it
 * needs the package resolvable by name, exactly as a user's project would.
 */
async function createProject(prefix) {
  const project = await mkdtemp(join(tmpdir(), prefix));

  await writeFile(join(project, "package.json"), '{"name":"silo-gate","type":"module"}\n');

  const packageRoot = new URL("../", import.meta.url).pathname;
  await mkdir(join(project, "node_modules", "@burn0"), { recursive: true });
  await symlink(packageRoot, join(project, "node_modules", "@burn0", "silo"), "dir");

  return project;
}

/**
 * Runs one template's tasks against its baselines.
 *
 * Task ids come from the scaffolded environment rather than from the baseline
 * directory, so a task added to a template without a recorded baseline fails
 * loudly instead of being skipped.
 */
export async function runTemplateBaseline({
  template,
  baselineDir,
  agentPath,
  update,
  label = template.toUpperCase(),
  describe = (result) => `reward=${result.reward}`,
}) {
  const environment = `${template}-baseline`;
  const project = await createProject(`silo-${template}-`);
  const runsDir = join(project, "runs");

  let failures = 0;
  let taskIds = [];

  try {
    await scaffoldEnvironment({ name: environment, template, tools: [], cwd: project });

    const tasksDir = join(project, ".silo", "environments", environment, "tasks");
    taskIds = (await readdir(tasksDir))
      .filter((file) => file.endsWith(".json"))
      .map((file) => file.replace(/\.json$/, ""))
      .sort();

    if (update) await mkdir(baselineDir, { recursive: true });

    for (const taskId of taskIds) {
      const result = await runTask({
        environmentName: environment,
        cwd: project,
        taskId,
        agentPath,
        runsDir,
      });

      for (const artifact of ARTIFACTS) {
        const actual = await readFile(join(result.runDir, `${artifact}.json`), "utf8");
        const path = join(baselineDir, `${taskId}.${artifact}.json`);

        if (update) {
          await writeFile(path, actual);
          continue;
        }

        const expected = await readFile(path, "utf8").catch(() => null);

        if (expected === null) {
          console.error(`MISSING ${taskId} ${artifact}.json — re-record with -- --update`);
          failures += 1;
          continue;
        }

        if (actual !== expected) {
          console.error(`DRIFT  ${taskId} ${artifact}.json`);
          failures += 1;
        }
      }

      if (!update) console.log(`ok     ${taskId}  ${describe(result)}`);
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }

  if (update) {
    console.log(`updated ${taskIds.length} baselines from templates/${template}`);

    return 0;
  }

  if (failures) {
    console.error(`\n${failures} artifact(s) drifted from baseline.`);

    return failures;
  }

  console.log(`\nall ${taskIds.length} ${label} tasks match baseline`);

  return 0;
}
