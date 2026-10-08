import {
  RoutingTableEditSchema,
  type RoutingTableChanges,
  type RoutingTableEdit
} from '../../../../shared/routing-table/routing-table-edit-schema'
import {
  INHERITING_TARGETS,
  type ExecutionTarget
} from '../../../../shared/routing-table/routing-table-taxonomy'
import type { EditableRoute, EditorDraft, RouteEdit } from './routing-table-editor-model'
import { routingCli, routingEffortFor } from './routing-table-effort-options'

type ActiveVersionRef = { readonly version: number; readonly sha256: string }

const DEFAULT_EFFORT = 'high'

export type InlineEditKey = EditableRoute['taskType'] | 'coordinator' | number

export function canInherit(target: ExecutionTarget): boolean {
  return INHERITING_TARGETS.includes(target)
}

export function usesCoordinator(row: Pick<EditableRoute, 'model' | 'reasoningLevel'>): boolean {
  return row.model === 'inherit' && row.reasoningLevel === 'inherit'
}

/**
 * A new agent for a row. The primary session always runs with the coordinator's settings; an agent
 * that cannot share them starts with an empty model, so the user picks one on purpose.
 */
export function editForTarget(row: EditableRoute, target: ExecutionTarget): RouteEdit {
  if (target === 'claude_primary') {
    return { target, model: 'inherit', reasoningLevel: 'inherit', requirement: 'required' }
  }
  const inherits = row.model === 'inherit' || row.reasoningLevel === 'inherit'
  if (inherits && !canInherit(target)) {
    return { target, model: '', reasoningLevel: DEFAULT_EFFORT, requirement: 'required' }
  }
  return {
    target,
    reasoningLevel: routingEffortFor(routingCli(target), row.model, row.reasoningLevel)
  }
}

/** "Same as coordinator" on or off; off starts from the coordinator's own model and effort. */
export function editForSameAsCoordinator(
  same: boolean,
  coordinator: EditorDraft['coordinator']
): RouteEdit {
  return same
    ? { model: 'inherit', reasoningLevel: 'inherit', requirement: 'required' }
    : { model: coordinator.model, reasoningLevel: coordinator.reasoningLevel }
}

/** The in-place edit as the user's own change set, based on the version shown. */
export function settingsEditSubmission(
  changes: RoutingTableChanges,
  activeRef: ActiveVersionRef
): RoutingTableEdit | null {
  const parsed = RoutingTableEditSchema.safeParse({
    base: { table_version: activeRef.version, sha256: activeRef.sha256 },
    ...changes
  })
  return parsed.success ? parsed.data : null
}
