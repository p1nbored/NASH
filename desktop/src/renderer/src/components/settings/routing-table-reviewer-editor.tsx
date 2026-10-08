import { translate } from '@/i18n/i18n'
import type { ValidationReviewer } from '../../../../shared/routing-table/routing-table-schema'
import { VALIDATION_REVIEWER_TARGETS } from '../../../../shared/routing-table/routing-table-taxonomy'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import {
  EditActions,
  EffortSelect,
  ModelInput,
  type EditorCallbacks
} from './routing-table-inline-editor'
import { reviewerTargetLabel } from './routing-table-labels'
import { routingCli, routingEffortFor, routingEffortOptions } from './routing-table-effort-options'

export function ReviewerChoiceEditor(
  props: EditorCallbacks & {
    reviewer: ValidationReviewer
    label: string
    onChange: (reviewer: ValidationReviewer) => void
  }
): React.JSX.Element {
  const { reviewer, label, onChange } = props
  const agent = routingCli(reviewer.target)
  const levels = routingEffortOptions(agent, reviewer.model)
  return (
    <div className="space-y-row pt-row">
      <div className="flex flex-wrap items-center gap-row">
        <div className="w-52">
          <Select
            value={reviewer.target}
            onValueChange={(value) => {
              const target = VALIDATION_REVIEWER_TARGETS.find((entry) => entry === value)
              if (target && target !== reviewer.target) {
                onChange({
                  ...reviewer,
                  target,
                  model: '',
                  reasoning_level: routingEffortFor(
                    routingCli(target),
                    '',
                    reviewer.reasoning_level
                  )
                })
              }
            }}
          >
            <SelectTrigger
              size="sm"
              className="w-full"
              aria-label={translate(
                'auto.components.settings.routingTable.inline.agentFor',
                'Agent for {{task}}',
                { task: label }
              )}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VALIDATION_REVIEWER_TARGETS.map((target) => (
                <SelectItem key={target} value={target}>
                  {reviewerTargetLabel(target)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <ModelInput
          value={reviewer.model}
          invalid={props.error !== null}
          label={translate(
            'auto.components.settings.routingTable.inline.modelFor',
            'Model for {{task}}',
            {
              task: label
            }
          )}
          onChange={(model) =>
            onChange({
              ...reviewer,
              model,
              reasoning_level: routingEffortFor(agent, model, reviewer.reasoning_level)
            })
          }
        />
        {levels.length > 0 ? (
          <EffortSelect
            value={reviewer.reasoning_level}
            options={levels}
            label={translate(
              'auto.components.settings.routingTable.inline.effortFor',
              'Effort for {{task}}',
              {
                task: label
              }
            )}
            onChange={(reasoning_level) => onChange({ ...reviewer, reasoning_level })}
          />
        ) : null}
      </div>
      <EditActions {...props} />
    </div>
  )
}
