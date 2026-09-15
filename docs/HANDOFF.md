# Silo — handoff

Written for whoever picks this up next: a teammate, or a coding agent starting
cold. It assumes you have not seen the codebase and tells you what is true now,
what must not break, and what to do next.

Last updated: 2026-09-14. Package version 0.3.0.

---

## 1. What Silo is

A local-first framework for building simulated environments and evaluating AI
agents against them. You define a world as TypeScript and JSON in your own repo;
Silo runs an agent inside it and scores what the agent actually *did*, not what
it said.

The whole product rests on one sentence:

> **Data defines the world. State gives that world behaviour. Tools expose
> controlled access. Tasks define objectives. Verifiers decide whether the
> objective was achieved.**

Nothing leaves the machine. Environments live in `.silo/` next to the user's code.

---

## 2. Where the code is

```
src/core/        the runtime and the resource store
src/cli/         the CLI, a thin shell over core
src/sdk.ts       the programmatic API, the same shell over the same core
src/public.ts    everything exported as @burn0/silo
templates/       blank + erp, copied verbatim on `silo init`
examples/        customer + profit, the two reference environments
tests/           the ERP regression gate and its baselines
docs/            authoring.md, and this file
```

3,646 lines of `src`. The largest files are `store.ts` (628), `run.ts` (431),
`init.tsx` (415).

### Branch state

```
main                            87d2bee   untouched, pre-dates all of this
feat/silo-authoring-foundation  4e5027d   pushed — CLI + SDK foundation
feat/silo-tracing-erp           ca6c8a0   pushed — ERP migration + tracing
```

`feat/silo-tracing-erp` contains everything and is branched off the authoring
work. Neither is merged. No PR opened.

**Commits are authored solely by `SYED-RAFI-NAQVI <sd.rafi1819@gmail.com>` with
no AI attribution** — this is a hard rule in `CLAUDE.md` and overrides any
harness default that tries to add `Co-Authored-By` or "Generated with" lines.

---

## 3. The environment contract

Silo loads an environment through **three exports** and nothing else:

```ts
createState(): State          // a fresh world per rollout
bindTools(state): Tool[]      // what the agent may call
verifiers: SiloVerifier[]     // how success is judged
```

Tasks are **not** exported — they are discovered from `tasks/*.json`. The
optional `tasks` export on `EnvironmentModule` is a legacy fallback used only
when that directory holds no JSON.

Every environment has the same shape. There is no per-domain architecture:

```
.silo/environments/<name>/
├── silo.environment.json   name, template, templateVersion, entrypoint, tools[]
├── index.ts                the three exports, thin
├── environment.ts          data/ → a fresh cloned world
├── state.ts                `export type State` + domain helpers
├── data/*.json             facts only
├── tasks/TASK-0NN.json     objectives, discovered
├── tools/*.ts + index.ts   explicit registry
└── verifiers/*.ts + index.ts
```

---

## 4. Invariants — do not break these

These are load-bearing. Each one was learned the hard way.

**1. `createState()` must return a freshly cloned object.**
Datasets are imported JSON modules, which Node caches for the life of the
process. Return the imported object directly and rollout N+1 inherits rollout
N's mutations. It presents as flaky grading, not as an obvious bug.

```ts
return structuredClone({ customers }) as State;
```

**2. The state type is named `State`.**
Blank ships `export type State`, every scaffolded tool and verifier imports that
name, and `detectStateType()` prefers it. ERP's `ErpState` was renamed for this
reason. Do not reintroduce per-domain names.

**3. Data holds facts, never derived values.**
If a number can be computed from other fields, compute it in `environment.ts`.
ERP stores quantities and unit prices; `lineTotal`, `subtotal`, `taxAmount` and
`totalAmount` are all derived at load. A stored total goes stale the moment
someone edits a quantity — and a verifier reading it would be grading its own
copy of the answer.

**4. The agent never sees state.**
It sees the task instruction, the tool schemas, and cloned tool outputs. If the
agent should be able to enumerate something, write a tool for it.

**5. Verifiers grade state first, output second.**
State-changing task → check `finalState`. Answer-producing task → derive the
expected answer from `initialState` using domain helpers and compare against
`context.agentOutput`. **Never hardcode an answer that can be derived.** Never
grade which tools were called unless the process is the task.

**6. Magic is acceptable for data, never for code.**
Tasks and datasets are discovered. Tools and verifiers are explicitly registered
in their barrels. A file appearing on disk must not silently become an agent
capability.

**7. ERP artifacts must stay byte-identical.**
`npm run test:erp` is the gate. See §5.

---

## 5. How to verify you have not broken anything

Run all of these before committing:

```bash
npm test              # check + test:erp + test:tools

# or individually
npm run check         # tsc over src, templates and examples
npm run build         # emits dist/, needed before any env can resolve @burn0/silo
npm run test:erp      # all 18 ERP tasks, byte-identical
npm run test:tools    # the tool execution path, byte-identical
```

Plus the reference environments:

