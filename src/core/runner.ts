import type { Agent, RolloutResult, Tool, ToolDefinition } from "./types.js";

export type RunRolloutInput = {
  agent: Agent;
  task: string;
  tools: Tool[];
};

export async function runRollout({
  agent,
  task,
  tools,
}: RunRolloutInput): Promise<RolloutResult> {
  const toolMap = new Map(tools.map((tool) => [tool.name, tool]));

  const toolDefinitions: ToolDefinition[] = tools.map(
    ({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    }),
  );

  const callTool = async (name: string, input: unknown) => {
    const tool = toolMap.get(name);

    if (!tool) {
      return {
        output: {
          error: `Unknown tool: ${name}`,
        },
        isError: true,
      };
    }

    try {
      return await tool.execute(input);
    } catch (error) {
      return {
        output: {
          error: error instanceof Error ? error.message : String(error),
        },
        isError: true,
      };
    }
  };

  const result = await agent({
    task,
    tools: toolDefinitions,
    callTool,
  });

  return {
    task,
    output: result.output,

    passed: false,
    reward: 0,

    verifierResults: [],
  };
}
