export type JsonSchema = Record<string, unknown>;

/** Any value that survives a JSON round trip. Datasets may be any shape. */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * Names one environment inside one project.
 *
 * Every store operation takes this rather than reading `process.cwd()`, so a
 * single process can work across several projects.
 */
export type EnvironmentRef = {
  name: string;
  cwd: string;
};

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
};

export type ToolResult = {
  output: unknown;
  isError?: boolean;
};

export type Tool = ToolDefinition & {
  execute: (input: unknown) => Promise<ToolResult>;
};

/** Whatever the agent passed as tool arguments. Always validate before use. */
export type ToolInput = Record<string, unknown>;

/**
 * Conventional failure codes. Any string is accepted so an environment can add
 * its own vocabulary; prefer one of these when it fits.
 */
export type ToolErrorCode =
  | "invalid_input"
  | "not_found"
  | "invalid_state"
  | "not_allowed"
  | "limit_exceeded"
  | "conflict"
  | (string & {});

/**
 * A tool as authored inside an environment: it receives the live state plus the
 * agent's input. `bindTools` turns these into the runtime `Tool` shape.
 */
export type SiloTool<State> = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  run: (state: State, input: ToolInput) => unknown;
};

export type VerifierCheck = {
  label: string;
  passed: boolean;
  detail: string;
  required: boolean;
};

export type VerifierOutcome = {
  verifierId: string;
  taskId: string;
  passed: boolean;
  reward: number;
  requiredPassed: number;
  requiredTotal: number;
  failedRequired: string[];
  checks: VerifierCheck[];
};

export type SiloTask = {
  id: string;
  title: string;
  instruction: string;
  difficulty: string;
  verifierId: string;
};

/**
 * What the rollout produced besides state.
 *
 * State-changing tasks are normally graded on `finalState` alone. Tasks that
 * ask a question — where answering correctly changes nothing — grade
 * `agentOutput` against truth derived from the world.
 */
export type VerifierContext = {
  /** The agent's final output, coerced to text. Empty string if it produced none. */
  agentOutput: string;
  task: SiloTask;
};

export type SiloVerifier = {
  id: string;
  taskId: string;
  name: string;
  check: (
    finalState: unknown,
    initialState: unknown,
    context: VerifierContext,
  ) => VerifierOutcome;
};

/** The contract every environment exposes from its index.ts. */
export type EnvironmentModule = {
  createState(): unknown;
  bindTools(state: unknown): Tool[];
  verifiers: SiloVerifier[];
  /**
   * Tasks normally come from `tasks/*.json`. This export is only consulted when
   * that directory holds no JSON files.
   */
  tasks?: SiloTask[];
};

export type TerminationReason =
  | "completed"
  | "max_tool_calls"
  | "timeout"
  | "agent_error";

export type TraceEvent =
  | {
      seq: number;
      type: "tool_call";
      at: string;
      tool: string;
      input: unknown;
    }
  | {
      seq: number;
      type: "tool_result";
      at: string;
      tool: string;
      output: unknown;
      isError: boolean;
    };
