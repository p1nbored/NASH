import { translate } from '@/i18n/i18n'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { withCoordinatorAgent, type EditorDraft } from './routing-table-editor-model'
import { primaryAgentLabel } from './routing-table-labels'

export function PrimaryCliSelect(props: {
  coordinator: EditorDraft['coordinator']
  onChange: (coordinator: EditorDraft['coordinator']) => void
}): React.JSX.Element {
  return (
    <Select
      value={props.coordinator.agent}
      onValueChange={(agent) => {
        if (agent === 'claude' || agent === 'codex') {
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
        {(['claude', 'codex'] as const).map((agent) => (
          <SelectItem key={agent} value={agent}>
            {primaryAgentLabel(agent)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
