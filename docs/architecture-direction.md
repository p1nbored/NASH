# Architecture Direction

> D-040 (2026-10-07 America/New_York): one primary agent, the task classifier and the task router remain. After routing, reuse Orca's original CLI/agent invocation, handoff, messaging and context delivery. The router chooses parameters; it does not require another execution or context framework.

Use this document to align the current implementation. This project is already being developed by modifying the Orca codebase into a new application. Orca is the scaffold and source foundation; it is not an external subsystem that should be embedded wholesale.

The project is still early enough that existing architecture may be changed where necessary. Preserve useful existing implementation, but do not keep obsolete abstractions merely for compatibility.

This document defines architectural direction only. Decide concrete implementation details after inspecting the current repository and Orca source.

Do not make frontend or visual-design changes as part of this architecture task.

---

## 1. Core Product Model

The intended control flow is:

```text
User
  ↓
ChatGPT dot
  ↓ MCP
Application
  ↓
Claude Code primary session
  ↓
Planning and task decomposition
  ↓
Clef
  ↓
Task classification / delegation decision
  ↓
Routing Table
  ↓
Execution target
  ├─ Claude Code primary session
  ├─ Claude Code native subagent
  ├─ Claude Code workflow
  ├─ Codex CLI
  └─ agy CLI
  ↓
Artifacts / execution results
  ↓
Validation
  ↓
Claude Code primary session
  ↓
Next task or completion
```

The user communicates with the system through ChatGPT dot.

dot sends structured task requests to the application through MCP.

The application creates or selects a workflow run and starts one visible official Claude Code CLI primary session for that run.

The Claude Code primary session is the cognitive coordinator.

It owns:

- understanding the user goal;
- planning;
- decomposing work;
- interpreting intermediate results;
- deciding what needs to happen next;
- integrating results;
- determining whether the overall objective has been satisfied.

Do not introduce another autonomous planner that competes with the Claude Code primary session.

---

## 2. Reuse Orca Instead of Rebuilding Orca

This application is being built by modifying Orca.

Inspect the actual Orca implementation and reuse or adapt existing mechanisms wherever they already solve the required problem.

In particular, prefer adapting existing Orca concepts and infrastructure related to:

- projects;
- repositories;
- worktrees;
- terminals;
- process lifecycle;
- sessions;
- runs;
- tasks;
- task dependencies;
- workers;
- Git operations;
- concurrency;
- terminal supervision;
- task status;
- question / reply mechanisms;
- artifacts;
- execution history.

Do not build a second parallel implementation of these concepts unless the existing Orca mechanism fundamentally cannot represent the required architecture.

There should ultimately be one authoritative representation of:

- workflow runs;
- tasks;
- execution attempts;
- workspaces / worktrees;
- process ownership;
- task state.

Avoid architectures where Orca says a worker is running while another database says the same task is complete.

Adapt Orca's existing mechanisms where necessary instead of wrapping an entire unchanged Orca application inside another orchestration framework.

---

## 3. Clear Separation of Responsibilities

Keep the following responsibility boundaries.

### Claude Code primary session

Owns cognitive planning:

```text
goal understanding
planning
task decomposition
reasoning
integration
final project-level judgment
```

### Clef

Owns lightweight semantic classification:

```text
does this task need delegation?
what task type is this?
```

Clef should not become another project planner.

Clef should not maintain a large dynamic policy for deciding every model directly.

### Routing Table

Owns the deterministic mapping:

```text
task_type
    ↓
execution_target
model
reasoning / effort / thinking level
```

The Routing Table is deliberately simple.

### Orca-derived runtime

Owns execution state:

```text
run
task
attempt
worker/process
terminal
worktree
dependency state
execution status
artifacts
```

### Executors

Perform work:

```text
Claude native subagent
Claude workflow
Codex CLI
agy CLI
```

### Validation layer

Determines whether execution evidence satisfies the task acceptance criteria.

An executor saying "done" is not sufficient by itself.

---

## 4. Task Delegation Flow

For every meaningful task produced by the Claude Code primary session:

```text
Claude produces a TaskSpec
        ↓
Clef classifies it
        ↓
Clef returns:
    needs_delegation
    task_type
        ↓
Application looks up Routing Table
        ↓
Task is executed using the configured target/model/effort
```

Keep the Clef output small.

For example:

```text
needs_delegation: true
task_type: software_engineering
```

or:

```text
needs_delegation: false
task_type: coordinator_reasoning
```

Do not make Clef generate an elaborate workflow graph.

Claude creates the plan.

Clef classifies already-defined work.

The Routing Table decides the configured executor.

---

## 5. Initial Model Routing Table

Implement the route table as configuration, not hard-coded business logic.

Use the following table only as the initial default policy.

It is based on current public benchmark evidence from sources such as Artificial Analysis, Arena, Vals and relevant model-specific evaluations.

