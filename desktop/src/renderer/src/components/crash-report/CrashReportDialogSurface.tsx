import { useDeferredValue, useMemo, useState } from 'react'
import { AlertTriangle, Clipboard, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { useMountedRef } from '@/hooks/useMountedRef'
import {
  formatCrashReportText,
  isReactErrorBoundaryReport,
  MAX_USER_NOTES_LENGTH,
  type CrashReportRecord
} from '../../../../shared/crash-reporting'
import { translate } from '@/i18n/i18n'
import { useCrashReportCopy } from './use-crash-report-copy'

function formatSummary(report: CrashReportRecord): string {
  if (isReactErrorBoundaryReport(report)) {
    const surface = typeof report.details.surface === 'string' ? report.details.surface : null
    return surface ? `React render error in ${surface}` : 'React render error'
  }
  return `${report.processType} ${report.reason}${
    report.exitCode === null ? '' : ` (exit ${report.exitCode})`
  }`
}

function getDialogTitle(report: CrashReportRecord | null): string {
  if (!report) {
    return 'Report a crash'
  }
  return report && isReactErrorBoundaryReport(report)
    ? 'NASH hit a recoverable UI error'
    : 'NASH closed unexpectedly'
}

function getNotesPlaceholder(report: CrashReportRecord | null): string {
  if (!report) {
    return 'Optional: what happened?'
  }
  return report && isReactErrorBoundaryReport(report)
    ? 'Optional: what were you doing before this UI error?'
    : 'Optional: what were you doing before NASH closed?'
}

type CrashReportDialogSurfaceProps = {
  open: boolean
  report: CrashReportRecord | null
  loading: boolean
  onOpenChange: (open: boolean) => void
  onReportChange: (report: CrashReportRecord | null) => void
}

export function CrashReportDialogSurface({
  open,
  report,
  loading,
  onOpenChange,
  onReportChange
}: CrashReportDialogSurfaceProps): React.JSX.Element {
  const mountedRef = useMountedRef()
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const deferredNotes = useDeferredValue(notes)
  const diagnosticText = useMemo(
    // Why: formatting applies redaction and truncation over the full crash
    // payload. Keep that preview update out of the textarea keystroke path.
    () => (report ? formatCrashReportText(report, deferredNotes) : ''),
    [deferredNotes, report]
  )
  const copyCrashReportDetails = useCrashReportCopy(report, notes)

  const showSubmitFailure = (): void => {
    toast.error('Could not open GitHub.', {
      description: 'Copy the details and try again.',
      action: { label: 'Copy Details', onClick: () => void copyCrashReportDetails() }
    })
  }

  const dismissReportIfNeeded = async (): Promise<void> => {
    if (report?.status === 'pending') {
      await window.api.crashReports.dismiss({ reportId: report.id })
      if (mountedRef.current) {
        onReportChange({ ...report, status: 'dismissed' })
      }
    }
  }

  const handleDismiss = async (): Promise<void> => {
    await dismissReportIfNeeded()
    if (mountedRef.current) {
      onOpenChange(false)
    }
  }

  const handleSubmit = async (): Promise<void> => {
    setSubmitting(true)
    try {
      const result = await window.api.crashReports.submit({
        ...(report ? { reportId: report.id } : {}),
        notes
      })
      if (!result.ok) {
        showSubmitFailure()
        console.error('Failed to submit crash report:', result.error)
        return
      }
      if (!mountedRef.current) {
        return
      }
      onReportChange(result.report)
      toast.success('GitHub issue form opened. Submit the report in your browser.')
      onOpenChange(false)
    } catch (error) {
      showSubmitFailure()
      console.error('Failed to submit crash report:', error)
    } finally {
      if (mountedRef.current) {
        setSubmitting(false)
      }
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (submitting && !nextOpen) {
          return
        }
        if (!nextOpen) {
          void dismissReportIfNeeded().finally(() => {
            if (mountedRef.current) {
              onOpenChange(false)
            }
          })
          return
        }
        onOpenChange(true)
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <AlertTriangle className="size-4 text-destructive" />
            {getDialogTitle(report)}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {translate(
              'crashReport.githubDescription',
              'Review and submit a crash report on GitHub. Copy Details includes the full diagnostic text.'
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="min-w-0 space-y-3">
          {report ? (
            <>
              <div className="rounded-md border border-border/70 bg-muted/30 p-3 text-xs">
                <div className="font-medium text-foreground">{formatSummary(report)}</div>
                <div className="mt-1 text-muted-foreground">
                  {new Date(report.createdAt).toLocaleString()} · {report.platform} {report.arch} ·
                  {translate('auto.components.crash.report.CrashReportDialog.835037edc9', 'NASH')}{' '}
                  {report.appVersion}
                </div>
              </div>
              <div className="min-w-0 space-y-1.5">
                <div className="text-[11px] font-medium text-muted-foreground">
                  {translate(
                    'auto.components.crash.report.CrashReportDialog.6d3ebe216a',
                    'Diagnostic text'
                  )}
                </div>
                <pre className="max-h-44 overflow-auto whitespace-pre-wrap [overflow-wrap:anywhere] rounded-md border border-border bg-muted/20 p-3 font-mono text-[11px] leading-5 text-muted-foreground scrollbar-sleek">
                  {diagnosticText}
                </pre>
              </div>
            </>
          ) : (
            <div className="rounded-md border border-border/70 bg-muted/30 p-3 text-xs text-muted-foreground">
              {loading
                ? translate(
                    'auto.components.crash.report.CrashReportDialog.765591798d',
                    'Checking for crash reports...'
                  )
                : translate(
                    'auto.components.crash.report.CrashReportDialog.nashNoReport',
                    'No automatic crash report was captured.'
                  )}
            </div>
          )}
          <div className="space-y-1">
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={4}
              // Keep the UI and formatter on the same input budget.
              maxLength={MAX_USER_NOTES_LENGTH}
              placeholder={getNotesPlaceholder(report)}
              className="min-h-24 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
            <div
              aria-hidden="true"
              className="text-right text-[11px] tabular-nums text-muted-foreground"
            >
              {notes.length.toLocaleString()} / {MAX_USER_NOTES_LENGTH.toLocaleString()}
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void copyCrashReportDetails()}
            disabled={loading}
          >
            <Clipboard className="size-3.5" />
            {translate('auto.components.crash.report.CrashReportDialog.50b00dc327', 'Copy Details')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleDismiss}
            disabled={submitting}
          >
            {translate('auto.components.crash.report.CrashReportDialog.nashClose', 'Close')}
          </Button>
          <Button type="button" size="sm" onClick={handleSubmit} disabled={loading || submitting}>
            <ExternalLink className="size-3.5" />
            {translate('crashReport.openGithubIssue', 'Open GitHub Issue')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
