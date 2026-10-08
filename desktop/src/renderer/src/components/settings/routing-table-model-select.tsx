import { createContext, useContext } from 'react'
import { translate } from '@/i18n/i18n'
import type { RoutingModelLists } from '../../../../shared/workbench-routing-table-view'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import type { RoutingCli } from './routing-table-effort-options'

export const EMPTY_ROUTING_MODELS: RoutingModelLists = {
  claude: null,
  codex: null,
  agy: null
}
export const RoutingModelsContext = createContext(EMPTY_ROUTING_MODELS)

export function useRoutingModels(agent: RoutingCli) {
  const lists = useContext(RoutingModelsContext)
  return lists[agent === 'antigravity' ? 'agy' : agent]
}

export function ModelSelect(props: {
  agent: RoutingCli
  value: string
  label: string
  invalid: boolean
  onChange: (value: string) => void
}): React.JSX.Element {
  const models = useRoutingModels(props.agent)
  const selected = models?.find((model) => model.id === props.value)
  return (
    <div className="w-64">
      <Select value={props.value} onValueChange={props.onChange} disabled={!models?.length}>
        <SelectTrigger
          size="sm"
          className="w-full"
          aria-label={props.label}
          aria-invalid={props.invalid || undefined}
        >
          <SelectValue
            placeholder={translate(
              'auto.components.settings.routingTable.models.refreshFirst',
              'Refresh model list to choose'
            )}
          >
            {props.value ? (selected?.label ?? props.value) : undefined}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {models?.map((model) => (
            <SelectItem key={model.id} value={model.id}>
              {model.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
