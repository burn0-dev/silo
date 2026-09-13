import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export type Template = "blank" | "erp";

export type ScaffoldEnvironmentInput = {
  name: string;
  template: Template;
  tools: string[];
};

const TEMPLATES_DIR = fileURLToPath(
  new URL("../../templates", import.meta.url),
);

export const ENVIRONMENTS_DIR = join(process.cwd(), ".silo", "environments");

export async function listEnvironments() {
  try {
    const entries = await readdir(ENVIRONMENTS_DIR, { withFileTypes: true });

    return entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name.toLowerCase());
  } catch {
    return [];
  }
}

export async function scaffoldEnvironment({
  name,
  template,
  tools,
}: ScaffoldEnvironmentInput) {
  const environmentDir = join(ENVIRONMENTS_DIR, name);

  if ((await listEnvironments()).includes(name.toLowerCase())) {
    throw new Error(`Environment "${name}" already exists.`);
  }

  await mkdir(ENVIRONMENTS_DIR, { recursive: true });

  const stagingDir = await mkdtemp(join(ENVIRONMENTS_DIR, ".staging-"));

  try {
    await cp(join(TEMPLATES_DIR, template), stagingDir, {
      recursive: true,
    });

    await writeFile(
      join(stagingDir, "silo.json"),
      JSON.stringify(
        {
          name,
          template,
          tools,
        },
        null,
        2,
      ) + "\n",
    );

    await rename(stagingDir, environmentDir);
  } catch (err) {
    await rm(stagingDir, { recursive: true, force: true });

    throw err;
  }

  return environmentDir;
}
