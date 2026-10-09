# NASH architecture and current decisions

Updated 2026-10-09. This describes the current source; published versions and verification are in [releases](releases.md). It replaces the earlier architecture, decision log and implementation plans. Historical D-number references in code describe decisions preserved in Git history; they do not override the current behavior below.

## 1. Product and ownership

Workbench is the app's task workspace. Dot submits and follows work through the local interface or the remote mailbox. Neither owns a second task scheduler.

Orca's runs, tasks, dispatches, terminal identities, worktrees and mailbox remain authoritative. NASH adds task classification, recorded routing, permission review and validation metadata. Reuse existing runtime paths; add only what the requested behavior needs.

A new request may launch a Claude Code or Codex coordinator. An existing local coordinator can adopt NASH task handling or be explicitly attached to Dot. Attachment preserves its process, model, context and task history. AGY is supported as a worker, not as an attached coordinator.

## 2. Task flow

1. The coordinator proposes a TaskSpec with its objective, outputs, acceptance criteria and constraints.
2. The classifier returns whether delegation is needed and the task type. It does not plan the task or select a model.
3. The routing table selects the execution target, exact model and supported effort, with an availability check.
4. Codex/AGY delegation uses Orca's native worker launch and context delivery. Claude in-session subagent/workflow paths remain available.
5. Results, messages and stopping use native runtime mechanisms. Native worker completion is not presented as an independent NASH validation pass.

The current classifier is Clef. Its settings use the generic name **Classifier**; other classifier providers have not been implemented. Credentials, verification, thresholds and runtime failure/quota protection remain. The removed Advanced panel no longer exposes its exclusive diagnostic state.

New NASH-managed tasks pass classification and routing. Pre-existing native tasks keep their native lifecycle. Further delegation returns to the coordinator.

## 3. Permissions, messages and validation

| Request | Reviewer |
|---|---|
| Ordinary worker permission | Its live coordinator |
| Ordinary coordinator permission | Dot, or the user's desktop/native CLI interface |
| Critical permission | The user; Dot receives a redacted summary requesting user confirmation |
| Inconclusive validation | Workbench or authorized Dot waive/reject flow |

Settings offers Yolo, Auto and Manual. Auto enables the existing review chain for supported NASH-managed runs; Manual keeps native prompts. Switching away from Auto prevents queued agent decisions from reaching the CLI. Existing choices are not silently migrated. Custom launch arguments retain their permission behavior, and managed runs always retain their access ceilings.

Claude Code, Codex and AGY have provider-specific permission adapters. A coordinator cannot approve itself or another run's workers. Review checks the actual process, pane and dispatch identity. File contents and edit bodies are not forwarded in permission summaries.

Hook integration runs after local provider setup. A failed provider configuration leaves the native permission UI available and does not prevent other providers from starting. Codex trust uses the vendor's hash for the exact NASH hook; unverifiable trust remains for native approval. Existing sessions are not restarted automatically.

Manual routed Claude/Codex workers honor the native structured-chat preference and approval UI, including the native execution-host fallback. Auto and other permission modes retain terminal workers. Native structured prompts do not expose the original tool inputs needed by layered review; no additional approval bridge is introduced.

Requests and tasks retain their read-only/workspace-write ceiling. Git write tasks use native child worktrees; folder and read-only tasks use the existing workspace. AGY's sandbox flag is not a complete filesystem read-only guarantee.

Dot attachment records control separately from the original request source. Receipt and first message are stored together; retries do not start another coordinator. Authorization is rechecked before sending held messages. Turning Dot off or lowering workspace access stops subsequent Dot actions without pretending the process has stopped.

An attached user-owned CLI is not terminated by canceling its Dot request. There is currently no separate detach command. Run switching is allowed only without active tasks, dispatches or pending permission requests.

Follow-up delivery uses Orca's prompt writer and keyed serial queue. Native hook status mutations wake held messages immediately; one shared fallback timer covers transitions and reconnects that do not publish hook mutations. Durable receipts, authorization checks before writes, and interrupted-paste handling remain NASH policy.

