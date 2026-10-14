import { translate } from '@/i18n/i18n'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { withCoordinatorAgent, type EditorDraft } from './routing-table-editor-model'
import { primaryAgentLabel } from './routing-table-labels'
import {
  isRoutingAgent,
  ROUTING_AGENTS
} from '../../../../shared/routing-table/routing-cli-registry'

export function PrimaryCliSelect(props: {
  coordinator: EditorDraft['coordinator']
  onChange: (coordinator: EditorDraft['coordinator']) => void
}): React.JSX.Element {
  return (
    <Select
      value={props.coordinator.agent}
      onValueChange={(agent) => {
        if (isRoutingAgent(agent)) {
          props.onChange(withCoordinatorAgent(props.coordinator, agent))
        }
      }}
    >
      <SelectTrigger
        size="sm"
        className="w-36"
        aria-label={translate(
          'auto.components.settings.routingTable.editor.primaryCli',
          'Coordinator CLI'
        )}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ROUTING_AGENTS.map((agent) => (
          <SelectItem key={agent} value={agent}>
            {primaryAgentLabel(agent)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
