import { Copy } from 'lucide-react'
import { toast } from 'sonner'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'

/** Copies the chat's Orca session ID from the host: `orca_session_id:<root>`, which `/clear` keeps. */
export function NativeChatCopyOrcaSessionIdMenuItem({
  resolveOrcaSessionId
}: {
  resolveOrcaSessionId: () => Promise<string | null>
}): React.JSX.Element {
  const copyOrcaSessionId = async (): Promise<void> => {
    try {
      const orcaSessionId = await resolveOrcaSessionId()
      if (!orcaSessionId) {
        throw new Error('no NASH session ID')
      }
      await window.api.ui.writeClipboardText(orcaSessionId)
      toast.success(
        translate(
          'components.native-chat.contextMenu.orcaSessionIdCopied',
          'NASH session ID copied'
        )
      )
    } catch {
      toast.error(
        translate(
          'components.native-chat.contextMenu.orcaSessionIdCopyFailed',
          'Unable to copy NASH session ID'
        )
      )
    }
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <DropdownMenuItem onSelect={() => void copyOrcaSessionId()}>
          <Copy />
          {translate(
            'components.native-chat.contextMenu.copyOrcaSessionId',
            'Copy NASH Session ID'
          )}
        </DropdownMenuItem>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8} className="max-w-[220px]">
        {translate(
          'components.native-chat.contextMenu.orcaSessionIdTooltip',
          "NASH's ID for this chat, separate from the agent CLI's own session ID. Agents use it to refer to each other through NASH."
        )}
      </TooltipContent>
    </Tooltip>
  )
}
