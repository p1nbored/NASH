import os from 'node:os'
import { app, shell } from 'electron'
import { getNewIssueUrl } from '../../shared/app-release-repository'
import {
  type CrashReportDiagnosticBundle,
  type CrashReportSubmitArgs,
  type CrashReportSubmitResult,
  formatCrashReportText,
  formatUncapturedCrashReportText
} from '../../shared/crash-reporting'
import type { CrashReportStore } from '../crash-reporting/crash-report-store'
import { getRequestedCrashReport, inFlightSubmissions } from './crash-reporting-sendable-reports'

export function buildUncapturedCrashReportText(
  notes: string | undefined,
  diagnosticBundle?: CrashReportDiagnosticBundle
): string {
  return formatUncapturedCrashReportText(
    {
      createdAt: new Date().toISOString(),
      appVersion: app.getVersion(),
      platform: os.platform(),
      osRelease: os.release(),
      arch: os.arch(),
      electronVersion: process.versions.electron ?? 'unknown',
      chromeVersion: process.versions.chrome ?? 'unknown'
    },
    notes,
    diagnosticBundle
  )
}

export async function submitCrashReport(
  store: CrashReportStore,
  args: CrashReportSubmitArgs
): Promise<CrashReportSubmitResult> {
  const report = await getRequestedCrashReport(store, args)
  if (report && inFlightSubmissions.has(report.id)) {
    return { ok: false, status: null, error: 'GitHub issue form is already opening.', report }
  }
  if (report) {
    inFlightSubmissions.add(report.id)
  }
  try {
    const text = report
      ? formatCrashReportText(report, args.notes)
      : buildUncapturedCrashReportText(args.notes)
    await shell.openExternal(getNewIssueUrl('Crash report', text))
    // Opening a draft does not establish that the user submitted it.
    return { ok: true, issueOpened: true, report }
  } catch {
    return {
      ok: false,
      status: null,
      error: 'Could not open GitHub. Copy the details and try again.',
      report
    }
  } finally {
    if (report) {
      inFlightSubmissions.delete(report.id)
    }
  }
}
