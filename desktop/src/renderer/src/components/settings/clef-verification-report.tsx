import { useId } from 'react'
import { Pin } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import type { ClefVerifyResult } from '../../../../shared/clef/clef-verification-view'
import { Button } from '../ui/button'
import { clefBlockerMessage, clefProfileProblemMessage } from './clef-verification-messages'
import { RoutingWarningCallout } from './routing-warning-callout'

type Reported = Extract<ClefVerifyResult, { outcome: 'reported' }>
type Failed = Extract<ClefVerifyResult, { outcome: 'call_failed' }>

function Fact({ term, children }: { term: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <>
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="min-w-0 break-words text-foreground">{children}</dd>
    </>
  )
}

function answersText(result: Reported): string {
  const { answerKeys, questions } = result.report
  return answerKeys.matchQuestionIds
    ? translate(
        'auto.components.settings.clef.verification.report.answersMatch',
        'match the {{count}} questions',
        { count: questions.length }
      )
    : translate(
        'auto.components.settings.clef.verification.report.answersMissing',
        'missing: {{ids}}',
        {
          ids: answerKeys.missing.join(', ') || '-'
        }
      )
}

function echoText(echo: Reported['report']['optionIdEcho']): string {
  switch (echo) {
    case 'exact':
      return translate(
        'auto.components.settings.clef.verification.report.echoExact',
        'repeated exactly'
      )
    case 'altered':
      return translate('auto.components.settings.clef.verification.report.echoAltered', 'altered')
    case 'missing':
      return translate('auto.components.settings.clef.verification.report.echoMissing', 'missing')
  }
}

function ReportFacts({ result }: { result: Reported }): React.JSX.Element {
  const { report } = result
  const usage = report.usage
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
      <Fact
        term={translate('auto.components.settings.clef.verification.report.response', 'Response')}
      >
        {translate(
          'auto.components.settings.clef.verification.report.http',
          'HTTP {{status}} · {{bytes}} bytes',
          {
            status: report.httpStatus,
            bytes: report.rawByteLength
          }
        )}
      </Fact>
      <Fact term={translate('auto.components.settings.clef.verification.report.model', 'Model')}>
        {report.model.observed ??
          translate(
            'auto.components.settings.clef.verification.report.modelUnnamed',
            'not named in the response'
          )}
      </Fact>
      <Fact
        term={translate('auto.components.settings.clef.verification.report.answers', 'Answers')}
      >
        {answersText(result)}
      </Fact>
      <Fact
        term={translate(
          'auto.components.settings.clef.verification.report.optionIds',
          'Option IDs'
        )}
      >
        {echoText(report.optionIdEcho)}
      </Fact>
      <Fact
        term={translate(
          'auto.components.settings.clef.verification.report.sums',
          'Probability sums'
        )}
      >
        {report.maxSumDeviation === null
          ? translate(
              'auto.components.settings.clef.verification.report.sumsUnknown',
              'not measured'
            )
          : translate(
              'auto.components.settings.clef.verification.report.sumsDeviation',
              'off by at most {{deviation}}',
              {
                deviation: report.maxSumDeviation
              }
            )}
      </Fact>
      <Fact term={translate('auto.components.settings.clef.verification.report.tokens', 'Tokens')}>
        {translate(
          'auto.components.settings.clef.verification.report.tokenCounts',
          '{{input}} in (estimated {{estimate}}) · {{output}} out',
          {
            input: usage.inputTokens ?? '?',
            estimate: usage.estimatedInputTokens,
            output: usage.outputTokens ?? '?'
          }
        )}
      </Fact>
      <Fact term={translate('auto.components.settings.clef.verification.report.report', 'Report')}>
        {translate(
          'auto.components.settings.clef.verification.report.format',
          'Report format {{version}}',
          { version: report.reportVersion }
        )}{' '}
        · <span className="font-mono text-[11px]">{result.reportSha256.slice(0, 12)}</span>
      </Fact>
    </dl>
  )
}

function ReportedResult(props: {
  result: Reported
  pinning: boolean
  onPin: (reportSha256: string) => void
}): React.JSX.Element {
  const labelId = useId()
  const { pin } = props.result
  return (
    <div
      role="group"
      aria-labelledby={labelId}
      className="space-y-2 rounded-md border border-border/60 p-3 text-xs"
    >
      <p id={labelId} className="font-medium text-foreground">
        {translate(
          'auto.components.settings.clef.verification.report.title',
          'Verification report'
        )}
      </p>
      <ReportFacts result={props.result} />
      {pin.pinnable ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-muted-foreground">
            {translate(
              'auto.components.settings.clef.verification.report.pinnable',
              'This report can be pinned as the response profile.'
            )}
          </p>
          <Button
            size="sm"
            disabled={props.pinning}
            onClick={() => props.onPin(props.result.reportSha256)}
          >
            <Pin aria-hidden="true" />
            {translate('auto.components.settings.clef.verification.report.pin', 'Pin profile')}
          </Button>
        </div>
      ) : (
        <div className="space-y-1">
          <p className="text-foreground">
            {translate(
              'auto.components.settings.clef.verification.report.notPinnable',
              'This report cannot be pinned:'
            )}
          </p>
          <ul className="list-disc space-y-0.5 pl-5">
            {pin.problems.map((problem) => (
              <li key={problem}>{clefProfileProblemMessage(problem)}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function FailedResult({ result }: { result: Failed }): React.JSX.Element {
  const blocker = clefBlockerMessage(result.blocker)
  return (
    <RoutingWarningCallout
      label={translate(
        'auto.components.settings.clef.verification.report.failedTitle',
        'Verification call failed'
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
      <p className="text-muted-foreground">
        {result.httpStatus === null
          ? translate('auto.components.settings.clef.verification.report.noHttp', 'No HTTP answer')
          : translate(
              'auto.components.settings.clef.verification.report.httpOnly',
              'HTTP {{status}}',
              { status: result.httpStatus }
            )}{' '}
        ·{' '}
        {translate(
          'auto.components.settings.clef.verification.report.attempts',
          'attempts: {{count}}',
          { count: result.attempts }
        )}
      </p>
    </RoutingWarningCallout>
  )
}

/** The outcome of the last Verify: the redacted v2 report and its pin verdict, or why it failed. */
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
