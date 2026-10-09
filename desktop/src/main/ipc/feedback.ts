import { ipcMain, shell } from 'electron'
import { getNewIssueUrl } from '../../shared/app-release-repository'
import type {
  FeedbackSubmitArgs,
  FeedbackSubmitResult
} from '../../shared/feedback-submit-contract'
import type { FeedbackDiagnosticBundleAttachment, FeedbackSubmissionType } from './feedback-request'

export type {
  FeedbackImageAttachment,
  FeedbackRequestFailure,
  FeedbackSubmitArgs,
  FeedbackSubmitResult
} from '../../shared/feedback-submit-contract'
export type { FeedbackDiagnosticBundleAttachment, FeedbackSubmissionType } from './feedback-request'

type InternalFeedbackSubmitArgs = FeedbackSubmitArgs & {
  submissionType?: FeedbackSubmissionType
  diagnosticBundle?: FeedbackDiagnosticBundleAttachment
  feedbackWithoutDiagnosticBundle?: string
}

export async function submitFeedback(
  args: InternalFeedbackSubmitArgs
): Promise<FeedbackSubmitResult> {
  try {
    await shell.openExternal(
      getNewIssueUrl(
        args.submissionType === 'crash' ? 'Crash report' : 'Feedback',
        args.feedbackWithoutDiagnosticBundle ?? args.feedback
      )
    )
    return { ok: true, issueOpened: true }
  } catch {
    return { ok: false, status: null, error: 'Could not open the NASH GitHub issue form.' }
  }
}

export function registerFeedbackHandlers(): void {
  ipcMain.removeHandler('feedback:submit')
  ipcMain.handle('feedback:submit', (_event, args: FeedbackSubmitArgs) =>
    submitFeedback({ feedback: args.feedback, githubLogin: null, githubEmail: null })
  )
}
