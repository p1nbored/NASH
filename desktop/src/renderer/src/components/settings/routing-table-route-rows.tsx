import { translate } from '@/i18n/i18n'
import {
  CONCRETE_REASONING_LEVELS,
  EXECUTION_TARGETS,
  REASONING_LEVELS,
  REASONING_REQUIREMENTS,
  type RoutingTaskType
} from '../../../../shared/routing-table/routing-table-taxonomy'
import { Input } from '../ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import type {
  DraftError,
  EditableRoute,
  EditorDraft,
  RouteEdit
} from './routing-table-editor-model'
import { executionTargetLabel, reasoningLevelLabel, taskTypeLabel } from './routing-table-labels'

function pick<T extends string>(options: readonly T[], value: string): T | undefined {
  return options.find((option) => option === value)
}

function requirementLabel(requirement: EditableRoute['requirement']): string {
  return requirement === 'if_supported'
    ? translate('auto.components.settings.routingTable.editor.whenSupported', 'When supported')
    : translate('auto.components.settings.routingTable.editor.required', 'Required')
}

function RouteEditorRow(props: {
  row: EditableRoute
  error: string | null
  onEdit: (taskType: RoutingTaskType, edit: RouteEdit) => void
}): React.JSX.Element {
  const { row, error, onEdit } = props
  const label = taskTypeLabel(row.taskType)
  return (
    <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1.3fr)_minmax(0,1.2fr)_minmax(0,0.75fr)_minmax(0,1.05fr)] items-start gap-2">
      <span className="pt-1.5 text-meta text-foreground">{label}</span>
      <Select
        value={row.target}
        onValueChange={(value) => {
          const target = pick(EXECUTION_TARGETS, value)
          if (target) {
            onEdit(row.taskType, { target })
          }
        }}
      >
        <SelectTrigger
          size="sm"
          className="w-full"
          aria-label={translate(
            'auto.components.settings.routingTable.editor.agentFor',
            'Agent for {{task}}',
            { task: label }
          )}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {EXECUTION_TARGETS.map((target) => (
            <SelectItem key={target} value={target}>
              {executionTargetLabel(target)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        value={row.model}
        spellCheck={false}
        autoComplete="off"
        aria-invalid={error === null ? undefined : true}
        aria-label={translate(
          'auto.components.settings.routingTable.editor.modelFor',
          'Model for {{task}}',
          { task: label }
        )}
        className="h-8"
        onChange={(event) => onEdit(row.taskType, { model: event.target.value })}
      />
      <Select
        value={row.reasoningLevel}
        onValueChange={(value) => {
          const reasoningLevel = pick(REASONING_LEVELS, value)
          if (reasoningLevel) {
            onEdit(row.taskType, { reasoningLevel })
          }
        }}
      >
        <SelectTrigger
          size="sm"
          className="w-full"
          aria-label={translate(
            'auto.components.settings.routingTable.editor.effortFor',
            'Effort for {{task}}',
            { task: label }
          )}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {REASONING_LEVELS.map((level) => (
            <SelectItem key={level} value={level}>
              {reasoningLevelLabel(level)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={row.requirement}
        onValueChange={(value) => {
          const requirement = pick(REASONING_REQUIREMENTS, value)
          if (requirement) {
            onEdit(row.taskType, { requirement })
          }
        }}
      >
        <SelectTrigger
          size="sm"
          className="w-full"
          aria-label={translate(
            'auto.components.settings.routingTable.editor.effortRequirementFor',
            'Effort requirement for {{task}}',
            {
              task: label
            }
          )}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {REASONING_REQUIREMENTS.map((requirement) => (
            <SelectItem key={requirement} value={requirement}>
              {requirementLabel(requirement)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function CoordinatorRow(props: {
  draft: EditorDraft
  invalid: boolean
  onChange: (coordinator: EditorDraft['coordinator']) => void
}): React.JSX.Element {
  const { coordinator } = props.draft
  const label = translate('auto.components.settings.routingTable.editor.coordinator', 'Coordinator')
  return (
    <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,2.5fr)_minmax(0,1.8fr)] items-start gap-2">
      <span className="pt-1.5 text-meta font-medium text-foreground">{label}</span>
      <Input
        value={coordinator.model}
        spellCheck={false}
        autoComplete="off"
        aria-invalid={props.invalid ? true : undefined}
        aria-label={translate(
          'auto.components.settings.routingTable.editor.coordinatorModel',
          'Coordinator model'
        )}
        className="h-8"
        onChange={(event) => props.onChange({ ...coordinator, model: event.target.value })}
      />
      <Select
        value={coordinator.reasoningLevel}
        onValueChange={(value) => {
          const reasoningLevel = pick(CONCRETE_REASONING_LEVELS, value)
          if (reasoningLevel) {
            props.onChange({ ...coordinator, reasoningLevel })
          }
        }}
      >
        <SelectTrigger
          size="sm"
          className="w-full"
          aria-label={translate(
            'auto.components.settings.routingTable.inline.coordinatorEffort',
            'Coordinator effort'
          )}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {CONCRETE_REASONING_LEVELS.map((level) => (
            <SelectItem key={level} value={level}>
              {reasoningLevelLabel(level)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

/** Every row of the table as editable controls; errors mark the field and are listed by the dialog. */
export function RoutingTableRouteRows(props: {
  draft: EditorDraft
  errors: readonly DraftError[]
  onDraftChange: (draft: EditorDraft) => void
  onRouteEdit: (taskType: RoutingTaskType, edit: RouteEdit) => void
}): React.JSX.Element {
  const errorFor = (field: DraftError['field']): string | null =>
    props.errors.find((error) => error.field === field)?.message ?? null
  return (
    <div className="space-y-2">
      <CoordinatorRow
        draft={props.draft}
        invalid={errorFor('coordinator') !== null}
        onChange={(coordinator) => props.onDraftChange({ ...props.draft, coordinator })}
      />
      <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1.3fr)_minmax(0,1.2fr)_minmax(0,0.75fr)_minmax(0,1.05fr)] gap-2 border-t border-border/60 pt-2 text-caption text-muted-foreground">
        <span>
          {translate('auto.components.settings.routingTable.editor.taskType', 'Task type')}
        </span>
        <span>{translate('auto.components.settings.routingTable.editor.agent', 'Agent')}</span>
        <span>{translate('auto.components.settings.routingTable.editor.model', 'Model')}</span>
        <span>{translate('auto.components.settings.routingTable.editor.effort', 'Effort')}</span>
        <span>
          {translate('auto.components.settings.routingTable.editor.requirement', 'Requirement')}
        </span>
      </div>
      {props.draft.routes.map((row) => (
        <RouteEditorRow
          key={row.taskType}
          row={row}
          error={errorFor(row.taskType)}
          onEdit={props.onRouteEdit}
        />
      ))}
    </div>
  )
}
