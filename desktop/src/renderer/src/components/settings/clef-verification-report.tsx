import { useId } from 'react'
import { translate } from '@/i18n/i18n'
import type { ClefVerifyResult } from '../../../../shared/clef/clef-verification-view'
import { Button } from '../ui/button'
import { clefVerifyResultDetails } from './clef-details'
import { clefBlockerMessage, clefProfileProblemMessage } from './clef-verification-messages'
import { RoutingWarningCallout } from './routing-warning-callout'
import { CopyDetailsButton } from './settings-copy-details-button'
import { SettingsStatusLabel } from './settings-status-label'

type Reported = Extract<ClefVerifyResult, { outcome: 'reported' }>
type Failed = Extract<ClefVerifyResult, { outcome: 'call_failed' }>

function ReportedResult(props: {
  result: Reported
  pinning: boolean
  onPin: (reportSha256: string) => void
}): React.JSX.Element {
  const labelId = useId()
  const { pin } = props.result
  return (
    <div role="group" aria-labelledby={labelId} className="space-y-row">
      <p id={labelId} className="sr-only">
        {translate('auto.components.settings.clef.verification.report.titlePlain', 'Verify result')}
      </p>
      {pin.pinnable ? (
        <SettingsStatusLabel
          tone="success"
          label={translate(
            'auto.components.settings.clef.verification.report.passed',
            'Clef answered in the expected format.'
          )}
        />
      ) : (
        <div className="space-y-1 text-meta">
          <SettingsStatusLabel
            tone="warning"
            label={translate(
              'auto.components.settings.clef.verification.report.notUsable',
              'This result cannot be used:'
            )}
          />
          <ul className="list-disc space-y-0.5 pl-9 text-foreground">
            {pin.problems.map((problem) => (
              <li key={problem}>{clefProfileProblemMessage(problem)}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-row">
        {pin.pinnable ? (
          <Button
            size="sm"
            disabled={props.pinning}
            onClick={() => props.onPin(props.result.reportSha256)}
          >
            {translate(
              'auto.components.settings.clef.verification.report.useResult',
              'Use this result'
            )}
          </Button>
        ) : null}
        <CopyDetailsButton details={() => clefVerifyResultDetails(props.result)} />
      </div>
    </div>
  )
}

function FailedResult({ result }: { result: Failed }): React.JSX.Element {
  const blocker = clefBlockerMessage(result.blocker)
  return (
    <RoutingWarningCallout
      label={translate(
        'auto.components.settings.clef.verification.report.failedTitlePlain',
        'Verification failed'
      )}
    >
      <p>
        {translate(
          'auto.components.settings.clef.verification.report.failedReason',
          '{{reason}}: {{detail}}.',
          {
            reason: blocker.reason,
            detail: blocker.detail
          }
        )}
      </p>
      <CopyDetailsButton details={() => clefVerifyResultDetails(result)} />
    </RoutingWarningCallout>
  )
}

/** The outcome of the last Verify: whether its result can be used, or why the call failed. */
export function ClefVerificationResult(props: {
  result: ClefVerifyResult
  pinning: boolean
  onPin: (reportSha256: string) => void
}): React.JSX.Element {
  return props.result.outcome === 'reported' ? (
    <ReportedResult result={props.result} pinning={props.pinning} onPin={props.onPin} />
  ) : (
    <FailedResult result={props.result} />
  )
}
