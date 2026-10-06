import type { CommandHandler, HandlerContext } from '../../dispatch'
import { printResult } from '../../format'
import { getOptionalStringFlag, getRequiredStringFlag } from '../../flags'
import { RuntimeClientError, type RuntimeRpcSuccess } from '../../runtime-client'
import {
  AUTOPILOT_CLI_WAIT_BUDGET_MS,
  AUTOPILOT_REPORT_OUTCOMES,
  AUTOPILOT_WAIT_SLICE_MAX_MS,
  findRefusedTaskSpecKeys
} from '../../../shared/rpc-contract/orchestration-autopilot-params'
import {
  RunCompleteResultSchema,
  TaskProposeResultSchema,
  TaskReportResultSchema,
  TaskShowResultSchema,
  TaskStartResultSchema
} from '../../../shared/rpc-contract/orchestration-autopilot-views'
import { readAutopilotInput, type AutopilotInputKind } from './autopilot-cli-input'
import {
  formatRunComplete,
  formatTaskStart,
  formatTaskView,
  type PrintableTask
} from './autopilot-format'
import { callOrchestrationMutation } from './mutation-request'

/** The two RPC shapes the commands need: a durable mutation, and a read with its own timeout. */
export type AutopilotCliRpc = {
  mutate(method: string, params: unknown): Promise<RuntimeRpcSuccess<unknown>>
  read(method: string, params: unknown, timeoutMs: number): Promise<RuntimeRpcSuccess<unknown>>
}

export type AutopilotCliIo = {
  readInput(path: string, kind: AutopilotInputKind): Promise<string>
  print<T>(response: RuntimeRpcSuccess<T>, format: (result: T) => string): void
  now(): number
}

/** Client-side margin over a server wait, so the socket never times out before the server answers. */
const CALL_GRACE_MS = 5_000
const MIN_SLICE_MS = 1_000
const READ_TIMEOUT_MS = 30_000

function invalid(message: string): RuntimeClientError {
  return new RuntimeClientError('invalid_argument', message)
}

function parseSpecDocument(text: string): unknown {
  let spec: unknown
  try {
    spec = JSON.parse(text)
  } catch {
    throw invalid('The TaskSpec is not valid JSON.')
  }
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
    throw invalid('The TaskSpec must be one JSON object.')
  }
  const refused = findRefusedTaskSpecKeys(spec)
  if (refused.length > 0) {
    throw invalid(
      `The TaskSpec names ${refused.join(', ')}. Remove them: Clef classifies the task and the Routing Table selects who runs it.`
    )
  }
  return spec
}

// Why: a heredoc or a Windows file can end in CRLF and trailing blank lines; the app refuses CR.
function summaryText(raw: string): string {
  const text = raw.replace(/\r\n/g, '\n').replace(/\s+$/u, '')
  if (text === '') {
    throw invalid('The summary is empty.')
  }
  return text
}

/** Re-reads the task in slices of at most 20 s until it leaves a waiting phase or the budget ends. */
async function waitForTask(
  rpc: AutopilotCliRpc,
  io: AutopilotCliIo,
  taskId: string,
  deadline: number
): Promise<RuntimeRpcSuccess<PrintableTask>> {
  for (;;) {
    const remaining = deadline - io.now()
    const waitMs = Math.max(0, Math.min(AUTOPILOT_WAIT_SLICE_MAX_MS, remaining))
    const params = waitMs >= MIN_SLICE_MS ? { taskId, waitMs } : { taskId }
    const response = await rpc.read('orchestration.taskShow', params, waitMs + CALL_GRACE_MS)
    const result = TaskShowResultSchema.parse(response.result)
    if (!result.task.waitable || deadline - io.now() < MIN_SLICE_MS) {
      return { ...response, result }
    }
  }
}

export async function runTaskPropose(
  rpc: AutopilotCliRpc,
  io: AutopilotCliIo,
  args: { specFile: string }
): Promise<void> {
  const deadline = io.now() + AUTOPILOT_CLI_WAIT_BUDGET_MS
  const spec = parseSpecDocument(await io.readInput(args.specFile, 'spec'))
  const proposed = await rpc.mutate('orchestration.taskPropose', { spec })
  const result = TaskProposeResultSchema.parse(proposed.result)
  const final = result.task.waitable
    ? await waitForTask(rpc, io, result.task.taskId, deadline)
    : { ...proposed, result }
  io.print(final, formatTaskView)
}

