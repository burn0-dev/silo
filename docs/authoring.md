# Authoring a Silo environment

An environment is a small simulated world, the tools an agent may use inside it,
the tasks you want done, and the code that decides whether they were.

## The recommended order

Follow this and no step undoes an earlier one:

1. `silo init <name> --template blank`
2. add raw data — `silo data add`
3. define or evolve the `State` type in `state.ts`
4. wire the data into `createState()` in `environment.ts`
5. scaffold and implement tools — `silo tool add`
6. add tasks — `silo task add`
7. scaffold and implement verifiers — `silo verifier add`
8. `silo env validate`
9. `silo run`

Step 3 before step 5 matters: scaffolded tools and verifiers import the state
type, so having the real one in place first means the generated stubs are
correct as written.

**Keep the type named `State`.** Blank ships `export type State` and every
scaffold imports that name. Grow the type in place rather than renaming it:

```ts
// state.ts — same name, real shape
export type State = {
  products: Record<string, Product>;
};
```

Renaming it to something like `WarehouseState` means updating every file that
refers to it, for no benefit — the environment directory already tells you which
world it belongs to.

## Where commands run

Environments resolve from the **current working directory's** `.silo/` folder,
so run every command from your project root — the directory holding
`package.json` and `.silo/`. There is no global environment registry.

`silo tool list` and `silo env validate` import the environment to inspect it,
so both need it to load. If `createState()` throws, they report that rather
than a list.

## The mental model

```
Data       raw facts                      data/*.json
State      runtime world + domain logic   state.ts, environment.ts
Tools      controlled access for agents   tools/*.ts
Tasks      objectives                     tasks/*.json
Verifiers  deterministic success          verifiers/*.ts
```

> **Data defines the world. State gives that world behaviour. Tools expose
> controlled access. Tasks define objectives. Verifiers decide whether the
> objective was achieved.**

Two rules follow from that, and they are the ones worth remembering:

- **The agent never sees state.** It sees the task instruction, the tool
  schemas, and whatever your tools return. If you want the agent to be able to
  list customers, you write a `list_customers` tool — otherwise it cannot.
- **Every rollout gets its own world.** `createState()` must build a fresh
  object each call. Datasets are imported JSON modules, which Node caches for
  the life of the process, so clone before returning:

  ```ts
  return structuredClone({ customers }) as State;
  ```

  Skip the clone and one rollout's changes leak into the next, which shows up
  as flaky grading rather than as an obvious bug.

## Two shapes of task

**State-changing** — the agent must change the world. Grade the final state.

```ts
check("CUS-001 is blocked", final.customers["CUS-001"]?.status === "blocked")
```

**Answer-producing** — the agent must report something, and correct behaviour
may change nothing at all. A state-only verifier cannot grade this: the world
before and after are identical. Grade `context.agentOutput` against truth
**derived from `initialState`**:

```ts
check("The reported total is correct", parseAnswer(context.agentOutput) === totalProfit(initial))
```

Derive expected answers from the world rather than hardcoding them — then the
verifier keeps working when the data changes. Do not grade which tools were
called, or in what order, unless the process itself is what the task asks for.

## Commands

Every authoring command is non-interactive, takes `--env <name>`, and accepts
`--json` for machine-readable output. Errors are specific and exit non-zero.

### Environments

```bash
silo init                                        # interactive wizard
silo init <name> --template blank                # non-interactive
silo env validate --env <env>
```

### Data — raw facts, `data/<name>.json`

```bash
silo data list   --env <env>
silo data show   <name> --env <env>
silo data add    <name> --env <env> --file ./customers.json
silo data add    <name> --env <env> --data '{"CUS-001":{"status":"active"}}'
silo data update <name> --env <env> --file ./customers.json
silo data remove <name> --env <env>
```

Any valid JSON is accepted — arrays, objects, nested, keyed records. Silo stores
what you give it and never assumes a shape.

Use `--file` for anything beyond a few lines; `--data` is meant for short inline
payloads and coding agents, not for pasting a large dataset into a shell.