| Task Type                           | Execution Target                 | Default Model                     | Reasoning / Effort           |
| ----------------------------------- | -------------------------------- | --------------------------------- | ---------------------------- |
| `complex_planning_reasoning`        | Claude primary / Claude subagent | Claude Opus 5.5                   | max                          |
| `software_engineering`              | Claude native subagent           | Claude Sonnet 5.5                 | max                          |
| `scientific_experiment_validation`  | Codex                            | GPT-6 Astra                       | max                          |
| `complex_pdf_evidence_analysis`     | Codex                            | GPT-6.1 Sol                       | max                          |
| `general_research_analysis`         | Codex                            | GPT-6.1 Sol                       | max                          |
| `routine_analysis_batch`            | Codex                            | GPT-6.1 Sol                       | high                         |
| `high_quality_writing`              | Claude subagent                  | Claude Opus 5.5                   | high                         |
| `fast_writing_or_alternative_draft` | agy                              | Gemini 3.8 Flash                  | high thinking when supported |
| `configured_project_workflow`       | Claude workflow                  | inherit coordinator configuration | inherit                      |

These defaults are not permanent rankings.

Do not interpret benchmark differences as proof that one model is universally superior.

When installed CLI capabilities use different names for effort/reasoning/thinking, map the policy level to the actually supported CLI setting.

Never invent an unsupported CLI parameter.

---

## 6. Benchmark Basis for the Initial Table

The initial routing policy should reflect current benchmark trends rather than subjective brand assumptions.

Use Artificial Analysis as an important source for:

```text
general intelligence
terminal performance
automation
software engineering
scientific coding
long-context reasoning
PDF/document understanding
cost/performance
```

Use Arena / arena.ai as an important source for:

```text
human preference
writing
creative writing
coding preference
general open-ended response quality
```

Use specialist benchmarks such as Vals where they directly measure a relevant workload, for example scientific terminal workflows.

The current routing rationale is approximately:

```text
Opus 5.5
→ strongest default for difficult reasoning and high-level integration.

Sonnet 5.5
→ strong engineering / terminal / automation executor.

GPT-6 Astra
→ strong scientific and experimental workflow executor.

GPT-6.1 Sol
→ strong cost/performance default for analysis, PDF/evidence work,
  routine research and frequent delegated tasks.

Gemini 3.8 Flash
→ optional agy executor for fast writing, alternate drafts and
  suitable tasks when available.
```

Keep the benchmark evidence separate from runtime code.

Do not hard-code benchmark scores into routing logic.

---

## 7. Routing Table Must Be Replaceable

The model routing table must be easy to update as models change.

Treat it as a versioned configuration asset.

At minimum each route should represent:

```text
task_type
execution_target
model
reasoning_level
```

Optionally keep metadata such as:

```text
benchmark_sources
benchmark_snapshot_date
notes
```

These fields are informational and should not make the router complicated.

The user must be able to customize the table.

User configuration has priority over the default benchmark-derived policy.

For example, the user may decide:

```text
software_engineering
→ GPT-6 Astra max
```

even if the current default uses Sonnet.

Do not prevent this.

---

## 8. Updating the Routing Policy

Design the routing policy so newer models can replace older models without changing orchestration code.

Model updates should conceptually follow:

```text
new model becomes available
        ↓
benchmark evidence becomes available
        ↓
compare against current route
        ↓
propose routing-table update
        ↓
user accepts / rejects / modifies it
        ↓
new routing-table version
```

Do not automatically replace an active routing policy merely because a leaderboard changes.

Benchmark updates should propose changes.

The user controls activation.

Local benchmark results from this application may eventually become another input and may be more useful than public benchmarks for the user's own workloads.

---

## 9. Model Availability Is Separate From Benchmark Ranking

A benchmark may include a model that the application cannot actually use.

Before activating a route, confirm that:

```text
the required CLI exists
the requested model is available
the requested reasoning level is supported
authentication is valid
```

If a model is unavailable, mark that route unavailable.

Do not silently replace it with another model unless the user has explicitly configured a fallback.

---

## 10. Codex

Remove `codex-plugin-cc` from this architecture.

Do not build new functionality around it.

Remove stale architectural assumptions, route entries, tests or documentation that require it.

Codex execution should use the official Codex CLI directly.

The normal conceptual path is:

```text
Task
  ↓
routing table selects GPT model
  ↓
Codex CLI
```

Prefer structured non-interactive execution for delegated tasks.

Exact process-management details should follow the installed Codex CLI capabilities and the existing Orca runtime where practical.

Do not implement a second custom Codex agent framework.

---

## 11. Claude Code

Each workflow run has one Claude Code primary coordinator session.

Claude Code can execute some work itself.

When delegation is appropriate, tasks may be executed through:

```text
Claude native subagent
Claude workflow
Codex
agy
```

Reuse Claude Code's existing native mechanisms instead of recreating them externally.

Do not assume every Claude native subagent is an independent external terminal/process.

Represent its actual lifecycle accurately.

---

## 12. agy

Keep agy as a direct CLI executor.

