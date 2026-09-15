/**
 * Exercises the tool execution path rather than a model's judgement.
 *
 * The no-op agent behind `npm run test:erp` never calls a tool, so it pins the
 * seed data and the verifier arithmetic and nothing else. This one walks a
 * fixed script through every branch a tool call can take — read, write, read
 * back, rejected arguments, unknown tool — so a change to binding, validation,
 * output cloning or error mapping shows up as a diff.
 *
 * It is deliberately scripted: the point is that the same calls produce the same
 * artifacts every time, not that an agent chose well.
 */

type AgentInput = {
  task: string;
  tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
  callTool: (name: string, input: unknown) => Promise<{ output: unknown; isError?: boolean }>;
  signal: AbortSignal;
};

export default async function toolPathAgent({ tools, callTool }: AgentInput) {
  const steps: string[] = [`tools=${tools.length}`];

  const read = await callTool("get_vendor_invoice", { vendorInvoiceId: "VINV-103" });
  steps.push(`read:${read.isError ? "error" : "ok"}`);

  // A real mutation, so state-diff.json has something to report.
  const write = await callTool("update_vendor_invoice_line", {
    vendorInvoiceId: "VINV-103",
    lineId: "VINV-103-L1",
    unitPrice: 82,
    actorUserId: "USR-006",
  });
  steps.push(`write:${write.isError ? "error" : "ok"}`);

  const reread = await callTool("get_vendor_invoice", { vendorInvoiceId: "VINV-103" });
  steps.push(`reread:${reread.isError ? "error" : "ok"}`);

  // Schema validation: a property the tool does not declare.
  const rejected = await callTool("list_audit_events", { entityId: "VINV-103" });
  steps.push(`undeclared-arg:${rejected.isError ? "rejected" : "accepted"}`);

  // Schema validation: a required field left out.
  const missing = await callTool("get_vendor_invoice", {});
  steps.push(`missing-required:${missing.isError ? "rejected" : "accepted"}`);

  // Dispatch: a tool that does not exist.
  const unknown = await callTool("definitely_not_a_tool", { foo: 1 });
  steps.push(`unknown-tool:${unknown.isError ? "rejected" : "accepted"}`);

  return { output: steps.join(" ") };
}
