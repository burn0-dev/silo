/**
 * Authoring and binding of environment tools.
 *
 * A tool is written against the environment's own state type; `bindTools`
 * closes it over a rollout's state and converts it into the runtime shape Silo
 * hands to an agent.
 */

import type { SiloTool, Tool, ToolErrorCode, ToolInput } from "./types.js";
import { validateToolInput } from "./validate-input.js";

/** Thrown from a tool's `run` to report a structured, agent-readable failure. */
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

/**
 * Declares a tool. This is an identity function: its job is to pin the state
 * type so `run` gets full inference, and to give every environment one obvious
 * way to write a tool.
 */
export function defineTool<State>(tool: SiloTool<State>): SiloTool<State> {
  return tool;
}

function errorPayload(error: unknown): { code: ToolErrorCode; message: string; details?: unknown } {
  if (error instanceof ToolError) {
    return error.details === undefined
      ? { code: error.code, message: error.message }
      : { code: error.code, message: error.message, details: error.details };
  }

  return {
    code: "invalid_state",
    message: error instanceof Error ? error.message : String(error),
  };
}

/**
 * Binds tools to one rollout's state.
 *
 * Outputs are cloned so a tool result can never be used as a live handle back
 * into state, and so the trace records an immutable snapshot.
 */
export function bindTools<State>(state: State, tools: SiloTool<State>[]): Tool[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    async execute(input: unknown) {
      const args = (input ?? {}) as ToolInput;

      // Reported rather than ignored: an argument that contradicts the schema
      // means the agent misunderstood the tool, and silently dropping it lets
      // the tool answer a question that was never asked.
      const problems = validateToolInput(tool.inputSchema, args);

      if (problems.length > 0) {
        return {
          output: {
            code: "invalid_input" satisfies ToolErrorCode,
            message: `Invalid arguments for "${tool.name}": ${problems.join("; ")}.`,
            details: { problems },
          },
          isError: true,
        };
      }

      try {
        return { output: structuredClone(tool.run(state, args)) ?? null };
      } catch (error) {
        return { output: errorPayload(error), isError: true };
      }
    },
  }));
}
