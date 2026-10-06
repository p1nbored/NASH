import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { translate } from '@/i18n/i18n'
import {
  WORKBENCH_OBJECTIVE_MAX_LENGTH,
  WorkbenchObjectiveSchema
} from '../../../../shared/workbench-request'

// Why: intake follows the queue so request states lead; registration is the panel's one primary action.
export default function WorkbenchRequestIntake({
  objective,
  verified,
  busy,
  editObjective,
  submit
}: {
  objective: string
  verified: boolean
  busy: boolean
  editObjective: (value: string) => void
  submit: () => Promise<void>
}): React.JSX.Element {
  return (
    <form
      className="space-y-2 border-t border-border pt-3"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
        <Label htmlFor="workbench-request-objective">
          {translate('workbench.requests.objective', 'Objective')}
        </Label>
        <span className="text-xs text-muted-foreground">
          {verified
            ? translate('workbench.requests.available', 'Request intake available')
            : translate('workbench.requests.unverified', 'Request intake not verified')}
        </span>
      </div>
      <Textarea
        id="workbench-request-objective"
        aria-describedby="workbench-request-objective-help"
        value={objective}
        maxLength={WORKBENCH_OBJECTIVE_MAX_LENGTH}
        disabled={busy || !verified}
        onChange={(event) => editObjective(event.target.value)}
        rows={2}
      />
      <div className="flex items-start justify-between gap-3">
        <p id="workbench-request-objective-help" className="text-xs text-muted-foreground">
          {translate(
            'workbench.requests.objectiveHelp',
            'Write the objective in English. Your original text is stored without rewriting.'
          )}
        </p>
        <Button
          type="submit"
          size="sm"
          disabled={busy || !verified || !WorkbenchObjectiveSchema.safeParse(objective).success}
        >
          {translate('workbench.requests.register', 'Register request')}
        </Button>
      </div>
    </form>
  )
}
