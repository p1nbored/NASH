import { translate } from '@/i18n/i18n'
import { modelPinViolation } from '../../../../shared/routing-table/model-pin-policy'
import type { RoutingTableChanges } from '../../../../shared/routing-table/routing-table-edit-schema'
import {
  CoordinatorSchema,
  RouteSchema,
  ValidationPolicySchema,
  type Coordinator,
  type Route,
  type RoutingTable,
  type ValidationPolicy
} from '../../../../shared/routing-table/routing-table-schema'
import type {
  ConcreteReasoningLevel,
  ExecutionTarget,
  RoutingTaskType
} from '../../../../shared/routing-table/routing-table-taxonomy'
import { routingEffortFor } from './routing-table-effort-options'

export type EditableRoute = {
  readonly taskType: RoutingTaskType
  readonly target: ExecutionTarget
  readonly model: string
  readonly reasoningLevel: Route['reasoning_level']
  readonly requirement: Route['reasoning_requirement']
  /** The row as proposed or active; sent unchanged when its policy is not edited. */
  readonly original: Route
}

export type EditorDraft = {
  readonly coordinator: {
    readonly agent: Coordinator['agent']
    readonly model: string
    readonly reasoningLevel: ConcreteReasoningLevel
  }
  readonly routes: readonly EditableRoute[]
  readonly validation: ValidationPolicy
}

export type DraftError = {
  /** A numeric field identifies a reviewer by its position in the ordered policy. */
  readonly field: RoutingTaskType | 'coordinator' | 'table' | 'validation' | number
  readonly message: string
}
export type DraftResult =
  | { readonly ok: true; readonly changes: RoutingTableChanges }
  | { readonly ok: false; readonly errors: readonly DraftError[] }

export type RouteEdit = Partial<
  Pick<EditableRoute, 'target' | 'model' | 'reasoningLevel' | 'requirement'>
>

/** The active table as editable rows. */
export function draftFromTable(table: RoutingTable): EditorDraft {
  const coordinator = table.coordinator
  return {
    coordinator: {
      agent: coordinator.agent,
      model: coordinator.model,
      reasoningLevel: coordinator.reasoning_level
    },
    routes: table.routes.map((route) => {
      return {
        taskType: route.task_type,
        target: route.execution_target,
        model: route.model,
        reasoningLevel: route.reasoning_level,
        requirement: route.reasoning_requirement,
        original: route
      }
    }),
    validation: table.validation
  }
}

/** Switching CLIs requires an explicit model choice for the new CLI. */
export function withCoordinatorAgent(
  coordinator: EditorDraft['coordinator'],
  agent: Coordinator['agent']
): EditorDraft['coordinator'] {
  return agent === coordinator.agent
    ? coordinator
    : {
        ...coordinator,
        agent,
        model: '',
        reasoningLevel: routingEffortFor(agent, '', coordinator.reasoningLevel)
      }
}

export function withRouteEdit(
  draft: EditorDraft,
  taskType: RoutingTaskType,
  edit: RouteEdit
): EditorDraft {
  return {
    ...draft,
    routes: draft.routes.map((row) => (row.taskType === taskType ? { ...row, ...edit } : row))
  }
}

export function modelProblemMessage(model: string): string {
  switch (modelPinViolation(model)) {
    case 'model_alias_unpinned':
      return translate(
        'auto.components.settings.routingTable.editor.aliasUnpinned',
        'Enter an exact model ID, not an alias such as opus or latest.'
      )
    case 'model_slug_rejected':
      return translate(
        'auto.components.settings.routingTable.editor.slugRejected',
        'This model ID is retired or rejected. Enter another exact model ID.'
      )
    case 'model_unapproved':
    case null:
      return translate(
        'auto.components.settings.routingTable.editor.modelInvalid',
        'Enter an exact model ID for the selected CLI.'
      )
  }
}

