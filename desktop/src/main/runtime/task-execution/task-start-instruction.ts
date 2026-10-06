import { autopilotCliInvocation } from '../../../shared/workflow-run/autopilot-cli-commands'
import { subagentNameForTaskType } from '../workflow-run/primary-session-agents'
import type { AttemptPlacement } from './attempt-workspace'
import {
  EXECUTOR_NAMES,
  isQuotable,
  taskShowCommand,
  type NoticeExecutor
} from './task-result-notice'

// The English reply task-start gives the primary session: who runs the attempt and how its result
// comes back. In-session attempts name exactly one subagent or workflow; the definition the session
// was launched with (--agents) carries the model and effort, so neither is repeated here.

export type InSessionTarget = 'claude_subagent' | 'claude_workflow' | 'claude_primary'

export type InSessionInstructionInput = {
  readonly taskId: string
  readonly dispatchId: string
  readonly cliCommand: string
  readonly target: InSessionTarget
  /** Null for a task the primary keeps; a subagent attempt needs it to name its definition. */
  readonly taskType: string | null
  readonly workflowName: string | null
}

function reportCommand(input: InSessionInstructionInput): string {
  const invocation = autopilotCliInvocation(input.cliCommand, 'task-report')
  return `${invocation} --task ${input.taskId} --attempt ${input.dispatchId} --summary-file - --json`
}

function targetSteps(input: InSessionInstructionInput, report: string): readonly string[] {
  switch (input.target) {
    case 'claude_subagent':
      if (input.taskType === null) {
        throw new RangeError('A subagent attempt needs the task type.')
      }
      return [
        `Start the subagent \`${subagentNameForTaskType(input.taskType)}\` with the Agent tool, and make \`Attempt: ${input.dispatchId}\` the first line of its prompt, followed by the task objective, expected outputs, acceptance criteria and constraints.`,
        'Do not start any other agent for this task.',
        `When the subagent returns, send its report on stdin to \`${report}\`.`
      ]
    case 'claude_workflow':
      if (input.workflowName === null) {
        throw new RangeError('A workflow attempt needs the workflow name.')
      }
      return [
        `Run the project workflow \`${input.workflowName}\` for this task in this session.`,
        'Do not start any other agent or workflow for this task.',
        `When the workflow finishes, send its report on stdin to \`${report}\`.`
      ]
    case 'claude_primary':
      return [
        'Do this task yourself in this session, and do not start an agent for it.',
        `When you finish, send your report on stdin to \`${report}\`.`
      ]
  }
}

export function inSessionInstruction(input: InSessionInstructionInput): string {
  return [
    `Attempt \`${input.dispatchId}\` of task \`${input.taskId}\` is started and runs in this session.`,
    ...targetSteps(input, reportCommand(input)),
    // Why: without the flag a failed attempt reads as a claim until the validators catch it.
    'If the attempt failed, add `--outcome failed` to that command.'
  ].join(' ')
}

const COMMIT_FIRST =
  "Each writing task starts from your worktree's last commit, so commit what a task needs before you start it."
const SHORT_COMMIT_CHARS = 12

/** D-025: where a writing attempt writes, said before the primary starts its next writing task. */
function placementSteps(placement: AttemptPlacement): readonly string[] {
  switch (placement.mode) {
    case 'run_workspace':
      return []
    case 'folder':
      return [
        'It writes directly in this folder workspace: writing tasks in a folder are not kept apart from each other or from your own edits.'
      ]
    case 'own_worktree': {
      const { branch, path, baseCommit } = placement.worktree
      const commit = baseCommit.slice(0, SHORT_COMMIT_CHARS)
      const where =
        isQuotable(branch) && isQuotable(path)
          ? `It writes in its own worktree \`${path}\` on branch \`${branch}\`, started from commit \`${commit}\` of your worktree, so changes you have not committed are not in it.`
          : `It writes in its own worktree, started from commit \`${commit}\` of your worktree, so changes you have not committed are not in it.`
      return [where, COMMIT_FIRST]
    }
  }
}

export function processInstruction(input: {
  readonly taskId: string
  readonly dispatchId: string
  readonly cliCommand: string
  readonly kind: NoticeExecutor
  readonly placement: AttemptPlacement
}): string {
  const show = taskShowCommand(input.cliCommand, input.taskId)
  return [
    `Attempt \`${input.dispatchId}\` of task \`${input.taskId}\` runs in the ${EXECUTOR_NAMES[input.kind]} as an app process.`,
    ...placementSteps(input.placement),
    'Do not do this task yourself and do not start an agent for it.',
    `Its result arrives in the run mailbox; read it with \`${show}\`.`
  ].join(' ')
}
