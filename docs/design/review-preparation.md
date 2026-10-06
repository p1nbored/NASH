# Review preparation and budget

> User-directed ownership update: frontend optimization belongs to Claude Code; Codex uses existing Orca styles for additive features. This file is preserved as the future review contract and capability handoff.

Date: 2026-10-03. Status: preparation implemented; no live critic dispatched, no visual score recorded, no direction frozen.

## Role and context boundaries

The builder reads code, briefs, session evidence and functional results. Independent audit agents in this stage inherit implementation access and are **code/process reviewers**, not the screenshot-only Design Critic.

A future critic requires an actual application-owned task and a valid Clef model/surface tuple under the approved vision/isolation constraints. It gets only unchanged `docs/design/review-prompt.md`, neutral screenshot IDs, dimensions and image pixels. No repository, instructions/memory, parent transcript, DOM/CSS, builder explanation, direction ranking, previous report, seed or model identity enters its task-specific input. Do not resume a previous critic conversation. Tools/network/terminal/repository read/write must be absent or technically restricted; a prompt or read-only write sandbox is insufficient.

The current collaboration host does not expose per-agent filesystem/tool restrictions. `fork_turns="none"` alone cannot clear the gate. CLI image flags and catalog modalities are interface evidence, not a live vision/isolation pass. See [capability preflight](capability-preflight.md) for exact available controls and limitations. No objectively stronger critic has been established.

Before dispatch, verify isolation using an image-only fixture environment with a synthetic context-leak sentinel, inspect actual tool inventory/mounts/settings and prompt provenance, and verify that only the supplied pixels can be read. Preserve the observed test receipt. Do not send real secrets as a probe. Missing restriction evidence blocks review. A clean-context probe itself follows authorized routing/budget requirements.

## Evidence and admission

Capture settled real renderer states at fixed viewport/theme/scroll/scenario; preserve source/asset/fixture and output hashes outside critic input. Captures receive neutral IDs. Ordering is neutralized before pairwise comparison. Secret redactions are recorded and must not conceal failures or authority state. Prototype screenshots cannot satisfy Define's application-renderer gate.

Preserve raw JSON reports unchanged, then bind a separate receipt to task, actual model/surface/operation, route, capability checks, prompt hash, capture hashes and resource use. Store source screenshots and provenance outside the critic's input boundary. Use null for unknown telemetry or unassessable scores. Retain failure and compromised-review evidence without cherry-picking.

The code-owned policy is fixed: one initial review and at most three revisions per required family; total >=85, each criterion >=60% of maximum, no unresolved high issue. Functional/accessibility/security/lifecycle/performance checks remain independent. At exhaustion preserve best evidenced candidate and report `design_review_blocked`; no extra critics or lower thresholds.

`scripts/design/review-gate.mjs` implements an offline admission shape/policy check with fixture tests. It rejects prototypes, changed rubric, missing Clef registration, disallowed context, missing isolation/image flags, capture mismatch, compromised reviews, cap overflow, null/weak scores and high visible defects. Its supplied metadata is untrusted until a future trusted runtime validates it. It does not itself enforce isolation, transactionally reserve budgets, authenticate attestations, or authorize release.

## Allocation and current receipt

Work performed: local seed generation, three candidate directions, six prototype captures, token math and offline tests, plus development-chat audit subagents. Application-routed live critic/classifier/asset dispatches: **0**. No paid API call was made; development-chat provider consumption is not separately measured and is not claimed free. No provider cost estimate is presented as actual usage.

The overall numeric live budget is not approved. Before a real dispatch, present a concrete ceiling for jobs/reviews/assets, wall time, attempts and provider quota; preserve unknown monetary telemetry rather than claiming a hard billing cap. The fixed one-plus-three per-family cap is an upper bound, not authorization to spend.

No runtime task registry exists yet, so there are no fabricated builder/critic/asset task IDs or Clef decisions. `job-intents.json`, archived outside the repository on 2026-10-04, is a non-executable preparation record with null task/route IDs. Model names and skill availability alone cannot advance these intents to READY.

Review packet shape tests currently use synthetic metadata and cannot establish runtime or live design capability. Actual renderer capture, screenshot-only critic, custom assets and final functional verification remain pending.