```bash
npx tsx src/index.ts run --env customer --task TASK-001 --agent ./examples/agents/customer.agent.ts
npx tsx src/index.ts run --env profit   --task TASK-001 --agent ./examples/agents/profit.agent.ts
```

Both should PASS with reward 1.00. If `.silo/environments/customer` or `profit`
are missing, recreate them with `cp -R examples/customer .silo/environments/customer`.

### About the ERP gate

`tests/erp-baseline.mjs` runs all 18 ERP tasks with an agent that **changes
nothing**, so every result is a pure function of the seed data and the verifier
logic. It compares `result.json` and `state-diff.json` against
`tests/baselines/erp/`.

Two things about it matter:

- It **scaffolds a throwaway environment from the current `templates/erp`** into
  a temp project. An earlier version tested `.silo/environments/demo-erp`, which
  is a *copy* taken at scaffold time — it passed happily after I deliberately
  broke the template. A gate that cannot fail is worse than no gate.
- The temp project needs `{"type":"module"}` and a `node_modules/@burn0/silo`
  symlink, because environment code imports the package by name. Both are set up
  by the harness.

Re-record after an intentional change:

```bash
npm run test:erp -- --update
```

### The tool-path gate

The no-op agent never calls a tool, so `test:erp` covers the seed and the
verifiers and nothing else. `npm run test:tools` closes that gap: a scripted
agent (`tests/tool-path.agent.ts`) walks read, write, read-back, an undeclared
argument, a missing required field and an unknown tool, then byte-compares
`result.json`, `state-diff.json` and the tool events from the trace with
timestamps stripped.

It does not execute all 185 tools. It covers the path every tool goes through —
binding, argument validation, output cloning, error mapping, dispatch.

```bash
npm run test:tools
npm run test:tools -- --update    # re-record
```

**Probe it before trusting it.** Twice while building these gates I "verified"
one with a change it could not possibly see, and it reported green. A probe must
touch a path the scripted agent actually walks — changing the price
`update_vendor_invoice_line` writes will fire it; changing an error code in a
tool the script never fails on will not.

**Environment code resolves `@burn0/silo` to `dist/`,** so a change under `src/`
does not affect a scaffolded environment until you `npm run build`. A `src` edit
that seems to have no effect on these gates usually means you skipped the build.

---

## 6. Status

### Done

**Foundation** — Blank as the reference architecture; CLI (`init`, `data`,
`task`, `tool`, `verifier`, `env validate`, `run`), all non-interactive with
`--json`; SDK (`Silo.open({cwd})`, environment-scoped resources) over the same
store; `SiloError` with stable codes shared by both; `.silo/tsconfig.json`
scaffolded on init.

**`silo env validate` runs a real TypeScript compile.** This matters more than
it sounds: type-only imports are erased before execution, so an environment can
load and run perfectly while being uncompilable. "It ran" is not evidence it is
correct. The validator and `tsc -p .silo/tsconfig.json` always agree.

**ERP migration** — complete. 26 JSON datasets, 18 JSON tasks, 185 tool bodies
unchanged, verifiers on the SDK, `seed.ts` deleted, all duplicate types removed.
Verified byte-identical throughout.

**Traces** — `run_start`, `tool_call`, `tool_result`, `agent_output`, `run_end`,
`verifier_result`; `callId` pairing; per-call `durationMs`; trace always written
(a run that dies before its first tool call still produces a readable account);
failure-safe artifact writes; collision-free run IDs.

**`--runs N`** — repeats a task from a fresh world, reports pass count, mean,
best, worst.

**Two reference environments** — `examples/customer` (state-changing) and
`examples/profit` (answer-producing). Both are type-checked by `npm run check`.

### Partially done

| Item | Missing |
|---|---|
| Traces | **`model_step`** — Silo cannot see model turns because the agent drives its own loop. Needs an opt-in hook for adapters to report turns. `state_diff` is a file, not a trace event. |
| `--runs` | No average tool calls (two-line fix). No group id linking rollouts of one invocation. |
| Docs | `authoring.md` covers the mental model, both verifier shapes, CLI and SDK, a walkthrough, and the Claude/Codex guide. Missing: Getting Started, Templates, Tool Packs, Run Artifacts. |

### Not started

- **Templates beyond blank + erp** — CRM, HR, Support, Operations.
- **Tool packs.** `TOOL_PACKS` is referenced *only* by the init picker. The
  selection is written to the manifest and nothing reads it. No pack source, no
  binding, no runtime effect.
- **Eval summaries / agent comparison** (`silo eval`).
- **LLM failure explanation** — explicitly *not* a judge; the deterministic
  verifier stays the source of truth.
- **Local web UI.**
- **Official agent adapters** — one exists in practice (LangChain + Ollama, in
  the accounting-agent project) but is not packaged as an example.
- **Release polish** — CI, changelog, README screenshots, npm release.

---

## 7. Recommended next steps

