import { useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { useMountedRef } from '@/hooks/useMountedRef'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { stripClientEnvironmentFooter } from '../../../../shared/client-environment-info'
import { useSidebarFeedbackEnvironmentPrefill } from './use-sidebar-feedback-environment-prefill'

type SidebarFeedbackDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SidebarFeedbackDialog({
  open,
  onOpenChange
}: SidebarFeedbackDialogProps): React.JSX.Element {
  const feedback = useAppStore((s) => s.feedbackDraft.feedback)
  const setFeedbackDraft = useAppStore((s) => s.setFeedbackDraft)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const mountedRef = useMountedRef()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const setFeedback = useCallback(
    (updater: (current: string) => string) => {
      setFeedbackDraft({ feedback: updater(useAppStore.getState().feedbackDraft.feedback) })
    },
    [setFeedbackDraft]
  )

  useSidebarFeedbackEnvironmentPrefill({ open, feedback, setFeedback, textareaRef, mountedRef })

  const handleSubmit = async (): Promise<void> => {
    if (isSubmitting || !stripClientEnvironmentFooter(feedback).trim()) {
      return
    }
    setIsSubmitting(true)
    try {
      const result = await window.api.feedback.submit({
        feedback: feedback.trim(),
        githubLogin: null,
        githubEmail: null
      })
      if (!result.ok) {
        throw new Error(result.error)
      }
      // The browser owns submission; keep the draft until the user replaces it.
      if (mountedRef.current) {
        onOpenChange(false)
      }
    } catch {
      if (mountedRef.current) {
        toast.error(
          translate('feedback.githubOpenFailed', 'Could not open GitHub. Your draft is saved.')
        )
      }
    } finally {
      if (mountedRef.current) {
        setIsSubmitting(false)
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[calc(100vh-3rem)] overflow-y-auto scrollbar-sleek sm:max-w-lg"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          textareaRef.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {translate('auto.components.sidebar.SidebarFeedbackDialog.0eb643f07f', 'Send Feedback')}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'feedback.githubDescription',
              'Review and submit your feedback in NASH GitHub Issues. Add screenshots in the browser. Your draft stays here until you replace it.'
            )}
          </DialogDescription>
        </DialogHeader>
        <Textarea
          ref={textareaRef}
          value={feedback}
          onChange={(event) => setFeedbackDraft({ feedback: event.target.value })}
          placeholder={translate(
            'auto.components.sidebar.SidebarFeedbackDialog.d46ddd66fc',
            'What could we improve?'
          )}
          rows={7}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            {translate('auto.components.sidebar.SidebarFeedbackDialog.8bf619e4cf', 'Cancel')}
          </Button>
          <Button variant="outline" onClick={() => void window.api.ui.writeClipboardText(feedback)}>
            {translate('feedback.copyDraft', 'Copy full draft')}
          </Button>
          <Button
            onClick={() => void handleSubmit()}
            disabled={isSubmitting || !stripClientEnvironmentFooter(feedback).trim()}
          >
            {translate('crashReport.openGithubIssue', 'Open GitHub Issue')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