export async function runTaskStart(
  rpc: AutopilotCliRpc,
  io: AutopilotCliIo,
  args: { taskId: string }
): Promise<void> {
  const response = await rpc.mutate('orchestration.taskStart', { taskId: args.taskId })
  io.print({ ...response, result: TaskStartResultSchema.parse(response.result) }, formatTaskStart)
}

export async function runTaskShow(
  rpc: AutopilotCliRpc,
  io: AutopilotCliIo,
  args: { taskId: string; wait: boolean }
): Promise<void> {
  if (args.wait) {
    io.print(
      await waitForTask(rpc, io, args.taskId, io.now() + AUTOPILOT_CLI_WAIT_BUDGET_MS),
      formatTaskView
    )
    return
  }
  const response = await rpc.read(
    'orchestration.taskShow',
    { taskId: args.taskId },
    READ_TIMEOUT_MS
  )
  io.print({ ...response, result: TaskShowResultSchema.parse(response.result) }, formatTaskView)
}

export async function runTaskReport(
  rpc: AutopilotCliRpc,
  io: AutopilotCliIo,
  args: { taskId: string; attemptId: string; outcome?: string; summaryFile: string }
): Promise<void> {
  const outcome = args.outcome ?? 'succeeded'
  if (!AUTOPILOT_REPORT_OUTCOMES.some((known) => known === outcome)) {
    throw invalid(`--outcome must be succeeded or failed, not ${outcome}.`)
  }
  const summary = summaryText(await io.readInput(args.summaryFile, 'summary'))
  const response = await rpc.mutate('orchestration.taskReport', {
    taskId: args.taskId,
    attemptId: args.attemptId,
    outcome,
    summary
  })
  io.print({ ...response, result: TaskReportResultSchema.parse(response.result) }, formatTaskView)
}

export async function runRunComplete(
  rpc: AutopilotCliRpc,
  io: AutopilotCliIo,
  args: { summaryFile: string }
): Promise<void> {
  const summary = summaryText(await io.readInput(args.summaryFile, 'summary'))
  const response = await rpc.mutate('orchestration.runComplete', { summary })
  io.print(
    { ...response, result: RunCompleteResultSchema.parse(response.result) },
    formatRunComplete
  )
}

function cliRpc(context: HandlerContext): AutopilotCliRpc {
  return {
    mutate: (method, params) =>
      callOrchestrationMutation<unknown>(context.client, context.flags, method, params),
    read: (method, params, timeoutMs) => context.client.call<unknown>(method, params, { timeoutMs })
  }
}

function cliIo(context: HandlerContext): AutopilotCliIo {
  const source = {
    cwd: context.cwd,
    stdin: process.stdin,
    stdinIsTty: process.stdin.isTTY === true
  }
  return {
    readInput: (path, kind) => readAutopilotInput(path, kind, source),
    print: (response, format) => printResult(response, context.json, format),
    now: () => Date.now()
  }
}

export const ORCHESTRATION_AUTOPILOT_HANDLERS: Record<string, CommandHandler> = {
  'orchestration task-propose': (context) =>
    runTaskPropose(cliRpc(context), cliIo(context), {
      specFile: getRequiredStringFlag(context.flags, 'spec-file')
    }),
  'orchestration task-start': (context) =>
    runTaskStart(cliRpc(context), cliIo(context), {
      taskId: getRequiredStringFlag(context.flags, 'task')
    }),
  'orchestration task-show': (context) =>
    runTaskShow(cliRpc(context), cliIo(context), {
      taskId: getRequiredStringFlag(context.flags, 'task'),
      wait: context.flags.has('wait')
    }),
  'orchestration task-report': (context) =>
    runTaskReport(cliRpc(context), cliIo(context), {
      taskId: getRequiredStringFlag(context.flags, 'task'),
      attemptId: getRequiredStringFlag(context.flags, 'attempt'),
      outcome: getOptionalStringFlag(context.flags, 'outcome'),
      summaryFile: getRequiredStringFlag(context.flags, 'summary-file')
    }),
  'orchestration run-complete': (context) =>
    runRunComplete(cliRpc(context), cliIo(context), {
      summaryFile: getRequiredStringFlag(context.flags, 'summary-file')
    })
}
