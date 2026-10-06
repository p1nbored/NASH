import { translate } from '@/i18n/i18n'
import type { WorkbenchRequest } from '../../../../shared/workbench-request'
import WorkbenchCallout from './WorkbenchCallout'

type Blocker = Extract<WorkbenchRequest, { status: 'ROUTING_BLOCKED' }>['routingBlocker']

// Why only launch details: D3's door blocks a launch with exactly these three (wp-d3-result.md).
const LAUNCH_DETAILS = new Map<string, () => string>([
  [
    'coordinator_route_unavailable',
    () =>
      translate(
        'workbench.requests.launch.routeUnavailable',
        'The Routing Table has no available coordinator route.'
      )
  ],
  [
    'launch_refused',
    () => translate('workbench.requests.launch.refused', 'The run could not be started.')
  ],
  [
    'launch_unverifiable',
    () =>
      translate(
        'workbench.requests.launch.unverifiable',
        'A run was created, but its start could not be confirmed.'
      )
  ]
])

function launchSentence(blocker: Blocker): string | null {
  if (blocker.reason !== 'launch_blocked') {
    return null
  }
  return LAUNCH_DETAILS.get(blocker.detail)?.() ?? null
}

export default function WorkbenchRequestLaunchBlocker({
  request
}: {
  request: WorkbenchRequest
}): React.JSX.Element | null {
  if (request.status !== 'ROUTING_BLOCKED') {
    return null
  }
  const blocker = request.routingBlocker
  const sentence = launchSentence(blocker)
  return (
    <WorkbenchCallout label={translate('workbench.requests.launchBlocker', 'Launch blocker')}>
      {sentence && <p>{sentence}</p>}
      <p className="break-words font-mono">{`${blocker.reason} / ${blocker.detail}`}</p>
    </WorkbenchCallout>
  )
}
