import { maskSecretLikeText } from '../../agent-exec-shared/secret-shapes'
import { neutralizeDisplayControls } from '../../../shared/display-control-characters'
import {
  DECISION_BRANCH_MAX_CHARS,
  DECISION_PATH_MAX_CHARS,
  DECISION_REASON_MAX_CHARS,
  DECISION_TITLE_MAX_CHARS,
  type WorkbenchValidationDecisionView
} from '../../../shared/rpc-contract/workbench-validation-decision-params'
import type { AwaitingValidationEntry } from '../orchestration/db/app-attempt-queries'
import {
  getExecutorProcessStore,
  type ExecutorProcessRecord
} from '../orchestration/db/executor-process-store'
import type { OrchestrationDb } from '../orchestration/db/orchestration-db'
import { getTaskRouteStore } from '../orchestration/db/task-route-store'
import type { ValidationCheck } from '../orchestration/db/task-validation-record'
import { getTaskValidationStore } from '../orchestration/db/task-validation-store'
import type { TaskRow } from '../orchestration/types'
import { placementFromEvidence, type AttemptPlacement } from '../task-execution/attempt-workspace'
import { taskExecutorKind } from '../workbench-task-window/run-tasks-read'
import { recordLine } from './validation-record-text'

// Read-only: what the desktop (or dot) is shown about one result waiting for a decision. Text that
// came from the primary or a check is masked and bounded here, before it leaves main.

const REASON_FALLBACK = 'Validation could not decide this result.'
const TITLE_FALLBACK = 'Untitled task'
/** Room past the shown excerpt, so a secret that straddles its end is still whole when masked. */
const MASK_WINDOW_FACTOR = 4

// Why cut before masking: an objective can be 256 KiB, and the list is read every few seconds.
function excerpt(text: string, maxChars: number): string {
  const head = neutralizeDisplayControls(text.slice(0, maxChars * MASK_WINDOW_FACTOR))
  const line = maskSecretLikeText(head.replace(/\s+/g, ' ').trim())
  return line.length <= maxChars ? line : `${line.slice(0, maxChars - 1).trimEnd()}…`
}

/** A live or unverifiable tree: the process may still write, so a waive must not lead to a merge. */
function treeMayRun(executor: ExecutorProcessRecord | null): boolean {
  return executor?.treeVerdict === 'live' || executor?.treeVerdict === 'unverifiable'
}

function titleOf(task: TaskRow | undefined): string {
  const text = task?.task_title ?? task?.display_name ?? task?.spec ?? ''
  return excerpt(text, DECISION_TITLE_MAX_CHARS) || TITLE_FALLBACK
}

/** The first undecided check's note, else its kind, as one masked English line. */
function reasonOf(checks: readonly ValidationCheck[]): string {
  const undecided = checks.find((check) => check.status === 'inconclusive')
  if (!undecided) {
    return REASON_FALLBACK
  }
  const text = undecided.note ?? `The ${undecided.kind} check could not decide.`
  return recordLine(text, { fallback: REASON_FALLBACK, maxChars: DECISION_REASON_MAX_CHARS })
}

function placementWords(
  placement: AttemptPlacement | null,
  hasExecutor: boolean
): Pick<WorkbenchValidationDecisionView, 'placement' | 'worktree'> {
  if (placement?.mode === 'own_worktree') {
    const { branch, path, baseCommit } = placement.worktree
    return {
      placement: 'own_worktree',
      worktree: {
        branch: excerpt(branch, DECISION_BRANCH_MAX_CHARS),
        path: excerpt(path, DECISION_PATH_MAX_CHARS),
        baseCommit: excerpt(baseCommit, 64)
      }
    }
  }
  if (placement) {
    return { placement: placement.mode, worktree: null }
  }
  return { placement: hasExecutor ? 'unrecorded' : 'in_session', worktree: null }
}

export type DecisionViewReader = {
  /** The attempt's placement as its launch evidence recorded it; null for none. */
  placementOf(dispatchId: string): AttemptPlacement | null
  /** Whether a process of the attempt may still run, from its recorded tree verdict. */
  processMayRunOf(dispatchId: string): boolean
  view(entry: AwaitingValidationEntry): WorkbenchValidationDecisionView | null
}

export function createDecisionViewReader(owner: OrchestrationDb): DecisionViewReader {
  const executors = getExecutorProcessStore(owner)
  const routes = getTaskRouteStore(owner)
  const validations = getTaskValidationStore(owner)
  const placementOf = (dispatchId: string): AttemptPlacement | null =>
    placementFromEvidence(executors.get(dispatchId)?.executableEvidence ?? null)
  return {
    placementOf,
    processMayRunOf: (dispatchId) => treeMayRun(executors.get(dispatchId)),
    view(entry) {
      const validation = entry.validationId ? validations.get(entry.validationId) : null
      if (!validation) {
        return null
      }
      const executor = executors.get(entry.dispatchId)
      const route = executor ? routes.get(executor.routeId) : routes.latestForTask(entry.taskId)
      return {
        validationId: validation.validationId,
        runId: entry.runId,
        taskId: entry.taskId,
        dispatchId: entry.dispatchId,
        title: titleOf(owner.getTask(entry.taskId)),
        executorKind: taskExecutorKind(executor ? [executor] : [], route),
        model: route?.model && route.model !== 'inherit' ? route.model : null,
        reason: reasonOf(validation.checks),
        inconclusiveAt: validation.updatedAt,
        ...placementWords(placementOf(entry.dispatchId), executor !== null),
        // Desktop only: the dot view (G7-A) is built from its own narrow fields, never from this one.
        processMayRun: treeMayRun(executor)
      }
    }
  }
}
