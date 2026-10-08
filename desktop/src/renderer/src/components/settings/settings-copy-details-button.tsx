import { sanitizeCopiedDiagnostics } from '../../../../shared/crash-report-redaction'
import { Copy } from 'lucide-react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { Button } from '../ui/button'

/**
 * Copies the technical detail a settings message leaves out (codes, ids, hashes, versions), so the
 * visible text stays plain. The text is built only when clicked and is never rendered.
 */
export function CopyDetailsButton({
  details,
  label
}: {
  details: string | (() => string)
  /** Accessible name when several copy buttons share one view, such as "Copy details for X". */
  label?: string
}): React.JSX.Element {
  const copy = async (): Promise<void> => {
    try {
      await window.api.ui.writeClipboardText(
        sanitizeCopiedDiagnostics(typeof details === 'function' ? details() : details)
      )
      toast.success(translate('auto.components.settings.copyDetails.copied', 'Details copied.'))
    } catch {
      toast.error(
        translate('auto.components.settings.copyDetails.failed', 'The details could not be copied.')
      )
    }
  }
  return (
    <Button type="button" variant="ghost" size="xs" aria-label={label} onClick={() => void copy()}>
      <Copy aria-hidden="true" />
      {translate('auto.components.settings.copyDetails.action', 'Copy details')}
    </Button>
  )
}
