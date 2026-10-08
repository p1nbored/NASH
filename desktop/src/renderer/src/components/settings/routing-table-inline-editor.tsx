import { useId } from 'react'
import { translate } from '@/i18n/i18n'
import {
  CONCRETE_REASONING_LEVELS,
  EXECUTION_TARGETS,
  REASONING_LEVELS
} from '../../../../shared/routing-table/routing-table-taxonomy'
import { Button } from '../ui/button'
import { Checkbox } from '../ui/checkbox'
import { Input } from '../ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import type { EditableRoute, EditorDraft, RouteEdit } from './routing-table-editor-model'
import {
  canInherit,
  editForSameAsCoordinator,
  editForTarget,
  usesCoordinator
} from './routing-table-inline-edit'
import { executionTargetLabel, reasoningLevelLabel } from './routing-table-labels'

function pick<T extends string>(options: readonly T[], value: string): T | undefined {
  return options.find((option) => option === value)
}

type EffortLevel = (typeof REASONING_LEVELS)[number]

function EffortSelect<T extends EffortLevel>(props: {
  value: T
  options: readonly T[]
  label: string
  onChange: (value: T) => void
}): React.JSX.Element {
  return (
    <div className="w-36">
      <Select
        value={props.value}
        onValueChange={(value) => {
          const level = pick(props.options, value)
          if (level) {
            props.onChange(level)
          }
        }}
      >
        <SelectTrigger size="sm" className="w-full" aria-label={props.label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {props.options.map((level) => (
            <SelectItem key={level} value={level}>
              {reasoningLevelLabel(level)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function ModelInput(props: {
  value: string
  label: string
  invalid: boolean
  onChange: (value: string) => void
}): React.JSX.Element {
  return (
    <div className="w-48">
      <Input
        value={props.value}
        spellCheck={false}
        autoComplete="off"
        aria-invalid={props.invalid ? true : undefined}
        aria-label={props.label}
        className="h-8"
        onChange={(event) => props.onChange(event.target.value)}
      />
    </div>
  )
}

function CheckboxField(props: {
  checked: boolean
  disabled?: boolean
  label: string
  onChange: (checked: boolean) => void
}): React.JSX.Element {
  const id = useId()
  return (
    <div className="flex items-center gap-1.5">
      <Checkbox
        id={id}
        checked={props.checked}
        disabled={props.disabled}
        onCheckedChange={(checked) => props.onChange(checked === true)}
      />
      <label htmlFor={id} className="text-meta text-foreground">
        {props.label}
      </label>
    </div>
  )
}

function EditActions(props: {
  busy: boolean
  error: string | null
  onSave: () => void
  onCancel: () => void
}): React.JSX.Element {
  return (
    <>
      <div className="flex items-center gap-row">
        <Button size="sm" disabled={props.busy} onClick={props.onSave}>
          {translate('auto.components.settings.routingTable.inline.save', 'Save')}
        </Button>
        <Button size="sm" variant="ghost" onClick={props.onCancel}>
          {translate('auto.components.settings.routingTable.inline.cancel', 'Cancel')}
        </Button>
      </div>
      {props.error === null ? null : (
        <p role="alert" className="text-meta text-destructive">
          {props.error}
        </p>
      )}
    </>
  )
}

type EditorCallbacks = {
  busy: boolean
  error: string | null
  onSave: () => void
  onCancel: () => void
}

/** One task's agent, model and effort as controls, edited where the row stands. */
export function RouteChoiceEditor(
  props: EditorCallbacks & {
    row: EditableRoute
    taskLabel: string
    coordinator: EditorDraft['coordinator']
    onEdit: (edit: RouteEdit) => void
  }
): React.JSX.Element {
  const { row, taskLabel } = props
  const same = usesCoordinator(row)
  const levels = canInherit(row.target) ? REASONING_LEVELS : CONCRETE_REASONING_LEVELS
  return (
    <div className="space-y-row pt-row">
      <div className="flex flex-wrap items-center gap-row">
        <div className="w-52">
          <Select
            value={row.target}
            onValueChange={(value) => {
              const target = pick(EXECUTION_TARGETS, value)
              if (target) {
                props.onEdit(editForTarget(row, target))
              }
            }}
          >
            <SelectTrigger
              size="sm"
              className="w-full"
              aria-label={translate(
                'auto.components.settings.routingTable.inline.agentFor',
                'Agent for {{task}}',
                { task: taskLabel }
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
        </div>
        {canInherit(row.target) ? (
          <CheckboxField
            checked={same}
            disabled={row.target === 'claude_primary'}
            label={translate(
              'auto.components.settings.routingTable.labels.sameAsCoordinator',
              'Same as coordinator'
            )}
            onChange={(checked) =>
              props.onEdit(editForSameAsCoordinator(checked, props.coordinator))
            }
          />
        ) : null}
        {same ? null : (
          <>
            <ModelInput
              value={row.model}
              invalid={props.error !== null}
              label={translate(
                'auto.components.settings.routingTable.inline.modelFor',
                'Model for {{task}}',
                { task: taskLabel }
              )}
              onChange={(model) => props.onEdit({ model })}
            />
            <EffortSelect
              value={row.reasoningLevel}
              options={levels}
              label={translate(
                'auto.components.settings.routingTable.inline.effortFor',
                'Effort for {{task}}',
                { task: taskLabel }
              )}
              onChange={(reasoningLevel) => props.onEdit({ reasoningLevel })}
            />
            <CheckboxField
              checked={row.requirement === 'if_supported'}
              disabled={row.reasoningLevel === 'inherit'}
              label={translate(
                'auto.components.settings.routingTable.inline.onlyIfSupported',
                'Only if the model supports it'
              )}
              onChange={(checked) =>
                props.onEdit({ requirement: checked ? 'if_supported' : 'required' })
              }
            />
          </>
        )}
      </div>
      <EditActions
        busy={props.busy}
        error={props.error}
        onSave={props.onSave}
        onCancel={props.onCancel}
      />
    </div>
  )
}

/** The coordinator's model and effort; it always runs in the Claude primary session. */
export function CoordinatorChoiceEditor(
  props: EditorCallbacks & {
    coordinator: EditorDraft['coordinator']
    onChange: (coordinator: EditorDraft['coordinator']) => void
  }
): React.JSX.Element {
  const { coordinator } = props
  return (
    <div className="space-y-row pt-row">
      <div className="flex flex-wrap items-center gap-row">
        <ModelInput
          value={coordinator.model}
          invalid={props.error !== null}
          label={translate(
            'auto.components.settings.routingTable.editor.coordinatorModel',
            'Coordinator model'
          )}
          onChange={(model) => props.onChange({ ...coordinator, model })}
        />
        <EffortSelect
          value={coordinator.reasoningLevel}
          options={CONCRETE_REASONING_LEVELS}
          label={translate(
            'auto.components.settings.routingTable.inline.coordinatorEffort',
            'Coordinator effort'
          )}
          onChange={(reasoningLevel) => props.onChange({ ...coordinator, reasoningLevel })}
        />
      </div>
      <EditActions
        busy={props.busy}
        error={props.error}
        onSave={props.onSave}
        onCancel={props.onCancel}
      />
    </div>
  )
}
