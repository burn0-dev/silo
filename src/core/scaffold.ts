import { cp, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { MANIFEST_FILENAME, environmentsDir, listEnvironments, siloDir } from "./environment.js";
import { siloError } from "./errors.js";
import { assertSafeName } from "./store.js";
import { requireTemplate, templateSourceDir, type TemplateId } from "./templates.js";

export type ScaffoldEnvironmentInput = {
  name: string;
  template: TemplateId;
  tools: string[];
  cwd: string;
};

/** Stamped into each scaffold so a manifest records what it was built from. */
const TEMPLATE_VERSION = "0.3.0";

/**
 * TypeScript settings for environment code.
 *
 * This lives at `.silo/tsconfig.json` rather than the project root because the
 * root config belongs to the user's own application — Silo should never own or
 * overwrite it. Scoping here also keeps environment code out of the app's
 * compilation and vice versa.
 *
 * `types` is left unset so a project with no @types installed still checks
 * cleanly, while one that adds @types/node picks them up automatically.
 */
const SILO_TSCONFIG = {
  compilerOptions: {
    target: "ES2022",
    module: "NodeNext",
    moduleResolution: "NodeNext",
    noEmit: true,
    strict: true,
    verbatimModuleSyntax: true,
    resolveJsonModule: true,
    esModuleInterop: true,
    forceConsistentCasingInFileNames: true,
    skipLibCheck: true,
  },
  include: ["environments/**/*.ts"],
};

/** Written once per project; an existing config is always left alone. */
async function ensureSiloTsconfig(cwd: string): Promise<void> {
  const path = join(siloDir(cwd), "tsconfig.json");

  try {
    await writeFile(path, `${JSON.stringify(SILO_TSCONFIG, null, 2)}\n`, { flag: "wx" });
  } catch {
    // Already present: the developer's version wins.
  }
}

export async function scaffoldEnvironment({
  name,
  template,
  tools,
  cwd,
}: ScaffoldEnvironmentInput) {
  // The name becomes a directory under .silo/environments, so it must not be
  // able to climb out of it.
  assertSafeName("environment", name);

  const definition = requireTemplate(template);
  const root = environmentsDir(cwd);
  const environmentDir = join(root, name);

  if ((await listEnvironments(cwd)).includes(name.toLowerCase())) {
    throw siloError("environment_already_exists", `Environment "${name}" already exists.`, { name });
  }

  await mkdir(root, { recursive: true });

  const stagingDir = await mkdtemp(join(root, ".staging-"));

  try {
    await cp(templateSourceDir(definition), stagingDir, {
      recursive: true,
    });

    await writeFile(
      join(stagingDir, MANIFEST_FILENAME),
      JSON.stringify(
        {
          name,
          template,
          templateVersion: TEMPLATE_VERSION,
          entrypoint: "./index.ts",
          tools,
        },
        null,
        2,
      ) + "\n",
    );

    await rename(stagingDir, environmentDir);
    await ensureSiloTsconfig(cwd);
  } catch (err) {
    await rm(stagingDir, { recursive: true, force: true });

    throw err;
  }

  return environmentDir;
}
