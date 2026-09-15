/**
 * The one error type Silo throws for expected, actionable failures.
 *
 * Callers switch on `code` rather than matching message text, so the CLI, the
 * SDK and a future UI can all react to the same conditions without parsing
 * strings. Unexpected failures stay as ordinary Errors.
 */

export type SiloErrorCode =
  | "environment_not_found"
  | "environment_already_exists"
  | "template_not_found"
  | "entrypoint_outside_environment"
  | "runtime_contract_invalid"
  | "unsafe_name"
  | "invalid_json"
  | "data_not_found"
  | "data_already_exists"
  | "task_not_found"
  | "task_already_exists"
  | "task_invalid"
  | "tool_already_exists"
  | "verifier_already_exists"
  | "registry_not_found"
  | "already_registered"
  | "state_type_not_found";

export class SiloError extends Error {
  readonly code: SiloErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: SiloErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "SiloError";
    this.code = code;
    this.details = details;
  }
}

export function siloError(
  code: SiloErrorCode,
  message: string,
  details?: Record<string, unknown>,
): SiloError {
  return new SiloError(code, message, details);
}

export function isSiloError(value: unknown): value is SiloError {
  return value instanceof SiloError;
}
