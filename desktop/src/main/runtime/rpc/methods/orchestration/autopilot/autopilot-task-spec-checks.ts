import {
  AUTOPILOT_TASK_SPEC_MAX_BYTES,
  taskSpecSerializedBytes,
  type AutopilotTaskSpec
} from '../../../../../../shared/rpc-contract/orchestration-autopilot-params'
import type { TaskProposalInput } from '../../../../orchestration/db/task-spec-store'
import { MACHINE_CHECK_KINDS, planValidation } from '../../../../task-validation/validation-policy'
import type { AutopilotPrimaryCaller } from './autopilot-primary-caller'
import { AUTOPILOT_TASK_API_ERROR_CODES, autopilotRefusal } from './autopilot-task-api'
import { checkTaskSpecText } from './autopilot-text-checks'

type TextField = { field: string; text: string }

function listFields(name: string, items: readonly string[] | undefined): TextField[] {
  return (items ?? []).map((text, index) => ({ field: `${name}.${index}`, text }))
}

function textFields(spec: AutopilotTaskSpec): TextField[] {
  return [
    { field: 'objective', text: spec.objective },
    ...(spec.title === undefined ? [] : [{ field: 'title', text: spec.title }]),
    ...listFields('expectedOutputs', spec.expectedOutputs),
    ...listFields('acceptanceCriteria', spec.acceptanceCriteria),
    ...listFields('constraints', spec.constraints)
  ]
}

function specRefusal(field: string, reason: string, message: string): Error {
  return autopilotRefusal(AUTOPILOT_TASK_API_ERROR_CODES.specRefused, message, { field, reason })
}

/** D-027: one technical ceiling on the serialized TaskSpec, against runaway input; no product limits. */
function assertWithinCeiling(spec: AutopilotTaskSpec): void {
  const bytes = taskSpecSerializedBytes(spec)
  if (bytes > AUTOPILOT_TASK_SPEC_MAX_BYTES) {
    throw autopilotRefusal(
      AUTOPILOT_TASK_API_ERROR_CODES.specTooLarge,
      `The TaskSpec is ${bytes} bytes as JSON, over the ${AUTOPILOT_TASK_SPEC_MAX_BYTES}-byte ceiling. Put large context in a workspace file and name its path.`,
      { bytes, maxBytes: AUTOPILOT_TASK_SPEC_MAX_BYTES }
    )
  }
}

/** D-027 restrictions 6 and 8: any language, length and character; only a blank field is refused. */
function assertSpecText(spec: AutopilotTaskSpec): void {
  for (const { field, text } of textFields(spec)) {
    const check = checkTaskSpecText(text)
    if (!check.ok) {
      throw specRefusal(
        field,
        check.reason,
        `The TaskSpec field ${field} is refused: ${check.reason}. Write some text in it or leave it out.`
      )
    }
  }
}

/** A check the validators cannot run would leave the task inconclusive, so it is refused here instead. */
function assertUsableMachineChecks(spec: AutopilotTaskSpec): void {
  const plan = planValidation({ machineChecks: spec.machineChecks ?? [] })
  if (plan.policy !== 'machine_checks') {
    return
  }
  plan.checks.forEach((check, index) => {
    if (check.kind === 'invalid') {
      throw specRefusal(
        `machineChecks.${index}`,
        check.problem,
        `The machine check machineChecks.${index} (${check.specKind}) cannot run: ${check.problem}. Known kinds: ${MACHINE_CHECK_KINDS.join(', ')}.`
      )
    }
  })
}

/** The store's proposal for a TaskSpec the attested primary proposed; Orca assigns the task id. */
export function toTaskProposal(
  spec: AutopilotTaskSpec,
  caller: AutopilotPrimaryCaller,
  timestamp: string
): TaskProposalInput {
  assertWithinCeiling(spec)
  assertSpecText(spec)
  assertUsableMachineChecks(spec)
  return {
    runId: caller.runId,
    objective: spec.objective,
    taskTitle: spec.title ?? null,
    expectedOutputs: spec.expectedOutputs ?? [],
    acceptanceCriteria: spec.acceptanceCriteria ?? [],
    machineChecks: spec.machineChecks ?? [],
    constraints: spec.constraints ?? [],
    accessNeed: spec.accessNeed ?? 'read_only',
    isolationNeed: spec.isolationNeed ?? 'none',
    workflowName: spec.workflowName ?? null,
    deps: spec.deps,
    parentId: spec.parentId ?? null,
    ...(spec.review === undefined ? {} : { review: spec.review }),
    createdBy: {
      terminalHandle: caller.terminalHandle,
      paneKey: caller.paneKey,
      processIncarnation: caller.processIncarnation,
      runGeneration: caller.runGeneration
    },
    timestamp
  }
}
