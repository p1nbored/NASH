# Routing Table evidence

- Date: 2026-10-05. Scope: the bundled default Routing Table, version 1 (`desktop/src/main/routing-table/default-routing-table.json`).
- Purpose: keeps benchmark evidence out of runtime code, as the [architecture direction](architecture-direction.md) requires (sections 6 and 7). The table rows carry source names only. This document adds the URLs and, once the user supplies it, the snapshot date.
- **Snapshot date: awaiting user.**
- **No scores.** This document records no benchmark score, rank or number. Scores belong to the dated snapshot pages at the sources themselves.

## How the evidence is used

- The evidence explains why a default route was chosen. No routing code reads it. The table schema's `benchmark_sources` (name, optional https URL), `benchmark_snapshot_date` and `notes` fields are informational, and a hygiene test checks that no module outside the schema reads them.
- A benchmark change never changes routing by itself. It may lead to a proposal for a new table version, which the user accepts, rejects or modifies (direction section 8).
- Benchmark rank is separate from availability. A route activates only when its CLI, model, reasoning level and login are verified on this machine (direction section 9).
- The source names on the bundled rows are package A1's reading of direction section 6, which names sources by workload rather than per row. The user may confirm, change or remove them; they await confirmation.

## Sources

The URLs below are the sources' home pages, as named in direction section 6. They were not fetched for this document. The specific leaderboard pages are to be recorded with the snapshot.

| Source name (as in the table) | URL | Used for (direction section 6) |
|---|---|---|
| Artificial Analysis | https://artificialanalysis.ai/ | General intelligence, terminal performance, automation, software engineering, scientific coding, long-context reasoning, PDF and document understanding, cost and performance |
| Arena | https://arena.ai/ | Human preference, writing, creative writing, coding preference, general open-ended response quality |
| Vals | https://www.vals.ai/ | Specialist benchmarks that measure a relevant workload directly, for example scientific terminal workflows |

## Evidence per row

| task_type | Default route (v1) | Sources named in the table | Workload the source is consulted for | Rationale (direction section 6) |
|---|---|---|---|---|
| (coordinator) | Claude primary session, `claude-opus-5-5`, max | none recorded | General intelligence, long-context reasoning | "strongest default for difficult reasoning and high-level integration" |
| `coordinator_reasoning` | `claude_primary`, inherit | none (stays with the coordinator) | n/a | Coordinator's own reasoning; no delegated route |
| `complex_planning_reasoning` | `claude_subagent`, `claude-opus-5-5`, max | Artificial Analysis | General intelligence, long-context reasoning | "strongest default for difficult reasoning and high-level integration" |
| `software_engineering` | `claude_subagent`, `claude-sonnet-5-5`, max | Artificial Analysis | Software engineering, terminal performance, automation | "strong engineering / terminal / automation executor" |
| `scientific_experiment_validation` | `codex_cli`, `gpt-6-astra`, max | Artificial Analysis; Vals | Scientific coding; scientific terminal workflows | "strong scientific and experimental workflow executor" |
| `complex_pdf_evidence_analysis` | `codex_cli`, `gpt-6.1-sol`, max | Artificial Analysis | PDF and document understanding, long-context reasoning, cost and performance | "strong cost/performance default for analysis, PDF/evidence work, routine research and frequent delegated tasks" |
| `general_research_analysis` | `codex_cli`, `gpt-6.1-sol`, max | Artificial Analysis | General intelligence, cost and performance | same as above |
| `routine_analysis_batch` | `codex_cli`, `gpt-6.1-sol`, high | Artificial Analysis | Cost and performance | same as above |
| `high_quality_writing` | `claude_subagent`, `claude-opus-5-5`, high | Arena | Human preference, writing | No row-specific rationale in the direction; Arena is the source it names for writing |
| `fast_writing_or_alternative_draft` | `agy_cli`, `gemini-3.8-flash-high`, high when supported | Arena | Writing, creative writing | "optional agy executor for fast writing, alternate drafts and suitable tasks when available" |
| `configured_project_workflow` | `claude_workflow`, inherit | none (inherits the coordinator) | n/a | Workflows are execution mechanisms, not model families (direction section 13) |
| Validation reviewers | `codex_cli` `gpt-6.1-sol` high, then `claude_headless` `claude-opus-5-5` high | none recorded | n/a | Chosen for independence from the work model (D-017, D-020), not from benchmarks |

Notes:

- "high when supported" for agy means the variant id `gemini-3.8-flash-high` with no effort flag, because agy 1.2.14 encodes thinking in the model id variant. The id comes from the installed `agy models` listing (G2, 2026-10-04), not from a benchmark.
- Gemini 4 stays excluded whatever the benchmarks show, until broad availability is verified (direction section 12).
- The direction warns that "These defaults are not permanent rankings" and that benchmark differences do not prove one model is universally superior.

## Recording a snapshot

When the user supplies a snapshot:

1. Record the snapshot date (ISO date) at the top of this document.
2. For each row, record the exact leaderboard or evaluation pages consulted (https URLs) and what was compared, in words. Record no scores here or in code.
3. Optionally mirror the URLs and date into the table rows (`benchmark_sources[].url`, `benchmark_snapshot_date`) through a proposal. Accepting it creates a new table version; the bundled default is never edited in place.
4. If the evidence suggests a different default, propose a table change. The user decides; nothing activates automatically.
