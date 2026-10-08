import { translate } from '@/i18n/i18n'
import type { WorkbenchRequestStatus } from '../../../../shared/workbench-request'
import WorkbenchStateChip, { type WorkbenchChipCopy } from './WorkbenchStateChip'

// Why run wording: the view statuses keep their routing-era names (D-016 plan 1.2) but mean launch states.
export function requestStatusChip(status: WorkbenchRequestStatus): WorkbenchChipCopy {
  switch (status) {
    case 'ROUTING_BLOCKED':
      return {
        kind: 'blocked',
        label: translate('workbench.requests.status.launchBlocked', 'Launch blocked')
      }
    case 'ROUTING':
      return {
        kind: 'progress',
        label: translate('workbench.requests.status.starting', 'Starting')
      }
    case 'ROUTED':
      return {
        kind: 'done',
        label: translate('workbench.requests.status.runStarted', 'Run started')
      }
    case 'CANCELED':
      return { kind: 'ended', label: translate('workbench.requests.status.canceled', 'Canceled') }
  }
}

export default function WorkbenchRequestStateChip({
  status
}: {
  status: WorkbenchRequestStatus
}): React.JSX.Element {
  return <WorkbenchStateChip {...requestStatusChip(status)} />
}
