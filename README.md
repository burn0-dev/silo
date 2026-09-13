# Silo

Local-first simulation and evaluation framework for AI agents.

Silo lets you define a simulated environment — tools, tasks, and verifiers — as plain
TypeScript in your own repo, then run agents against it and score what they did. Nothing
leaves your machine; environments live in `.silo/` next to your code.

> **Status: early.** `silo init` is implemented and usable. The rollout runner exists but
> does not yet score results, and `silo run` is a stub. Expect breaking changes.

## Requirements

- Node.js 22 or newer (the CLI uses `node:fs/promises` and ESM-only imports)

## Getting started

The package is not published to npm yet, so work from a clone:

```bash
git clone https://github.com/burn0-dev/silo.git
cd silo
npm install
npm run dev -- init
```

`npm run dev` runs the CLI through [tsx](https://github.com/privatenumber/tsx) without a
build step. Add `--silent` if you'd rather not see npm's own run banner.

## Creating an environment

`silo init` is an interactive wizard:

```
███████╗██╗██╗      ██████╗
██╔════╝██║██║     ██╔═══██╗
███████╗██║██║     ██║   ██║
╚════██║██║██║     ██║   ██║
███████║██║███████╗╚██████╔╝
╚══════╝╚═╝╚══════╝ ╚═════╝

Environment Name: support-desk

Choose a template: ❯ Blank
                     ERP

Add more tools? (Y/N): y

Select additional tools: ❯ ◉ Calendar
                           ◯ Email
                           ◯ CRM

↑↓ Move   Space ␣ Select   Enter ⏎ Confirm
```

It writes to `.silo/environments/<name>/`:

```
.silo/environments/support-desk/
├── index.ts       # environment entry point
├── state.ts       # environment state
├── seed.ts        # seed data
├── silo.json      # name, template, selected tools
├── tools/
├── tasks/
└── verifiers/
```

Two templates ship today: **Blank** and **ERP**. Both are copied from `templates/` as
editable TypeScript source — they are yours to change once generated.

### The ERP template

A simulated mid-sized industrial distributor: 12 vendors, 12 customers, 22 products across
4 warehouses, with connected procure-to-pay, order-to-cash, inventory and budget data. It
ships with **185 tools**, 18 tasks spanning easy to hard, and a deterministic verifier for
each task.

The seed contains deliberate, realistic messes for agents to work through — an invoice
billing more than was received, another billing above the agreed price, a payment that
failed on stale bank details, a quotation that is cheapest but expired, a sales order no
single warehouse can fill, and a requisition above its approver's limit.

Two rules shape the whole environment:

- **Time is simulated.** `state.now` is the only clock; nothing reads `Date.now()`. It
  never advances on its own, so a task that does not call `advance_clock` runs at a single
  instant and is perfectly reproducible.
- **Verifiers inspect the world, not the transcript.** A task passes because stock moved,
  an invoice settled or a status changed — never because the agent said it was done.

### Environment names

Names must be unique within a project and may contain letters, numbers, hyphens, and
underscores. Collisions are detected **case-insensitively** (`test`, `Test`, and `TEST`
all collide), so behavior is identical on macOS and Linux.

If a name is taken, the prompt stays put and offers the next free name:

```
Environment Name: support-desk-2

Environment "support-desk" already exists.
```

Press Enter to accept the suggestion or type something else. Silo never overwrites or
merges into an existing environment.

Generation is atomic: files are built in a hidden staging directory and moved into place
with a single `rename()`. A failure partway through leaves nothing behind — you never end
up with a half-created environment.

## Writing an environment

The core types live in [`src/core/types.ts`](src/core/types.ts). Import paths are
relative while the package is unpublished — they will become `silo/...` specifiers once an
exports map lands. A tool is a JSON-schema definition plus an executor:

```ts
import type { Tool } from "../../../src/core/types.js";

export const searchCustomers: Tool = {
  name: "search_customers",
  description: "Find customers by name.",
  inputSchema: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  },
  async execute(input) {
    const { query } = input as { query: string };
    return { output: await db.customers.search(query) };
  },
};
```

An agent is any function that takes a task plus the available tools and returns output:

```ts
import { runRollout } from "../../../src/core/runner.js";

const result = await runRollout({
  agent: myAgent,
  task: "Refund the most recent order for Acme Corp.",
  tools: [searchCustomers],
});
```

`runRollout` builds the tool map, hands the agent a `callTool` bridge, and catches
per-tool errors so a throwing tool returns `{ isError: true }` to the agent rather than
killing the rollout.

**Not wired up yet:** verifiers do not run, so `runRollout` currently returns
`passed: false`, `reward: 0`, and an empty `verifierResults`.

## Project layout

```
src/
├── cli/init.tsx        # the init wizard (Ink)
├── core/scaffold.ts    # environment creation
├── core/runner.ts      # rollout execution
├── core/types.ts       # tool / agent / verifier types
└── index.ts            # CLI entry point
templates/              # built-in environment templates, copied verbatim
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev -- init` | Run the CLI from source |
| `npm run build` | Type-check and emit to `dist/` |
| `npm start` | Run the built CLI from `dist/` |

## Roadmap

- `silo run` — execute rollouts against an environment
- Verifier execution and reward scoring
- Non-interactive init, e.g. `silo init my-env --template erp --tools email,calendar`
- Environment management commands (`silo env edit`, `silo env delete`)
