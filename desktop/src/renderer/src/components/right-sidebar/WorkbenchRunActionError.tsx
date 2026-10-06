import { translate } from '@/i18n/i18n'
import WorkbenchCallout from './WorkbenchCallout'
import type { WorkbenchError } from './workbench-rpc-error'

// Why the server text: stop refusals already say what to do next in English (D3).
export default function WorkbenchRunActionError({
  error
}: {
  error: WorkbenchError
}): React.JSX.Element {
  return (
    <WorkbenchCallout
      role="alert"
      label={translate('workbench.runs.actionError', 'Run not stopped')}
    >
      <p className="break-words">{error.message}</p>
      <p className="break-words font-mono">{error.code}</p>
    </WorkbenchCallout>
  )
}
