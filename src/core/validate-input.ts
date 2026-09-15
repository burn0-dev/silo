/**
 * Checks a tool's arguments against its own declared input schema.
 *
 * A tool schema is the only description of a tool an agent ever sees, so an
 * argument that contradicts it is a mistake worth reporting. Without this, a
 * hallucinated property is silently dropped and the tool answers a question
 * nobody asked — which reads to the agent like a real answer.
 *
 * This covers the parts of JSON Schema that tool inputs actually use. It is not
 * a full implementation and does not try to be.
 */

import type { JsonSchema, ToolInput } from "./types.js";

type Schema = Record<string, unknown>;

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";

  return typeof value;
}

function matchesType(value: unknown, expected: string): boolean {
  if (expected === "integer") return typeof value === "number" && Number.isInteger(value);
  if (expected === "number") return typeof value === "number" && Number.isFinite(value);
  if (expected === "array") return Array.isArray(value);
  if (expected === "object") {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
  if (expected === "null") return value === null;

  return typeOf(value) === expected;
}

function describe(schema: Schema): string {
  const type = schema.type;

  return typeof type === "string" ? type : "the declared type";
}

/** Walks one value against one schema, collecting every problem it finds. */
function checkValue(value: unknown, schema: Schema, path: string, problems: string[]): void {
  const type = schema.type;

  if (typeof type === "string" && !matchesType(value, type)) {
    problems.push(`"${path}" must be ${describe(schema)}, received ${typeOf(value)}`);
    return;
  }

  const allowed = schema.enum;

  if (Array.isArray(allowed) && !allowed.includes(value as never)) {
    problems.push(`"${path}" must be one of: ${allowed.join(", ")}`);
    return;
  }

  if (type === "array" && Array.isArray(value) && typeof schema.items === "object") {
    const items = schema.items as Schema;

    value.forEach((entry, index) => checkValue(entry, items, `${path}[${index}]`, problems));
  }

  if (type === "object" && matchesType(value, "object")) {
    checkObject(value as ToolInput, schema, path, problems);
  }
}

function checkObject(value: ToolInput, schema: Schema, path: string, problems: string[]): void {
  const properties = (schema.properties ?? {}) as Record<string, Schema>;
  const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];

  for (const field of required) {
    if (value[field] === undefined || value[field] === null) {
      problems.push(`"${path ? `${path}.` : ""}${field}" is required`);
    }
  }

  if (schema.additionalProperties === false) {
    const declared = new Set(Object.keys(properties));

    for (const field of Object.keys(value)) {
      if (!declared.has(field)) {
        const known = [...declared].join(", ");

        problems.push(
          `"${field}" is not a parameter${known ? `; expected one of: ${known}` : ""}`,
        );
      }
    }
  }

  for (const [field, propertySchema] of Object.entries(properties)) {
    const entry = value[field];

    // Absent optional fields are fine; a missing required one is already reported.
    if (entry === undefined || entry === null) continue;

    checkValue(entry, propertySchema, path ? `${path}.${field}` : field, problems);
  }
}

/**
 * Returns the reasons `input` does not satisfy `schema`, or an empty array.
 * A schema that is not an object schema is treated as accepting anything.
 */
export function validateToolInput(schema: JsonSchema, input: ToolInput): string[] {
  const root = schema as Schema;

  if (root.type !== "object") return [];

  const problems: string[] = [];

  checkObject(input, root, "", problems);

  return problems;
}