**Store facts, not totals.** If a number can be computed from other fields, keep
it out of the JSON and compute it in `state.ts`. A stored
`"totalInventoryValue": 250` goes stale the moment someone edits a quantity, and
a verifier that reads it is grading its own copy of the answer.

`data add` deliberately **does not touch `state.ts` or `environment.ts`.** Data
is facts; turning facts into a runtime world is domain logic that you write.

### Tasks — objectives, `tasks/<id>.json`

```bash
silo task list --env <env>
silo task show TASK-001 --env <env>

silo task add --env <env> \
  --id TASK-001 \
  --title "Block a customer" \
  --instruction "Acme Industrial (CUS-001) has failed compliance review. Block them." \
  --verifier VER-001 \
  --difficulty easy

silo task update --env <env> --id TASK-001 --instruction "..."
silo task remove TASK-001 --env <env>
```

A task states the objective and nothing else. No solution path, no list of
tools to use, no hidden answer — otherwise you stop measuring whether the agent
can work out what to do.

Tasks are discovered from `tasks/*.json`; there is no registration step.

### Tools — TypeScript the agent can call

```bash
silo tool list --env <env>
silo tool add get_customer --env <env> --description "Get a customer by id."
```

`tool add` is code generation, not CRUD. It writes `tools/<name>.ts` and
registers it in `tools/index.ts`, then stops — it never guesses business logic.
The stub throws until you implement it, and contains `TODO` markers to find.

`tool list` works by importing the environment and binding its tools, so it
reports what an agent would actually receive.

### Verifiers — TypeScript that decides success

```bash
silo verifier list --env <env>
silo verifier add VER-001 --env <env> --task TASK-001 --name "Customer blocked"
```

Writes `verifiers/VER-001.ts` and registers it. The generated check **fails on
purpose**, so an unimplemented verifier can never report a passing run.

Both scaffolding commands infer the state type from `state.ts`. Pass
`--state <TypeName>` if yours is named unusually.

### Running

```bash
silo run --env <env> --task TASK-001 --agent ./silo.agent.ts
silo run --env <env> --task TASK-001 --agent ./silo.agent.ts --runs 5
```

`--runs` repeats the task from a fresh world each time and reports the pass
rate. A model that is right once and wrong twice is not a model that passes, and
a single run cannot tell you which you have.

Each rollout writes `.silo/runs/<runId>/`:

| File | What it holds |
|---|---|
| `trace.jsonl` | the whole rollout, one event per line |
| `result.json` | verifier checks, reward, the agent's final output |
| `state-diff.json` | what the rollout actually changed |
| `run.json` | the task, the verifier, the config, timings |

`trace.jsonl` is written to stand alone. It opens with `run_start` — the task,
the config and every tool name offered — and closes with `agent_output`,
`run_end` and `verifier_result`. Tool calls and results are paired by `callId`
rather than by adjacency, and each result carries its own `durationMs`.

A rollout that never calls a tool still writes a trace. Those are usually the
ones worth reading:

```json
{"seq":1,"type":"run_start","task":{"id":"TASK-013",...},"tools":[...185 names]}
{"seq":2,"type":"agent_output","output":""}
{"seq":3,"type":"run_end","terminationReason":"agent_error","error":"fetch failed"}
{"seq":4,"type":"verifier_result","verifierId":"VER-013","passed":false,"reward":0.2}
```

## A full walkthrough

```bash
silo init finance --template blank

silo data add profits --env finance --data '{"profit1":30,"profit2":70}'
silo tool add get_profits --env finance --description "List every profit line."
silo task add --env finance --id TASK-001 \
  --title "Report total profit" \
  --instruction "What is the total profit? Reply with the total amount." \
  --verifier VER-001
silo verifier add VER-001 --env finance --task TASK-001
```

Then write the domain logic the CLI deliberately left to you:

- `state.ts` — the `State` type and a `totalProfit(state)` helper
- `environment.ts` — import `data/profits.json`, clone it into a fresh state
- `tools/get-profits.ts` — implement `run(state, input)`
- `verifiers/VER-001.ts` — compare `context.agentOutput` against
  `totalProfit(initialState)`

