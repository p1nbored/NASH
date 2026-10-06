import { autopilotCliInvocation } from '../../shared/workflow-run/autopilot-cli-commands'
import type { OrchestrationDb } from '../runtime/orchestration/db/orchestration-db'
import { getTaskSpecStore } from '../runtime/orchestration/db/task-spec-store'
import type { MessageRow } from '../runtime/orchestration/types'
import type { ClassificationSettled } from '../runtime/task-classification/classification-runtime'
import type { AutopilotRuntimeLog } from './autopilot-runtime-events'
import { installFailureCode } from './autopilot-install-runner'

// D-016 section 1.3 step 4: a settled classification leaves a status notice in the run mailbox, so an
// idle primary learns the route without polling. The notice names codes only, never TaskSpec text,
// a model or an effort; the primary reads the rest with task-show.

export const CLASSIFICATION_NOTICE_SENDER = 'app:task-classification'

export type ClassificationNoticeDeps = {
  readonly owner: OrchestrationDb
  readonly cliCommand: string
  /** `runtime.notifyMessageArrived(message.to_handle, message.type)`. */
  readonly announce: (message: MessageRow) => void
  readonly log: AutopilotRuntimeLog
}

function routeSentence(settled: Extract<ClassificationSettled, { status: 'recorded' }>): string {
  const { route } = settled
  if (route.kind === 'recorded') {
    const target = route.route.target ?? 'none'
    return ` Its route is \`${target}\`, status \`${route.route.status}\`.`
  }
  return route.kind === 'refused' ? ` No route was recorded (\`${route.reason}\`).` : ''
}

function noticeOf(
  settled: ClassificationSettled,
  show: string
): { subject: string; body: string; outcome: string } {
  const task = `task \`${settled.taskId}\``
  if (settled.status === 'failed') {
    return {
      subject: `Task ${settled.taskId}: classification failed`,
      body: `The classification of ${task} failed (\`${settled.code}\`). Read the task with \`${show}\`; the user decides how to continue.`,
      outcome: 'failed'
    }
  }
  const { outcome, taskType, detail } = settled.classification
  const typed = taskType ? ` with task type \`${taskType}\`` : ''
  const why = detail ? ` (\`${detail}\`)` : ''
  return {
    subject: `Task ${settled.taskId}: classification ${outcome}`,
    body: `The classification of ${task} finished as \`${outcome}\`${why}${typed}.${routeSentence(settled)} Read it and the next step with \`${show}\`.`,
    outcome
  }
}

/** The classifier's `onSettled`: one mailbox notice per settled classification, then the pointer. */
export function createClassificationNotice(
  deps: ClassificationNoticeDeps
): (settled: ClassificationSettled) => void {
  return (settled) => {
    try {
      const spec = getTaskSpecStore(deps.owner).get(settled.taskId)
      if (spec === null || spec.orphaned) {
        return
      }
      const show = `${autopilotCliInvocation(deps.cliCommand, 'task-show')} --task ${settled.taskId} --json`
      const notice = noticeOf(settled, show)
      const message = deps.owner.insertMessage({
        runId: spec.runId,
        from: CLASSIFICATION_NOTICE_SENDER,
        to: `run:${spec.runId}`,
        subject: notice.subject,
        body: notice.body,
        type: 'status',
        payload: JSON.stringify({
          kind: 'task_classified',
          taskId: settled.taskId,
          outcome: notice.outcome
        })
      })
      deps.announce(message)
    } catch (error) {
      deps.log({
        event: 'classification_notice_failed',
        taskId: settled.taskId,
        code: installFailureCode(error)
      })
    }
  }
}
