import { translate } from '@/i18n/i18n'
import { modelPinViolation } from '../../../../shared/routing-table/model-pin-policy'
import type { ProposalChanges } from '../../../../shared/routing-table/routing-table-proposal-schema'
import {
  CoordinatorSchema,
  RouteSchema,
  type Route,
  type RoutingTable,
  type ValidationPolicy
} from '../../../../shared/routing-table/routing-table-schema'
import type {
  ConcreteReasoningLevel,
  ExecutionTarget,
  RoutingTaskType
} from '../../../../shared/routing-table/routing-table-taxonomy'
import { activeRoute, samePolicy, type TableChangeSet } from './routing-table-diff'

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
  readonly coordinator: { readonly model: string; readonly reasoningLevel: ConcreteReasoningLevel }
  readonly routes: readonly EditableRoute[]
  /** A proposed reviewer list, carried through unchanged; reviewers are not edited here. */
  readonly validation?: ValidationPolicy
}

export type DraftError = {
  readonly field: RoutingTaskType | 'coordinator' | 'table'
  readonly message: string
}
export type DraftResult =
  | { readonly ok: true; readonly changes: ProposalChanges }
  | { readonly ok: false; readonly errors: readonly DraftError[] }

export type RouteEdit = Partial<
  Pick<EditableRoute, 'target' | 'model' | 'reasoningLevel' | 'requirement'>
>

/** The active table with a proposal's replacements applied, as editable rows. */
export function draftFromTable(table: RoutingTable, change?: TableChangeSet): EditorDraft {
  const coordinator = change?.coordinator ?? table.coordinator
  return {
    coordinator: { model: coordinator.model, reasoningLevel: coordinator.reasoning_level },
    routes: table.routes.map((active) => {
      const route = change?.changes.find((row) => row.task_type === active.task_type) ?? active
      return {
        taskType: route.task_type,
        target: route.execution_target,
        model: route.model,
        reasoningLevel: route.reasoning_level,
        requirement: route.reasoning_requirement,
        original: route
      }
    }),
    ...(change?.validation ? { validation: change.validation } : {})
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
    case 'model_family_excluded':
      return translate(
        'auto.components.settings.routingTable.editor.geminiExcluded',
        'Gemini 4 models are excluded from routing.'
      )
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
        'Enter an exact model ID, such as claude-sonnet-5-5.'
      )
  }
}

function ruleMessage(message: string): string {
  switch (message) {
    case 'Only claude_primary and claude_workflow may inherit':
      return translate(
        'auto.components.settings.routingTable.editor.onlyPrimaryInherits',
        'Only the Claude primary session and Claude workflows can inherit the coordinator settings.'
      )
    case 'claude_primary uses the coordinator configuration':
      return translate(
        'auto.components.settings.routingTable.editor.primaryInherits',
        'The Claude primary session always uses the coordinator settings: set model and reasoning to Inherit.'
      )
    case 'coordinator_reasoning stays in the primary session':
      return translate(
        'auto.components.settings.routingTable.editor.coordinatorStays',
        'Coordinator reasoning always stays in the Claude primary session.'
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
    const current = activeRoute(active, row.taskType)
    if (current === null || !sameContent(current, parsed.data)) {
      changes.push(parsed.data)
    }
  }
  const coordinator = CoordinatorSchema.safeParse({
    model: draft.coordinator.model.trim(),
    reasoning_level: draft.coordinator.reasoningLevel
  })
  if (!coordinator.success) {
    errors.push({ field: 'coordinator', message: modelProblemMessage(draft.coordinator.model) })
  }
  if (errors.length > 0 || !coordinator.success) {
    return { ok: false, errors }
  }
  const coordinatorChanged =
    coordinator.data.model !== active.coordinator.model ||
    coordinator.data.reasoning_level !== active.coordinator.reasoning_level
  if (changes.length === 0 && !coordinatorChanged && draft.validation === undefined) {
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
      ...(draft.validation ? { validation: draft.validation } : {}),
      changes
    }
  }
}
