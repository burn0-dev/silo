# Silo

Local-first simulation and evaluation framework for AI agents.

Silo lets you define a simulated world — data, state, tools, tasks and verifiers — as
plain TypeScript in your own repo, then run agents inside it and score what they actually
**did**, not what they said. Nothing leaves your machine; environments live in `.silo/`
next to your code.

> **Status: early.** Environment authoring (CLI + SDK), validation, scored rollouts,
> traces and run artifacts all work. Expect breaking changes before 1.0.

**[Documentation →](https://docs.burn0.dev/silo/introduction)** · **[silo.burn0.dev](https://silo.burn0.dev)**

## Install

```bash
npm i @burn0/silo
```

Requires Node.js 22 or newer. Your project needs `"type": "module"` in its
`package.json` — environments and agents are ES modules.

> Invoke the CLI as `npx @burn0/silo`. An unrelated package named `silo` exists on the
> public registry.

## Quickstart

```bash
npx @burn0/silo init demo --template crm
npx @burn0/silo task list --env demo
```

Write an agent — any module that default-exports a function:

```js
// silo.agent.js
export default async function agent({ callTool }) {
  const forecast = await callTool("forecast_report", {});
  const { weightedAmount } = forecast.output;

  return { output: `Open pipeline is worth $${weightedAmount.amount}` };
}
```

Run it:

```bash
npx @burn0/silo run --env demo --task TASK-004 --agent ./silo.agent.js
```

Name it `silo.agent.ts` in the directory you run from and `--agent` is optional.

```
  Task          TASK-004 — Report the weighted value of open pipeline
  Result        PASS
  Reward        1.00

  Tool calls    1
  Checks        3 / 3
  Required      1 / 1

  Run saved: .silo/runs/run_20260915012734_4t01
```

## How it works

> **Data** defines the world. **State** gives that world behaviour. **Tools** expose
> controlled access. **Tasks** define objectives. **Verifiers** decide whether the
> objective was achieved.

Silo loads an environment through three exports and nothing else:

```ts
createState(): State          // a fresh world per rollout
bindTools(state): Tool[]      // what the agent may call
verifiers: SiloVerifier[]     // how success is judged
```

Tasks are discovered from `tasks/*.json` rather than exported.

Every environment has the same shape, whatever it models:

```
.silo/environments/demo/
├── silo.environment.json  # name, template, entrypoint
├── index.ts               # the three exports
├── environment.ts         # data/ → a fresh cloned world
├── state.ts               # `export type State` + domain helpers
├── data/                  # facts only, as JSON
├── tasks/                 # one JSON file per objective
├── tools/                 # what the agent can call, explicitly registered
└── verifiers/             # deterministic grading
```

The agent never sees state. It sees the task instruction, the tool schemas, and cloned
tool output — so anything it should be able to look up needs a tool.

## Templates

Four ship today, copied verbatim into your project as editable TypeScript.

| Template | Data | Tasks | Tools | Verifiers |
| --- | --- | --- | --- | --- |
| **Blank** | 0 | 0 | 0 | 0 |
| **CRM** | 9 | 6 | 42 | 6 |
| **Project tracking** | 9 | 15 | 54 | 15 |
| **ERP** | 26 | 18 | 185 | 18 |

**Blank** is the reference architecture — the contract wired up and nothing in it.

**CRM** is a staged B2B sales pipeline, and the best one to read: populated, but small
enough to hold in your head.

**Project tracking** models software delivery — work items, sprints, dependencies and
member capacity.

**ERP** is a mid-sized industrial distributor with connected procure-to-pay,
order-to-cash, inventory and budgeting. Its seed contains deliberate messes: an invoice
billing more than was received, a payment that failed on stale bank details, a quotation
that is cheapest but expired, a sales order no single warehouse can fill.

Two rules shape every template:

- **Time is simulated.** `state.now` is the only clock; nothing reads `Date.now()`, so
  runs are reproducible.
- **Verifiers inspect the world, not the transcript.** A task passes because stock moved
  or a status changed, never because the agent said it was done.

## Run artifacts

Every rollout writes a directory:

```
.silo/runs/<runId>/
├── trace.jsonl       every event, append-only, in order
├── result.json       checks, reward, agent output, tool errors
├── state-diff.json   what the rollout changed
└── run.json          task, verifier, resolved config, timings
```

`result.json` and `state-diff.json` carry no timestamps or run ids, which makes them an
exact regression oracle — any diff between two runs is a real behavioural change.

Repeat a task to read a non-deterministic agent honestly:

```bash
npx @burn0/silo run --env demo --task TASK-002 --runs 5
```

## SDK

The CLI and the SDK are two interfaces over the same store.

```ts
import { Silo } from "@burn0/silo";

const silo = await Silo.open({ cwd });
const env = await silo.environments.create({ name: "support", template: "blank" });

await env.data.add("tickets", [{ id: "TKT-001", status: "open" }]);
await env.tools.scaffold({ name: "close_ticket", description: "..." });

const report = await env.validate();
```

## Validate before you trust a run

```bash
npx @burn0/silo env validate --env demo
```

```
OK	demo	data=9 tasks=6 tools=42 verifiers=6
```

This runs the real TypeScript compiler, not a file-presence check. Type-only imports are
erased before execution, so an environment can load and run perfectly while being
uncompilable — "it ran" is not evidence that it is correct.

## Development

```bash
git clone https://github.com/burn0-dev/silo.git
cd silo
npm install
npm test
```

| Command | What it does |
| --- | --- |
| `npm run dev -- <cmd>` | Run the CLI from source via tsx |
| `npm run check` | Type-check src, templates and examples |
| `npm run build` | Emit to `dist/` |
| `npm test` | check + every template gate |
| `npm run test:erp` | ERP baselines, no-op agent |
| `npm run test:tools` | The tool execution path |
| `npm run test:crm` | CRM baselines, scripted solver |
| `npm run test:project` | Project tracking baselines |

Gates byte-compare run artifacts against recorded baselines. Re-record deliberately with
`npm run test:crm -- --update`.

## Roadmap

- Packaged adapters for LangChain, Vercel AI SDK, OpenAI, Anthropic and Mastra
- An MCP server exposing an environment's tools
- LLM judges for non-deterministic verification, alongside deterministic checks
- `model_step` trace events, so Silo can see model turns
- Eval summaries and agent comparison

## License

MIT
