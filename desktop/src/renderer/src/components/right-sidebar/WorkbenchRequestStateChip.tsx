import { translate } from '@/i18n/i18n'
import type { WorkbenchRequestStatus } from '../../../../shared/workbench-request'
import type { WorkbenchChipCopy } from './workbench-run-copy'
import WorkbenchStateChip from './WorkbenchStateChip'

// Why run wording: the view statuses keep their routing-era names (D-016 plan 1.2) but mean launch states.
function chipFor(status: WorkbenchRequestStatus): WorkbenchChipCopy {
  switch (status) {
    case 'ROUTING_BLOCKED':
      return {
        label: translate('workbench.requests.status.launchBlocked', 'Launch blocked'),
        tone: 'warning'
      }
    case 'ROUTING':
      return { label: translate('workbench.requests.status.starting', 'Starting'), tone: 'neutral' }
    case 'ROUTED':
      return {
        label: translate('workbench.requests.status.runStarted', 'Run started'),
        tone: 'neutral'
      }
    case 'CANCELED':
      return { label: translate('workbench.requests.status.canceled', 'Canceled'), tone: 'muted' }
  }
}

export default function WorkbenchRequestStateChip({
  status
}: {
  status: WorkbenchRequestStatus
}): React.JSX.Element {
  return <WorkbenchStateChip status={status} {...chipFor(status)} />
}