**1. CRM + Support templates.** Cheap now, and they are the real test that
Blank-as-spec holds for a third and fourth environment. Contract gaps will show
up here, not in theory. Each is: `data/*.json`, a `State` type with domain
helpers, 5–15 tools, 3–5 tasks, matching verifiers.

**2. Docs.** `docs/authoring.md` now carries the **"Building an environment with
Claude or Codex"** guide, including the full brief to hand an agent — validated
end to end against a freshly installed package more than once. Still missing:
Getting Started, Templates, Tool Packs, and a Run Artifacts page.

**3. Eval summaries and agent comparison.** Builds on `--runs`; mostly
aggregation over artifacts already written. This is what turns Silo from an
environment runner into an evaluation framework.

**4. Tool packs — after templates, not before.** This is the one item that can
break the contract, because a pack must inject tools into an environment whose
`State` it cannot know. Does a pack carry its own state slice? Does it compose
into `State`? Does `bindTools` merge two sources? Design it against two or three
real templates rather than in the abstract.

**5. Then** `model_step`, failure explanation, UI, release.

---

## 8. Gotchas that will cost you time

**An environment outside a `"type": "module"` package loads as CommonJS.** Its
exports end up nested under `.default` and you get a misleading
`does not export createState()`. Affects temp dirs and scratch agent files.

**`@burn0/silo` must be built before any environment can run.** Environment code
imports it by name and resolves to `dist/`. Run `npm run build` after changing
`src/`. Inside this repo it resolves via Node package self-reference; in a user
project it comes from `node_modules`.

**Value imports vs type imports.** Templates import `defineTool`, `bindTools`,
`defineVerifier` as *values*, so the package must be installed at runtime. This
was not true when they were type-only.

**`registerInBarrel` is the only place Silo edits TypeScript.** It inserts one
import and one identifier after the array's opening bracket. It deliberately does
not try to find the closing bracket — an earlier version took the first `]` and
spliced an entry into the middle of ERP's first verifier. Keep it narrow.

**`diffState` treats arrays with string `id`s as collections.** That is what
makes append-only logs like ERP's `auditLog` visible. Without it, everything
written to one is silently absent from the diff.

**Tool arguments are validated against `inputSchema`** in `bindTools`. A
hallucinated property returns `invalid_input` naming the real parameters, which
is what gives an agent a chance to self-correct. Before this, unknown arguments
were silently dropped and tools answered questions nobody asked.

**When debugging a rollout, read `trace.jsonl` first.** It tells you whether the
model picked the wrong tool, sent bad arguments, or looped. `state-diff.json`
empty plus FAIL means the agent only read and never wrote.

**`terminationReason: agent_error` with 0 tool calls and ~0.0s duration** means
the agent never reached its model — usually the model server is down. A real
model failure shows up as tool errors or a timeout.

---

## 9. Command reference

```bash
# environments
silo init <name> [--template blank|erp] [--tools a,b] [--json]
silo env validate --env <env> [--json]

# data — facts, data/<name>.json
silo data list|show|add|update|remove <name> --env <env> (--file <p> | --data <json>)

# tasks — objectives, tasks/<id>.json
silo task list|show|add|update|remove --env <env> --id <id> --title <t>
     --instruction <i> --verifier <VER-ID> [--difficulty easy|medium|hard]

# code resources — scaffolding, never business logic
silo tool add <name> --env <env> [--description <d>] [--state <TypeName>]
silo verifier add <VER-ID> --env <env> --task <TASK-ID> [--name <n>]
silo tool list --env <env>
silo verifier list --env <env>

# running
silo run --env <env> --task <id> --agent ./agent.ts
         [--runs 5] [--max-tool-calls 100] [--timeout-ms 120000]
```

SDK equivalent:

```ts
import { Silo } from "@burn0/silo";

const silo = await Silo.open({ cwd });
const env = await silo.environments.create({ name: "support", template: "blank" });

await env.data.add("tickets", { "TICKET-001": { status: "open" } });
await env.tasks.add({ id: "TASK-001", title, instruction, verifierId: "VER-001", difficulty: "easy" });
await env.tools.scaffold({ name: "close_ticket", description: "..." });
await env.verifiers.scaffold({ id: "VER-001", taskId: "TASK-001" });

const report = await env.validate();   // same shape as `silo env validate --json`
```

The CLI and the SDK are two interfaces over the same store. They write the same
files; mix them freely.

---

## 10. Run artifacts

```
.silo/runs/<runId>/
├── trace.jsonl       every event, append-only, in order
├── result.json       verifier checks, reward, agent output, tool error count
├── state-diff.json   what the rollout changed
└── run.json          task, verifier, resolved config, timings
```

`trace.jsonl` is written to stand alone — it opens with the task, the config and
every tool name offered, and closes with the agent's output, how the run ended,
and how it was graded.

`result.json` and `state-diff.json` contain **no timestamps or run IDs**, which
is what makes them an exact regression oracle. Any change to either is a real
behavioural change. This property is the backbone of the ERP gate; preserve it.