Then check and run:

```bash
silo env validate --env finance
silo run --env finance --task TASK-001 --agent ./silo.agent.ts
```

## TypeScript configuration

`silo init` writes `.silo/tsconfig.json` the first time it scaffolds into a
project, and never touches one that already exists. It sits under `.silo/`
rather than at the project root because the root config belongs to your
application — Silo should not own or overwrite it — and because scoping keeps
environment code out of your app's compilation and vice versa.

It sets `module`/`moduleResolution` to `NodeNext` (so `./state.js` specifiers
resolve the way Node runs them), `resolveJsonModule` (so
`import data from "./data/x.json" with { type: "json" }` type-checks), and
`strict`. `@burn0/silo` resolves from `node_modules` through the package's own
`exports` map — no aliases and no path mapping.

Check it yourself with:

```bash
npx tsc -p .silo/tsconfig.json
```

`silo env validate` runs the same compiler over the same config, so the two
always agree.

## `silo env validate`

Checks everything reachable without running an agent: the manifest parses, the
entrypoint resolves, `data/*.json` and `tasks/*.json` parse, required task fields
are present, task ids are unique, every `task.verifierId` resolves, verifier ids
are unique, `verifier.taskId` agrees with the task, `createState()` and
`bindTools(state)` both succeed, tool names are unique — **and the environment
compiles**.

That last one matters more than it looks. Type-only imports are erased before
execution, so an environment can load and run perfectly while being
uncompilable. "It ran" is not evidence that it is correct.

Output is one line per finding, then a summary:

```
WARNING	no_tools	No tools registered, so the agent cannot observe or change anything.
OK	my-env	data=1 tasks=1 tools=0 verifiers=1
```

`ERROR` findings exit non-zero; `WARNING` findings do not.

## The SDK

Everything the CLI does is available programmatically. **The CLI and the SDK are
two interfaces over the same Silo environment** — both call the same resource
layer and write the same files, so you can mix them freely.

```ts
import { Silo } from "@burn0/silo";

const silo = await Silo.open();                  // or { cwd: "/path/to/project" }
const env = await silo.environments.open("support");
```

`Silo.open()` captures the project root once. Nothing below it reads
`process.cwd()`, so one process can serve several projects — which is what makes
this usable from tests, a web UI, or a coding agent working across repos.

| CLI | SDK |
|---|---|
| `silo init support --template blank` | `await silo.environments.create({ name: "support" })` |
| `silo data add tickets --file t.json` | `await env.data.add("tickets", tickets)` |
| `silo data show tickets` | `await env.data.get("tickets")` |
| `silo data list` | `await env.data.list()` |
| `silo data update tickets --file t.json` | `await env.data.update("tickets", tickets)` |
| `silo data remove tickets` | `await env.data.remove("tickets")` |
| `silo task add --id TASK-001 …` | `await env.tasks.add({ id: "TASK-001", … })` |
| `silo task list` | `await env.tasks.list()` |
| `silo tool add close_ticket` | `await env.tools.scaffold({ name: "close_ticket" })` |
| `silo tool list` | `await env.tools.list()` |
| `silo verifier add VER-001 --task TASK-001` | `await env.verifiers.scaffold({ id: "VER-001", taskId: "TASK-001" })` |
| `silo env validate` | `await env.validate()` |

Tools and verifiers are **scaffolded**, not "added" — the SDK writes a compiling
stub and registers it, then stops. It never generates business logic: `state.ts`,
`environment.ts`, tool bodies and verifier bodies remain yours to write.

Datasets are arbitrary JSON, typed as `JsonValue`:

```ts
await env.data.add("tickets", {
  "TICKET-001": { id: "TICKET-001", status: "open" },
  "TICKET-002": { id: "TICKET-002", status: "closed" },
});
```

`validate()` returns the same structured report as `silo env validate --json`:

```ts
const report = await env.validate();

if (!report.ok) {
  for (const finding of report.findings) {
    console.error(finding.level, finding.code, finding.message);
  }
}
```

### Errors

