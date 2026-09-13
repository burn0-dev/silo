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