Native coordinator bindings determine current membership. Read projections exclude stale adopted owners immediately after rebinding. The workflow outcome and routing/access metadata remain: Orca's native run row has no equivalent business lifecycle status. Interrupted launches keep their existing recovery behavior.

Native decision gates remain task checkpoints, not permission or validation substitutes. Creating one ends the active dispatch and blocks its task; resolving one readies the task. Independent validation instead settles through the native task lifecycle and mailbox, preserving its separate evidence and waiver rules.

## 4. Runtime and data boundaries

- NASH has its own application identity and data directories. Official CLI accounts and binaries keep their native provider behavior.
- The permission database supports the known v2-to-v3 migration, preserving decisions and sequence numbers. This is not a general recovery path for arbitrary old development databases.
- No independent Codex/AGY task executor, result-file fallback, executable pinning or second planner is introduced. Independent validation reviewers retain their existing one-shot execution.
- Internal workflow messages use English; artifact language follows the task.
- Official plugins use Orca's native catalog and safety-feed lifecycle, controlled by the ordinary plugin-system setting. The extra NASH catalog opt-in is removed; app identity and all app-owned data paths remain NASH.
- Automatic update checks and downloads use `p1nbored/NASH` for stable and RC releases; no separate development repository is assumed. Feedback and crash-report actions open NASH GitHub Issue drafts for the user to review and submit in the browser. Opening a draft does not upload a report or mark it sent.
- The NASH restrictions on update, catalog and reporting entry points are removed. Other default Orca cloud services, account/mobile UI and unfinished RSI navigation remain disabled as recorded in the [feature comparison](nash-orca-feature-differences.md).
- GEPA, Recuris and Dream-RSI remain research ideas, not delivered product features.

Release assets include native update metadata starting with `v1.4.218`. Earlier builds require one manual upgrade because their update feed was disabled.

## 5. Routing configuration

The [bundled table](../desktop/src/main/routing-table/default-routing-table.json) is the source of the initial model choices formerly copied into this section. It is a starting configuration, not proof that every model is available on a user's account. The installed provider catalogs and launch-time checks decide availability.

The five execution targets remain `claude_primary`, `claude_subagent`, `claude_workflow`, `codex_cli` and `agy_cli`. New coordinator runs support Claude Code or Codex. An adopted coordinator keeps its existing model rather than taking the current settings.

Settings supports direct edits of coordinator, task routes and reviewers. Model selectors use the selected CLI's actual catalog, resolve concrete Claude aliases and deduplicate identical model IDs. **Refresh model list** refreshes those catalogs and the existing route readings; a failed listing is not replaced by static guesses. Concrete models are not blocked by an additional static slug list.

Effort choices follow the selected CLI/model. The configured Claude workflow exposes its model and effort, with Claude fixed as its CLI. Advanced import, proposal approval/rejection, version browsing and rollback operations were removed from both UI and backend.

Immutable internal versions, an index and hashes remain only for consistent saves and run configuration references. They do not reintroduce advanced management screens. Benchmark names in the initial table are historical provenance, not new benchmark verification.

## Source map

| Area | Source |
|---|---|
| Classifier | [main/clef](../desktop/src/main/clef), [task classification](../desktop/src/main/runtime/task-classification) |
| Routing and availability | [routing-table](../desktop/src/main/routing-table) |
| Coordinator, attachment and messages | [workflow-run](../desktop/src/main/runtime/workflow-run), [dot-ingress](../desktop/src/main/runtime/dot-ingress) |
| Native task launch and validation | [task-execution](../desktop/src/main/runtime/task-execution), [task-validation](../desktop/src/main/runtime/task-validation) |
| Permission adapters and relay | [CLI orchestration](../desktop/src/cli/handlers/orchestration), [permission-relay](../desktop/src/main/runtime/permission-relay) |
| Remote contracts | [dot-remote](../desktop/src/shared/dot-remote), [Dot integration guide](dot-mcp.md) |

See [operations](nash-operations.md) for setup and [releases](releases.md) for verified scope.
