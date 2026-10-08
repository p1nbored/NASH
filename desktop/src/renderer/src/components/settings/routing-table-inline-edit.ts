import {
  ProposalSubmissionSchema,
  type ProposalChanges,
  type ProposalSubmission
} from '../../../../shared/routing-table/routing-table-proposal-schema'
import { ROUTING_TABLE_SCHEMA_VERSION } from '../../../../shared/routing-table/routing-table-schema'
import {
  INHERITING_TARGETS,
  type ExecutionTarget
} from '../../../../shared/routing-table/routing-table-taxonomy'
import type { EditableRoute, EditorDraft, RouteEdit } from './routing-table-editor-model'
import type { ActiveVersionRef } from './routing-table-import-parse'

const DEFAULT_EFFORT = 'high'
/** The stored reason for a change made in place; English, as the store requires (D-013). */
export const SETTINGS_EDIT_RATIONALE = 'Edited in Settings.'

export type InlineEditKey = EditableRoute['taskType'] | 'coordinator'

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
  return { target }
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
  changes: ProposalChanges,
  activeRef: ActiveVersionRef
): ProposalSubmission | null {
  const parsed = ProposalSubmissionSchema.safeParse({
    schema_version: ROUTING_TABLE_SCHEMA_VERSION,
    proposer: 'user_import',
    base: { table_version: activeRef.version, sha256: activeRef.sha256 },
    ...changes,
    rationale: SETTINGS_EDIT_RATIONALE,
    evidence: []
  })
  return parsed.success ? parsed.data : null
}
