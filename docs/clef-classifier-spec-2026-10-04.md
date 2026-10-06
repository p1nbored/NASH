# Clef classifier specification (TaskSpec classification)

- Date: 2026-10-05. The name keeps the 2026-10-04 series of the [Clef adapter spec](clef-adapter-spec-2026-10-04.md), which this document partly supersedes.
- Status: describes what is built in `desktop` (packages B1 and C2, with K1 in progress for D-022). Authority: D-016, D-020, D-022 and D-013 in the [decision log](decision-log.md).
- **Not verified live.** No billed Clef call has been made. Everything below is tested with injected fakes only. The first live call is gate G4 (section 8).

## 1. Scope

Clef answers two questions about each TaskSpec that the Claude Code primary session proposes: what kind of task it is (`task_type`) and whether it should be delegated (`needs_delegation`). Clef chooses no target, model, effort or surface; the [Routing Table](architecture.md#7-routing-table) does that. There is no Clef call at intake.

Still in force from the adapter spec:

- process boundaries (section 2);
- sealed credentials (section 4), now stored under `~/.nash` (D-017);
- the endpoint, headers and content scan (section 5);
- response validation (section 6);
- transport, error mapping, latches and the circuit (section 7);
- the spend ledger mechanism (section 8, without caps);
- the verified-profile mechanism (section 14).

This document replaces the adapter spec's question set, tuple catalog, decision policy, lifecycle and phasing (sections 5, 9, 10, 12 and 16) and its paid-call caps (D-022).

Code, under `desktop/src/`:

- `main/clef/clef-question-set.ts`: the bundle;
- `main/clef/clef-classification-rules.ts`: the outcome rules;
- `main/clef/clef-state-builder.ts`: the state;
- `main/runtime/workbench-routing/routing-gates.ts`: gates G0 and G1;
- `main/runtime/task-classification/`: the classifier;
- `main/clef/clef-spend-ledger.ts` and `main/clef/clef-classification-spend.ts`: spend.

## 2. Input: the `agent_task_spec` data class

- Only TaskSpecs written for agents reach Clef. Their data class is `agent_task_spec`; the app assigns it and a TaskSpec cannot set or lower it. The G1 allow list holds only this class, so the user's request summary (`user_task_summary`) no longer reaches Clef (D-020).
- The Clef `state` is built from the TaskSpec:

| State field | From TaskSpec | Cap in the state |
|---|---|---|
| `objective` | `objective` | 2,000 characters of prose after span masking |
| `expected_outputs` | `expectedOutputs` | 16 items of 500 characters |
| `acceptance_criteria` | `acceptanceCriteria` | 16 items of 500 characters |
| `explicit_constraints` | `constraints` | 16 items of 500 characters |
| `data_class` | set by the app | the constant `agent_task_spec` |

- Verbatim spans (quoted names, paths and quotations, D-013) are replaced by the placeholder `[quoted text]` before the scan and the caps. The deliverable language never enters the state.
- A field over a state cap is sent as an excerpt ending in ` [truncated]`, never cut inside a placeholder or a surrogate pair; a long list keeps its first items plus `[truncated: N more items]`. If the request is still over the preflight bounds, the caps are halved, down to an eighth (D-027). The content scan runs over the whole masked TaskSpec before any excerpt is taken.
- Paths, file contents, diffs, terminal output and hashes never leave the machine. TaskSpec prose in any language is sent after masking (D-027).

## 3. The two questions (bundle version 2, taxonomy version 2)

Sent in this order. The texts are bundle values: changing one changes the bundle hash (section 7).

**Question `task_type`** (choice). Instructions: "Classify the main kind of work that the task in the state asks for."

| Option | Text |
|---|---|
| `coordinator_reasoning` | Reasoning the coordinating session does for itself: interpreting results, deciding next steps, integrating outputs or judging overall progress. |
| `complex_planning_reasoning` | Difficult planning, design or multi-step reasoning, such as architecture or decomposing a hard problem. |
| `software_engineering` | Writing, changing, debugging, testing or reviewing code, configuration, builds or terminal automation. |
| `scientific_experiment_validation` | Designing, running or checking scientific experiments, numerical analyses or research code and their results. |
| `complex_pdf_evidence_analysis` | Extracting and reconciling evidence from long or complex PDFs or other documents, with citations. |
| `general_research_analysis` | Investigating a question across sources and producing an analysis or comparison. |
| `routine_analysis_batch` | Repetitive or high-volume analysis of many similar items with a fixed procedure. |
| `high_quality_writing` | Polished prose where quality matters most, such as reports, documentation or final deliverables. |
| `fast_writing_or_alternative_draft` | A quick draft or an alternative version of a text, where speed matters more than polish. |
| `configured_project_workflow` | Running a workflow that the project already defines and that the task names. |
| `needs_clarification` | The task does not say clearly enough what kind of work it is. |

**Question `needs_delegation`** (noul). Instructions: "Should this task be handed to a separate executor instead of being done by the coordinating session itself?"

- true: "The task is self-contained, states its inputs and acceptance criteria, and a separate agent can do it without the coordinator's full context."
- false: "The task depends on the coordinator's own context or judgment, or is too small to be worth handing off."

**Thresholds.** `needs_delegation` is true at a probability of 0.6 or more and false at 0.4 or less. The `task_type` leader must beat the runner-up by at least 0.10.

The thresholds and the 13 answer texts (11 options plus 2 criteria) are defaults awaiting user confirmation before the first billed Verify (D-020, U11). Removed from bundle version 1: `difficulty`, `context_scope`, `inputs_complete` and `route`.

## 4. Gates and pipeline

The classifier runs asynchronously after `task-propose`. `classify(taskId)` returns a pending handle within 50 ms and joins a call already in flight. Stages, in order:

1. **G0 configuration:** sealed credentials present, a verified profile present, the response model pinned. Failing it gives `classifier_unavailable` with `not_configured`, `contract_unverified` or `clef_identity_unpinned`. G0 checks no spend cap (D-022).
2. **Active Routing Table:** a table that is not installed, is damaged or has another taxonomy refuses before any call, so nothing is spent. Recorded as `blocked/routing_table_unavailable`. The bundled table is never used as a fallback.
3. **G1 data boundary:** the content scan (secrets, paths, 32-hex ids, 64-hex hashes, tokens, emails and similar, ignored inside verbatim spans), then the allowed data class. Failing it gives `classifier_unavailable/data_boundary_forbids`, and only the matched rule name is recorded. A blank objective, or one with no letters, gives `missing_inputs/needs_clarification`.
4. **Request build and preflight:** body at most 64 KiB and estimated input at most 12,000 tokens; otherwise refused with no call.
5. **Call circuit:** opens after 3 consecutive `transient_exhausted` outcomes and half-opens after 5 minutes.
6. **Cache:** an exact fingerprint hit reuses classified answers only. The fingerprint covers the URL template, model path, body model, pinned response model, profile hash, bundle hash and state hash. The route is still looked up afresh. The cache is in memory, so after a restart the same TaskSpec is billed again.
7. **Reserve and call:** the ledger reserves before the call (section 6). Raw response bytes are stored before parsing.
8. **Validate:** the model identity must match the pin, the answer keys and types must match the questions, and probabilities must sum within tolerance. Any failure is `invalid_output` and is never retried.
9. **Decide:** the outcome rules (section 5).
10. **Record:** a `task_classifications` row holds the recorded answers, blocker codes and evidence (hashes, scan rule names, attempt counts), never TaskSpec text.
11. **Route:** when delegated, `resolveRoute` on the active table with the run's workspace, and with the live-primary evidence when the run's primary is running. The result goes to `task_routes`. An unavailable route is recorded with its reasons and nothing is substituted. When not delegated, a `not_delegated` row names the run's launch table.

Settling posts an English status notice to the run mailbox. `cancel` records `discarded_after_cancel`, and quitting records `interrupted`. An unexpected error settles as `failed` with a code, never a message.

## 5. Outcome rules

The rules are reject-only and never re-rank. They are applied in this order.

| # | Condition | Outcome |
|---|---|---|
| 1 | The response failed validation | `invalid_output` with its detail (shape, model identity, truncation) |
| 2 | `task_type` is `needs_clarification` | `missing_inputs/needs_clarification`; the primary rewrites the TaskSpec |
| 3 | `task_type` is not a routable type | `invalid_output/choice_outside_legal_set` |
| 4 | The `task_type` leader beats the runner-up by less than 0.10, or ties it | `ambiguous/low_margin` |
| 5 | The `needs_delegation` probability is above 0.4 and below 0.6 | `ambiguous/low_margin` |
| 6 | `needs_delegation` is true and the type is `coordinator_reasoning` | `ambiguous/inconsistent_delegation`, since no delegated route exists for it |
| 7 | Otherwise | `classified {needs_delegation, task_type}` |

- With `needs_delegation=false` the primary does the task itself, and the type is recorded for audit (U10).
- With `true` the app resolves the route.
- Provider confidence is stored and never read. No outcome falls back to another classifier, a stale decision or a rule router.

## 6. Spend: a retry bound, no budget caps (D-022)

- At most **2 billed attempts per TaskSpec**, retries included. A third is refused with `request_attempts_exhausted`. This is a retry bound, not a budget.
- Spend rows are numbered per Workbench request, so `UNIQUE(request_id, attempt)` holds. `clef_classification_spend` links each reservation to its run, task and attempt. A run may hold any number of TaskSpecs.
- The app sets **no budget cap**: no US$5 verification budget, no daily neuron cap, no daily classification cap, no refusal when a cap is unset, and no cost warning or confirmation.
- The ledger still records every billed call. It reserves before the call (estimated input times 1.5 at the pinned input price, plus a margin) and settles from the reported usage. A failed call or one without usage keeps its reservation as spent.
- Startup recovery closes reservations a crash left open, as spent. It records `blocked/interrupted` for every TaskSpec whose last billed attempt has no record. Nothing is re-called automatically.
- Testing rule for development, not enforced by the app: live Clef calls made while building and testing NASH stay within the Cloudflare free tier plus US$5 in total.
- Package K1 removes the remaining cap fields and the Settings cost confirmation; it was in progress while this was written.

## 7. The verified profile and what invalidates it

- The profile (`<userData>/clef-verified-profile.json`, `profileVersion: 2`) pins:
  - the envelope mode;
  - the expected response model;
  - the option-id form;
  - the probability-sum tolerance;
  - the verification time;
  - the report hash.
  Only `workbench.clef.profile.pin` writes it, from the desktop.
- The profile is read only while the question-bundle hash and the output-contract hash match the code. At the time of writing they are `60460f20de6ab2de0eb844b81ecadefc7aa35ca03587f4b1591a6d7484a78ad7` (bundle) and `e87330a4009d4089853b6a41df97409919b3105e643fb2c00f4b36510041a4e9` (output contract).
- Any change to a question text, threshold, the taxonomy or the output contract makes a stored profile read as absent (`contract_unverified`), so Verify must run again. A version-1 profile file also reads as absent.
- Editing the Routing Table (targets, models, efforts) never touches the profile.

## 8. Verification sequence (gate G4)

1. **Confirm the bundle.** The user confirms or changes the thresholds and the 13 answer texts (D-020). Any change gives a new bundle hash, and the golden test pins are updated deliberately.
2. **Credentials.** The user rotates the Cloudflare token (D-012) and types the token and account identifier into NASH Settings > Integrations. They are sealed with the operating system's protection (DPAPI on Windows); a plaintext fallback is refused. The UI reports presence and protection only.
3. **Verify.**
   - The user clicks Verify in the Clef verification section. NASH makes one billed call with purpose `verification`: one synthetic English TaskSpec through the production request builder, offering exactly the two questions.
   - Estimate: about 564 input tokens and a 2,292-byte body, reserving 1,204 micro-dollars (about US$0.0012).
   - There is no cost dialog (D-022). The call counts toward the testing rule.
4. **Review the report.** Report version 2 shows:
   - the HTTP status and envelope shape;
   - the `model` value;
   - the answers and whether the option ids were echoed;
   - probability coverage and sums;
   - token usage against the estimate;
   - the raw-body sha256.
   It never shows the token, the account identifier or the concrete URL.
5. **Pin.** On a pinnable report the user clicks Pin profile, which sends only the report's sha256, and the profile is written. Otherwise the report lists its problems and nothing is pinned.
6. **Check.** G0 now passes. The routing status in Settings reads ready, and TaskSpecs are classified as they are proposed.

What G4 does not verify: classification quality on real TaskSpecs, the content scan's behaviour on agent-written text (it may block TaskSpecs that mention paths or hashes outside spans), and the billing of failed calls.

## 9. Open points

- The thresholds and the 13 answer texts await user confirmation. Today Settings only warns before Verify instead of blocking it.
- The TaskSpec limits exceed the Clef state caps (section 2).
- The cache is in memory, so restarts re-bill.
- Refusing before the call when the Routing Table is unusable was a package choice, to save spend. It awaits confirmation.
- The retry bound reuses the ledger's old `request_attempts_exhausted` code.
