export type JsonSchema = Record<string, unknown>;

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

export type AgentInput = {
  task: string;
  tools: ToolDefinition[];
  callTool: (name: string, input: unknown) => Promise<ToolResult>;
};

export type AgentResult = {
  output: string;
};

export type Agent = (input: AgentInput) => Promise<AgentResult>;

export type VerifierResult = {
  name: string;
  passed: boolean;
  message?: string;
  reward?: number;
};

export type RolloutResult = {
  task: string;
  output: string;

  passed: boolean;
  reward: number;

  verifierResults: VerifierResult[];
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

export type SiloVerifier = {
  id: string;
  taskId: string;
  name: string;
  check: (finalState: unknown, initialState: unknown) => VerifierOutcome;
};

/** The contract every environment template exposes from its index.ts. */
export type EnvironmentModule = {
  createState(): unknown;
  bindTools(state: unknown): Tool[];
  tasks: SiloTask[];
  verifiers: SiloVerifier[];
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
