/**
 * Tool contract for the ERP environment.
 *
 * Tools are plain data: a name, a description, a JSON Schema for the input, and a
 * synchronous `execute` that reads and mutates the simulated ERP state. Nothing
 * here knows about any model provider or agent framework — binding these to a
 * runtime is the caller's job (see `bindTools` in the template index).
 */

import type { ErpState } from "../state.js";

export type JsonSchema = Record<string, unknown>;

export type ToolInput = Record<string, unknown>;

export type ToolErrorCode =
  | "invalid_input"
  | "not_found"
  | "invalid_state"
  | "not_allowed"
  | "insufficient_stock"
  | "limit_exceeded"
  | "conflict";

export type ToolOutcome =
  | { ok: true; data: unknown }
  | { ok: false; error: { code: ToolErrorCode; message: string; details?: unknown } };

export type ErpTool = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  execute: (state: ErpState, input: ToolInput) => ToolOutcome;
};

/**
 * Thrown by the validation and lookup helpers; `defineTool` converts it into a
 * structured failure so individual tools never write try/catch boilerplate.
 */
export class ToolError extends Error {
  readonly code: ToolErrorCode;
  readonly details: unknown;

  constructor(code: ToolErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "ToolError";
    this.code = code;
    this.details = details;
  }
}

export function toolError(
  code: ToolErrorCode,
  message: string,
  details?: unknown,
): ToolError {
  return new ToolError(code, message, details);
}

export function defineTool(spec: {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  run: (state: ErpState, input: ToolInput) => unknown;
}): ErpTool {
  return {
    name: spec.name,
    description: spec.description,
    inputSchema: spec.inputSchema,
    execute(state, input) {
      try {
        return { ok: true, data: spec.run(state, input ?? {}) };
      } catch (error) {
        if (error instanceof ToolError) {
          return error.details === undefined
            ? { ok: false, error: { code: error.code, message: error.message } }
            : {
                ok: false,
                error: {
                  code: error.code,
                  message: error.message,
                  details: error.details,
                },
              };
        }

        return {
          ok: false,
          error: {
            code: "invalid_state",
            message: error instanceof Error ? error.message : String(error),
          },
        };
      }
    },
  };
}

// --- schema builders -------------------------------------------------------

export const S = {
  string(description: string, extra: JsonSchema = {}): JsonSchema {
    return { type: "string", description, ...extra };
  },
  number(description: string, extra: JsonSchema = {}): JsonSchema {
    return { type: "number", description, ...extra };
  },
  integer(description: string, extra: JsonSchema = {}): JsonSchema {
    return { type: "integer", description, ...extra };
  },
  boolean(description: string): JsonSchema {
    return { type: "boolean", description };
  },
  enumeration(description: string, values: readonly string[]): JsonSchema {
    return { type: "string", description, enum: [...values] };
  },
  array(description: string, items: JsonSchema): JsonSchema {
    return { type: "array", description, items };
  },
  object(
    description: string,
    properties: Record<string, JsonSchema>,
    required: string[] = [],
  ): JsonSchema {
    return {
      type: "object",
      description,
      properties,
      required,
      additionalProperties: false,
    };
  },
};

export function schema(
  properties: Record<string, JsonSchema>,
  required: string[] = [],
): JsonSchema {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

/** Standard paging properties, spread into list-tool schemas. */
export const pagingProperties: Record<string, JsonSchema> = {
  limit: S.integer("Maximum rows to return (default 50).", { minimum: 1, maximum: 500 }),
  offset: S.integer("Rows to skip before returning results (default 0).", { minimum: 0 }),
};

// --- input readers ---------------------------------------------------------

export function readString(input: ToolInput, field: string): string {
  const value = input[field];

  if (typeof value !== "string" || value.trim() === "") {
    throw toolError("invalid_input", `"${field}" must be a non-empty string.`);
  }

  return value.trim();
}

export function readOptionalString(
  input: ToolInput,
  field: string,
): string | undefined {
  const value = input[field];

  if (value === undefined || value === null) {
    return undefined;
  }

  return readString(input, field);
}

export function readNumber(
  input: ToolInput,
  field: string,
  options: { min?: number; max?: number; integer?: boolean } = {},
): number {
  const value = input[field];

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw toolError("invalid_input", `"${field}" must be a number.`);
  }

  if (options.integer && !Number.isInteger(value)) {
    throw toolError("invalid_input", `"${field}" must be a whole number.`);
  }

  if (options.min !== undefined && value < options.min) {
    throw toolError("invalid_input", `"${field}" must be at least ${options.min}.`);
  }

  if (options.max !== undefined && value > options.max) {
    throw toolError("invalid_input", `"${field}" must be at most ${options.max}.`);
  }

  return value;
}

export function readOptionalNumber(
  input: ToolInput,
  field: string,
  options: { min?: number; max?: number; integer?: boolean } = {},
): number | undefined {
  if (input[field] === undefined || input[field] === null) {
    return undefined;
  }

  return readNumber(input, field, options);
}

export function readBoolean(
  input: ToolInput,
  field: string,
  fallback: boolean,
): boolean {
  const value = input[field];

  if (value === undefined || value === null) {
    return fallback;
  }

  if (typeof value !== "boolean") {
    throw toolError("invalid_input", `"${field}" must be true or false.`);
  }

  return value;
}

export function readEnum<T extends string>(
  input: ToolInput,
  field: string,
  values: readonly T[],
): T {
  const value = readString(input, field);

  if (!values.includes(value as T)) {
    throw toolError(
      "invalid_input",
      `"${field}" must be one of: ${values.join(", ")}.`,
      { received: value },
    );
  }

  return value as T;
}

export function readOptionalEnum<T extends string>(
  input: ToolInput,
  field: string,
  values: readonly T[],
): T | undefined {
  if (input[field] === undefined || input[field] === null) {
    return undefined;
  }

  return readEnum(input, field, values);
}

export function readStringArray(input: ToolInput, field: string): string[] {
  const value = input[field];

  if (!Array.isArray(value) || value.length === 0) {
    throw toolError("invalid_input", `"${field}" must be a non-empty array.`);
  }

  return value.map((item, index) => {
    if (typeof item !== "string" || item.trim() === "") {
      throw toolError("invalid_input", `"${field}[${index}]" must be a non-empty string.`);
    }

    return item.trim();
  });
}

export function readObjectArray(input: ToolInput, field: string): ToolInput[] {
  const value = input[field];

  if (!Array.isArray(value) || value.length === 0) {
    throw toolError("invalid_input", `"${field}" must be a non-empty array.`);
  }

  return value.map((item, index) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw toolError("invalid_input", `"${field}[${index}]" must be an object.`);
    }

    return item as ToolInput;
  });
}

export function paginate<T>(items: T[], input: ToolInput): {
  total: number;
  count: number;
  offset: number;
  results: T[];
} {
  const limit = readOptionalNumber(input, "limit", { min: 1, max: 500, integer: true }) ?? 50;
  const offset = readOptionalNumber(input, "offset", { min: 0, integer: true }) ?? 0;
  const results = items.slice(offset, offset + limit);

  return { total: items.length, count: results.length, offset, results };
}

/** Case-insensitive substring match used by every search tool. */
export function matchesText(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}
