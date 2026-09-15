/**
 * A scripted agent for the customer-test environment.
 *
 * Deterministic on purpose: it exercises the rollout loop end to end without
 * needing a model. Swap in a real model-driven agent to evaluate one.
 */

type AgentInput = {
  task: string;
  tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
  callTool: (name: string, input: unknown) => Promise<{ output: unknown; isError?: boolean }>;
  signal: AbortSignal;
};

export default async function customerAgent({ task, tools, callTool }: AgentInput) {
  const match = task.match(/CUS-\d+/);

  if (!match) {
    return { output: "No customer id found in the task instruction." };
  }

  const customerId = match[0];

  const before = await callTool("get_customer", { customerId });

  if (before.isError) {
    return { output: `Could not read ${customerId}: ${JSON.stringify(before.output)}` };
  }

  const blocked = await callTool("block_customer", {
    customerId,
    reason: "Failed compliance review.",
  });

  if (blocked.isError) {
    return { output: `Could not block ${customerId}: ${JSON.stringify(blocked.output)}` };
  }

  return {
    output: `Read ${customerId}, then blocked it for failing compliance review. ${tools.length} tools were available.`,
  };
}
