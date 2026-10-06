import type {
  AutopilotTaskPhase,
  AutopilotTaskView
} from '../../../../../../shared/rpc-contract/orchestration-autopilot-views'
import { autopilotCliInvocation } from '../../../../../../shared/workflow-run/autopilot-cli-commands'

/** What the stores say about one task; `describeAutopilotTask` turns it into the primary's view. */
export type AutopilotTaskSnapshot = {
  taskId: string
  runId: string
  title: string | null
  /** Orca's task status: pending, ready, dispatched, completed, failed or blocked. */
  status: string
  /** True while Clef holds an unfinished classification of this task. */
  classifying: boolean
  classification: AutopilotTaskView['classification']
  route: Omit<NonNullable<AutopilotTaskView['route']>, 'delegated'> | null
  attempt: AutopilotTaskView['attempt']
  validation: AutopilotTaskView['validation']
}

type Step = { phase: AutopilotTaskPhase; waitable: boolean; next: string }

const STAGE_VALIDATION_PENDING = 'validation_pending'
const STAGE_VALIDATION_INCONCLUSIVE = 'validation_inconclusive'
const ASK_USER = 'Ask the user how to continue.'

type Commands = {
  start: string
  wait: string
  report: (attemptId: string) => string
}

function commandsFor(cliCommand: string, taskId: string): Commands {
  const run = (command: 'task-start' | 'task-show' | 'task-report', flags: string) =>
    `\`${autopilotCliInvocation(cliCommand, command)} --task ${taskId} ${flags}\``
  return {
    start: run('task-start', '--json'),
    wait: run('task-show', '--wait --json'),
    report: (attemptId) => run('task-report', `--attempt ${attemptId} --summary-file - --json`)
  }
}

function step(phase: AutopilotTaskPhase, next: string, waitable = false): Step {
  return { phase, waitable, next }
}

function readyStep(snapshot: AutopilotTaskSnapshot, commands: Commands): Step {
  const { classification, route } = snapshot
  if (!classification) {
    return snapshot.classifying
      ? step('classifying', `Clef is classifying the task. Wait with ${commands.wait}.`, true)
      : step('needs_attention', `The task has no classification and none is running. ${ASK_USER}`)
  }
  if (classification.outcome !== 'classified') {
    const detail = classification.detail ? ` (${classification.detail})` : ''
    return step(
      'needs_attention',
      `Clef could not classify the task: ${classification.outcome}${detail}. Nothing was routed. ${ASK_USER}`
    )
  }
  if (!route) {
    return step('needs_attention', `The task has no route in the Routing Table. ${ASK_USER}`)
  }
  if (route.status !== 'available' && route.status !== 'not_delegated') {
    const reasons = route.reasons.length > 0 ? ` (${route.reasons.join(', ')})` : ''
    return step(
      'needs_attention',
      `The route for this task is ${route.status}${reasons}. Nothing is substituted. ${ASK_USER}`
    )
  }
  return step('ready', `Start the task with ${commands.start}.`)
}

function attemptStep(snapshot: AutopilotTaskSnapshot, commands: Commands): Step {
  const { attempt } = snapshot
  if (snapshot.status === 'dispatched') {
    if (attempt?.runsIn === 'session') {
      return step(
        'running',
        `The attempt runs in this session. When it is done, send its report on stdin to ${commands.report(attempt.attemptId)}.`
      )
    }
    return step(
      'running',
      `The attempt runs as an app process; its result arrives in the run mailbox. Wait with ${commands.wait}.`,
      true
    )
  }
  if (attempt?.stage === STAGE_VALIDATION_PENDING) {
    return step(
      'validating',
      `The reported result is being validated. Wait with ${commands.wait}.`,
      true
    )
  }
  if (attempt?.stage === STAGE_VALIDATION_INCONCLUSIVE) {
    return step(
      'awaiting_decision',
      'Validation was inconclusive. The user or dot decides; do not start this task again until then.'
    )
  }
  return step('needs_attention', `The task is blocked and nothing is retried. ${ASK_USER}`)
}

function stepFor(snapshot: AutopilotTaskSnapshot, commands: Commands): Step {
  switch (snapshot.status) {
    case 'completed':
      return step('completed', 'The task is completed: its result was validated.')
    case 'failed':
      return step(
        'failed',
        `The task failed. If it is still needed, start a new attempt with ${commands.start}.`
      )
    case 'pending':
      return step(
        'waiting_for_dependencies',
        'The task waits until its dependencies are completed.'
      )
    case 'ready':
      return readyStep(snapshot, commands)
    default:
      return attemptStep(snapshot, commands)
  }
}

/** The primary's view of one task: where it stands, and one English instruction for what comes next. */
export function describeAutopilotTask(
  snapshot: AutopilotTaskSnapshot,
  cliCommand: string
): AutopilotTaskView {
  const { phase, waitable, next } = stepFor(snapshot, commandsFor(cliCommand, snapshot.taskId))
  return {
    taskId: snapshot.taskId,
    runId: snapshot.runId,
    title: snapshot.title,
    status: snapshot.status,
    phase,
    waitable,
    classification: snapshot.classification,
    route: snapshot.route
      ? { ...snapshot.route, delegated: snapshot.route.status !== 'not_delegated' }
      : null,
    attempt: snapshot.attempt,
    validation: snapshot.validation,
    next
  }
}
