/**
 * The templates `silo init` can scaffold from.
 *
 * This is the only list. Adding a template means adding an entry here and a
 * matching directory under `templates/` — the wizard and the scaffolder both
 * read from it rather than keeping their own copies.
 */

import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { siloError } from "./errors.js";

export type TemplateId = "blank" | "erp" | "crm" | "project";

export type TemplateDefinition = {
  id: TemplateId;
  label: string;
};

const TEMPLATES_DIR = fileURLToPath(new URL("../../templates", import.meta.url));

export const TEMPLATES: TemplateDefinition[] = [
  { id: "blank", label: "Blank" },
  { id: "erp", label: "ERP" },
  { id: "crm", label: "CRM" },
  { id: "project", label: "Project tracking" },
];

export const DEFAULT_TEMPLATE_ID: TemplateId = "blank";

export function getTemplate(id: string): TemplateDefinition | undefined {
  return TEMPLATES.find((template) => template.id === id);
}

export function requireTemplate(id: string): TemplateDefinition {
  const template = getTemplate(id);

  if (!template) {
    throw siloError(
      "template_not_found",
      `Unknown template "${id}". Available: ${TEMPLATES.map((entry) => entry.id).join(", ")}.`,
      { id },
    );
  }

  return template;
}

/** Absolute path of the directory copied when scaffolding this template. */
export function templateSourceDir(template: TemplateDefinition): string {
  return join(TEMPLATES_DIR, template.id);
}