Do not build a separate Gemini agent framework.

The routing table determines when an agy-backed model should receive a task.

Use only explicitly available model IDs and supported thinking settings.

For now, Gemini 3.8 Flash may be used as a configurable initial agy candidate when available.

No Gemini family is hard-coded out (D-040). A model is unavailable until the installed CLI/provider actually lists it; future availability requires no family-ban removal.

---

## 13. Workflows

Claude Code workflows are execution mechanisms, not separate model families.

If a task type maps cleanly to an existing project workflow, the routing table may use:

```text
execution_target: claude_workflow
```

and inherit the coordinator model unless that workflow explicitly defines another supported configuration.

Do not recreate existing project workflows as new external agents.

---

## 14. Worktrees and Parallel Execution

Reuse Orca's existing worktree and parallel execution capabilities wherever possible.

A Task does not automatically require a worktree.

Create separate worktrees primarily when work requires isolated repository writes or parallel implementation.

Examples:

```text
literature search
→ usually no worktree

document analysis
→ usually no worktree

code implementation
→ worktree when isolation is useful

parallel competing implementations
→ separate worktrees
```

Task is the semantic unit.

Worktree is an execution-isolation mechanism.

Do not make them equivalent concepts.

---

## 15. GEPA

Do not make GEPA a mandatory architectural dependency yet.

Study the actual GEPA implementation during development and determine whether its candidate-search / prompt-and-workflow optimization mechanisms provide real value to this application.

Potential useful areas include:

```text
Skills
task handoff templates
routing-table proposals
workflow configuration
evaluation-driven prompt improvement
```

If GEPA integrates cleanly and provides measurable benefits, use or adapt it.

If the existing architecture can solve the same problem more simply, document that conclusion and defer or omit GEPA.

Do not claim GEPA integration merely because similar optimization logic exists.

Do not restructure the entire application around GEPA.

---

## 16. Recuris

Treat Recuris similarly.

Study its approach to:

```text
working state
experience memory
experience invocation
progress checking
cross-task improvement
```

Determine whether parts of this model help the application maintain trustworthy project state and reusable experience.

Potentially useful concepts are:

```text
verified working state
reusable experience cards
context-dependent experience retrieval
checking claimed task progress against execution evidence
```

Do not introduce a second task database or second orchestration engine merely to reproduce Recuris.

If useful, adapt selected ideas to the application's existing Orca-derived task/run/state model.

If Recuris adds unnecessary complexity, document the evaluation and defer it.

It is a research/integration candidate, not a mandatory dependency.

---

## 17. Dream-RSI

Dream-RSI is not an active implementation target yet.

Its official repository currently does not provide the complete source code required for a proper integration.

Create only a placeholder or documented extension point.

For example:

```text
DreamRSIIntegration
status: deferred
reason: upstream code unavailable
```

Do not attempt to reconstruct or claim a complete Dream-RSI implementation at this stage.

Revisit it when the official codebase and reproduction scripts are released.

Its future role may involve optimizing:

```text
exploration branches
parallel attempts
continue/stop decisions
search budgets
```

but none of this is required now.

---

## 18. Improvement Architecture Should Remain Optional and Evidence-Driven

The core product must work without GEPA, Recuris or Dream-RSI.

The minimum architecture is:

```text
dot
→ app
→ Claude primary coordinator
→ Clef
→ routing table
→ Claude / Codex / agy
→ validation
→ result
```

Build this path first.

Improvement systems can be layered onto it later.

Do not make core task execution depend on experimental RSI components.

Any future self-improvement mechanism should modify local workflow assets or routing policy, not vendor model weights.

---

## 19. Internal Language

All generated internal orchestration communication should use English.

This includes:

```text
TaskSpec
Clef classification
routing decisions
agent handoff
workflow instructions
execution summaries
validation records
future optimization records
```

Original files, source text, quotations, code, paths and external content must remain unchanged unless transformation is explicitly required.

---

## 20. Current Architecture Summary

Treat this as the target mental model:

```text
ChatGPT dot
      │
      │ MCP
      ▼
Orca-derived Application
      │
      │ create / resume workflow run
      ▼
Claude Code Primary Session
      │
      │ planning + task decomposition
      ▼
TaskSpec
      │
      ▼
Clef
      │
      ├─ needs_delegation
      └─ task_type
      │
      ▼
Versioned Routing Table
      │
      ├─ Claude primary
      ├─ Claude native subagent
      ├─ Claude workflow
      ├─ Codex CLI
      └─ agy CLI
      │
      ▼
Execution / Artifacts
      │
      ▼
Validation
      │
      ▼
Claude Code Primary Session
      │
      ├─ next task
      └─ complete
```

The architectural rule is:

```text
Claude owns planning.
Clef owns task classification.
The Routing Table owns model/profile selection.
The Orca-derived runtime owns execution state.
Executors perform work.
Validators determine completion.
```

Do not give two different components ownership over the same decision.