Expected failures throw a `SiloError` carrying a stable `code`, so nothing has
to parse message text:

```ts
import { isSiloError } from "@burn0/silo";

try {
  await env.data.add("tickets", tickets);
} catch (error) {
  if (isSiloError(error) && error.code === "data_already_exists") {
    await env.data.update("tickets", tickets);
  } else {
    throw error;
  }
}
```

Codes include `environment_not_found`, `environment_already_exists`,
`unsafe_name`, `invalid_json`, `data_not_found`, `data_already_exists`,
`task_not_found`, `task_already_exists`, `task_invalid`, `tool_already_exists`,
`verifier_already_exists`, `registry_not_found`, `already_registered`,
`state_type_not_found`, `template_not_found`. The CLI prints the same codes
alongside its messages.

## Building an environment with Claude or Codex

Silo's commands are non-interactive, take explicit flags, emit `--json`, and fail
with specific messages and non-zero exits. That is deliberate: a coding agent can
drive the whole authoring flow and check its own work.

Give the agent the brief below plus your description of the world. It has been
run end to end against a freshly installed package more than once.

```
Create a Silo environment using the @burn0/silo CLI and SDK.

Work in this order. Each step depends on the one before it:

  1. silo init <name> --template blank
  2. silo data add <collection> --env <name> --file <path>
  3. edit state.ts    — define the world's types and domain helpers
  4. edit environment.ts — load data/ and return a fresh cloned world
  5. silo tool add <tool_name> --env <name> --description "..."
  6. implement each tool's run()
  7. silo task add --env <name> --id TASK-001 --title "..." \
       --instruction "..." --verifier VER-001 --difficulty easy
  8. silo verifier add VER-001 --env <name> --task TASK-001
  9. implement each verifier's check()
 10. silo env validate --env <name>      <- must print OK before you stop
 11. silo run --env <name> --task TASK-001 --agent ./agent.ts

Rules that matter:

- Keep the state type named `State`. Scaffolded tools and verifiers import that
  name; renaming it means editing every generated file for no benefit.
- Write state.ts BEFORE scaffolding tools, so the generated stubs are correct
  as written.
- data/*.json holds facts only: quantities, prices, statuses, ids, dates. If a
  number can be computed from other fields, compute it in state.ts and derive it
  in environment.ts. Never store a total.
- createState() must return structuredClone(...). Imported JSON is cached for
  the life of the process, and without the clone one rollout's changes leak into
  the next.
- The agent only ever sees the task instruction, the tool schemas and what your
  tools return. If it should be able to list something, write a tool for it.
- A task states the objective and nothing else — no solution path, no list of
  tools to use, no hidden answer.
- Verifiers:
    state-changing task  -> check finalState
    answer-producing task -> derive the expected answer from initialState using
                             your own domain helpers, then compare it against
                             context.agentOutput
  Never hardcode an answer that can be derived from the world. Do not grade
  which tools were called unless the process itself is the task.
- At least one check() per verifier must be required.
- Generated stubs fail on purpose. A verifier you have not implemented must
  never report a pass.

You are done when `silo env validate` prints OK and a run produces the result
you expect. Validate before you claim success: an environment can load and run
while still failing to compile, and validate catches that.
```

### Why validate is the stopping condition

`silo env validate` runs the real TypeScript compiler over the environment, not
just a resource check. Type-only imports are erased before execution, so an
environment can run perfectly while being uncompilable — "it ran" is not evidence
that it is correct. Telling the agent to stop at `OK` rather than at "the run
worked" is what makes the loop self-checking.

## Reference environments

- [`examples/customer`](../examples/customer) — state-changing: block a customer,
  verify final state.
- [`examples/profit`](../examples/profit) — answer-producing: report the total,
  verify agent output against state-derived truth.

To run one, copy it into `.silo/environments/` first.

## What the CLI will not do for you

`state.ts` and `environment.ts` are written by hand. They hold the types and
domain logic that make a world behave like the thing it simulates, and there is
no generic shape to generate. The CLI's job is to make the contract around them
predictable — not to invent your business logic.
