/**
 * Silo's public authoring surface.
 *
 * Scaffolded environments import from here so there is one definition of the
 * contract rather than a copy per environment.
 */

export { Silo, SiloEnvironment } from "./sdk.js";
export type {
  CreateEnvironmentOptions,
  ScaffoldToolOptions,
  ScaffoldVerifierOptions,
  SiloOptions,
} from "./sdk.js";

export { SiloError, isSiloError } from "./core/errors.js";
export type { SiloErrorCode } from "./core/errors.js";

export type { DataEntry, ScaffoldResult, ToolEntry, VerifierEntry } from "./core/store.js";
export type { Finding, FindingLevel, ValidationReport } from "./core/validate.js";
export type { TemplateId } from "./core/templates.js";

export { ToolError, bindTools, defineTool, toolError } from "./core/tool.js";

export { check, defineVerifier, optional } from "./core/verifier.js";
export type { VerifierSpec } from "./core/verifier.js";

export type {
  EnvironmentModule,
  EnvironmentRef,
  JsonSchema,
  JsonValue,
  SiloTask,
  SiloTool,
  SiloVerifier,
  Tool,
  ToolDefinition,
  ToolErrorCode,
  ToolInput,
  ToolResult,
  VerifierCheck,
  VerifierContext,
  VerifierOutcome,
} from "./core/types.js";
