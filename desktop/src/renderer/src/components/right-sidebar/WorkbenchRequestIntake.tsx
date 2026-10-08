import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { translate } from '@/i18n/i18n'
import {
  WORKBENCH_OBJECTIVE_MAX_LENGTH,
  WorkbenchObjectiveSchema
} from '../../../../shared/workbench-request'

// Why: intake follows the queue so request states lead; starting a run is the panel's one primary
// action, and it stays disabled until the request list has been read.
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
      className="space-y-1.5 pt-1"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <Label htmlFor="workbench-request-objective">
        {translate('workbench.requests.objective', 'Objective')}
      </Label>
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
        <p id="workbench-request-objective-help" className="text-meta text-muted-foreground">
          {translate(
            'workbench.requests.intakeHelp',
            'Starts a run with the configured primary CLI in this workspace.'
          )}
        </p>
        <Button
          type="submit"
          size="sm"
          disabled={busy || !verified || !WorkbenchObjectiveSchema.safeParse(objective).success}
        >
          {translate('workbench.requests.startRun', 'Start run')}
        </Button>
      </div>
    </form>
  )
}
