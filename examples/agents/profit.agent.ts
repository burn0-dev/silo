/**
 * A scripted agent for the profit example.
 *
 * Reads the profit lines, sums them, and states the total as its final answer.
 */

type AgentInput = {
  task: string;
  tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
  callTool: (name: string, input: unknown) => Promise<{ output: unknown; isError?: boolean }>;
  signal: AbortSignal;
};

export default async function profitAgent({ callTool }: AgentInput) {
  const result = await callTool("get_profits", {});

  if (result.isError) {
    return { output: `Could not read profit lines: ${JSON.stringify(result.output)}` };
  }

  const lines = result.output as Array<{ line: string; amount: number }>;
  const total = lines.reduce((sum, entry) => sum + entry.amount, 0);

  return { output: `Summed ${lines.length} profit lines. The total profit is ${total}.` };
}
