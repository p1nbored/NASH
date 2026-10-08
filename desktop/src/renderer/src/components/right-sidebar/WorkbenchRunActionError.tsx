import { translate } from '@/i18n/i18n'
import WorkbenchCallout from './WorkbenchCallout'
import type { WorkbenchError } from './workbench-rpc-error'

// Why a warning: a refused stop changed nothing; the sentence says what to do next, and the
// refusal codes are in the run's "Copy details".
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
    </WorkbenchCallout>
  )
}
