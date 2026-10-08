import { ListChecks, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { WorkbenchValidationCheckPendingResult } from '../../../../shared/rpc-contract/workbench-validation-params'
import { useWorkbenchValidationCheck } from './use-workbench-validation-check'
import WorkbenchCallout from './WorkbenchCallout'
import { errorDetails } from './workbench-details'

function PassCounts({
  result
}: {
  result: WorkbenchValidationCheckPendingResult
}): React.JSX.Element {
  if (result.checked === 0) {
    return (
      <p role="status" className="text-meta text-muted-foreground">
        {translate(
          'workbench.validation.nothingWaiting',
          'No task results were waiting for validation.'
        )}
      </p>
    )
  }
  const counts = [
    { key: 'passed', label: translate('workbench.validation.passed', 'Passed') },
    { key: 'failed', label: translate('workbench.validation.failedCount', 'Failed') },
    {
      key: 'inconclusive',
      label: translate('workbench.validation.inconclusive', 'Left for a decision')
    },
    { key: 'skipped', label: translate('workbench.validation.skipped', 'Skipped') }
  ] as const
  return (
    <div role="status" className="space-y-0.5 text-meta text-muted-foreground">
      <p>
        {translate('workbench.validation.checked', 'Results checked: {{total}}', {
          total: result.checked
        })}
      </p>
      <dl className="flex flex-wrap gap-x-3 gap-y-0.5">
        {counts.map(({ key, label }) => (
          <div key={key} className="flex gap-1">
            <dt>{label}</dt>
            <dd className="tabular-nums text-foreground">{result[key]}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

// Why under the runs: validation decides when a run's task is done (D-016), and a pass may run a
// model review, so it starts only on this button, never on a poll.
export default function WorkbenchValidationCheck(): React.JSX.Element {
  const validation = useWorkbenchValidationCheck()
  return (
    <section aria-labelledby="workbench-validation" className="space-y-1 pt-1">
      <div className="flex min-h-6 items-center justify-between gap-2">
        <h3 id="workbench-validation" className="text-meta font-medium text-muted-foreground">
          {translate('workbench.validation.title', 'Task validation')}
        </h3>
        {/* Why one label: only the icon swaps while checking, so the button keeps its width. */}
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={validation.checking}
          aria-busy={validation.checking}
          onClick={() => void validation.check()}
        >
          {validation.checking ? (
            <Loader2 aria-hidden="true" className="animate-spin" />
          ) : (
            <ListChecks aria-hidden="true" />
          )}
          {translate('workbench.validation.check', 'Check now')}
        </Button>
      </div>
      <p className="text-meta text-muted-foreground">
        {translate(
          'workbench.validation.helpShort',
          'Each result is checked when its task reports. Check now also checks results still waiting.'
        )}
      </p>
      {validation.result && <PassCounts result={validation.result} />}
      {validation.error && (
        <WorkbenchCallout
          role="alert"
          tone="error"
          label={translate('workbench.validation.errorTitle', 'Validation not checked')}
          details={{ subject: 'validation check', entries: errorDetails(validation.error) }}
        >
          <p className="break-words">{validation.error.message}</p>
        </WorkbenchCallout>
      )}
    </section>
  )
}
