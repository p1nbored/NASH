import { autopilotCliInvocation } from '../../../shared/workflow-run/autopilot-cli-commands'
import { subagentNameForTaskType } from '../workflow-run/primary-session-agents'

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
