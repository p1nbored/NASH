import { Check, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useClipboardTextCopyFeedback } from '@/hooks/use-clipboard-text-copy-feedback'
import { translate } from '@/i18n/i18n'
import { formatWorkbenchDetails, type WorkbenchDetail } from './workbench-details'

// Why one icon button per item: IDs, codes, hashes and hosts help a report, but never belong in
// the visible Workbench (I-03). The clipboard is written only on click.
export default function WorkbenchCopyDetails({
  subject,
  entries
}: {
  subject: string
  entries: readonly WorkbenchDetail[]
}): React.JSX.Element {
  const { copyText, status } = useClipboardTextCopyFeedback(
    formatWorkbenchDetails(subject, entries)
  )
  const label =
    status === 'copied'
      ? translate('workbench.details.copied', 'Copied')
      : status === 'failed'
        ? translate('workbench.details.copyFailed', "Couldn't copy")
        : translate('workbench.details.copy', 'Copy details')
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      title={label}
      data-status={status}
      onClick={() => void copyText()}
    >
      {status === 'copied' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
    </Button>
  )
}