function ruleMessage(message: string): string {
  switch (message) {
    case 'Only claude_primary and claude_workflow may inherit':
      return translate(
        'auto.components.settings.routingTable.editor.onlyPrimaryInherits',
        'Only the coordinator session and Claude workflows can inherit the coordinator settings.'
      )
    case 'claude_primary uses the coordinator configuration':
      return translate(
        'auto.components.settings.routingTable.editor.primaryInherits',
        'The coordinator session always uses the coordinator settings: set model and reasoning to Inherit.'
      )
    case 'coordinator_reasoning stays in the primary session':
      return translate(
        'auto.components.settings.routingTable.editor.coordinatorStays',
        'Coordinator reasoning always stays in the coordinator session.'
      )
    case 'if_supported needs a concrete level':
      return translate(
        'auto.components.settings.routingTable.editor.ifSupportedConcrete',
        '"When supported" needs a concrete reasoning level, not Inherit.'
      )
    default:
      return translate(
        'auto.components.settings.routingTable.editor.rowInvalid',
        'This row is not valid. Check its target, model and reasoning level.'
      )
  }
}

function samePolicy(a: Route, b: Route): boolean {
  return (
    a.execution_target === b.execution_target &&
    a.model === b.model &&
    a.reasoning_level === b.reasoning_level &&
    a.reasoning_requirement === b.reasoning_requirement
  )
}

function sameContent(a: Route, b: Route): boolean {
  return (
    samePolicy(a, b) &&
    a.notes === b.notes &&
    a.benchmark_snapshot_date === b.benchmark_snapshot_date &&
    JSON.stringify(a.benchmark_sources ?? null) === JSON.stringify(b.benchmark_sources ?? null)
  )
}

function emittedRoute(row: EditableRoute): Route | Record<string, unknown> {
  const policy = {
    task_type: row.taskType,
    execution_target: row.target,
    model: row.model.trim(),
    reasoning_level: row.reasoningLevel,
    reasoning_requirement: row.requirement
  }
  // Why bare: notes and benchmark sources described the replaced choice, not the user's own.
  return samePolicy(row.original, { ...row.original, ...policy }) ? row.original : policy
}

/** The change set the draft makes against the active table, or why it cannot be sent. */
export function changesFromDraft(active: RoutingTable, draft: EditorDraft): DraftResult {
  const errors: DraftError[] = []
  const changes: Route[] = []
  for (const row of draft.routes) {
    const parsed = RouteSchema.safeParse(emittedRoute(row))
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      const message =
        issue?.path[0] === 'model'
          ? modelProblemMessage(row.model)
          : ruleMessage(issue?.message ?? '')
      errors.push({ field: row.taskType, message })
      continue
    }
    const current = active.routes.find((route) => route.task_type === row.taskType)
    if (current === undefined || !sameContent(current, parsed.data)) {
      changes.push(parsed.data)
    }
  }
  const coordinator = CoordinatorSchema.safeParse({
    agent: draft.coordinator.agent,
    model: draft.coordinator.model.trim(),
    reasoning_level: draft.coordinator.reasoningLevel
  })
  if (!coordinator.success) {
    errors.push({ field: 'coordinator', message: modelProblemMessage(draft.coordinator.model) })
  }
  const validation = ValidationPolicySchema.safeParse({
    ...draft.validation,
    reviewers: draft.validation.reviewers.map((reviewer) => ({
      ...reviewer,
      model: reviewer.model.trim()
    }))
  })
  if (!validation.success) {
    for (const issue of validation.error.issues) {
      const index = issue.path[1]
      errors.push({
        field: typeof index === 'number' ? index : 'validation',
        message:
          typeof index === 'number' && issue.path[2] === 'model'
            ? modelProblemMessage(draft.validation.reviewers[index]?.model ?? '')
            : ruleMessage(issue.message)
      })
    }
  }
  if (errors.length > 0 || !coordinator.success || !validation.success) {
    return { ok: false, errors }
  }
  const coordinatorChanged =
    coordinator.data.agent !== active.coordinator.agent ||
    coordinator.data.model !== active.coordinator.model ||
    coordinator.data.reasoning_level !== active.coordinator.reasoning_level
  const validationChanged =
    validation.data.notes !== active.validation.notes ||
    JSON.stringify(validation.data.reviewers) !== JSON.stringify(active.validation.reviewers)
  if (changes.length === 0 && !coordinatorChanged && !validationChanged) {
    return {
      ok: false,
      errors: [
        {
          field: 'table',
          message: translate(
            'auto.components.settings.routingTable.editor.nothingChanged',
            'This leaves the active table unchanged. Edit at least one route first.'
          )
        }
      ]
    }
  }
  return {
    ok: true,
    changes: {
      ...(coordinatorChanged ? { coordinator: coordinator.data } : {}),
      ...(validationChanged ? { validation: validation.data } : {}),
      changes
    }
  }
}
