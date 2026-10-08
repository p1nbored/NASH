import { FlaskConical, Lightbulb, type LucideIcon } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { RSI_NAVIGATION_ENABLED } from '../../../../shared/nash-build-flags'

type RsiNavEntry = { id: string; label: string; icon: LucideIcon }

function getRsiNavEntries(): readonly RsiNavEntry[] {
  return [
    {
      id: 'rsi-lab',
      label: translate('auto.components.sidebar.SidebarNav.rsiLab', 'RSI Lab'),
      icon: FlaskConical
    },
    {
      id: 'rsi-improvements',
      label: translate('auto.components.sidebar.SidebarNav.rsiImprovements', 'Improvements'),
      icon: Lightbulb
    }
  ]
}

/**
 * RSI belongs in the left navigation (D-038), hidden until its backend exists. Even when the flag is
 * on, the rows only say they are not connected; nothing here shows data.
 */
export function SidebarRsiNavEntries(): React.JSX.Element | null {
  if (!RSI_NAVIGATION_ENABLED) {
    return null
  }
  const notConnected = translate(
    'auto.components.sidebar.SidebarNav.rsiNotConnected',
    'Not connected'
  )
  return (
    <>
      {getRsiNavEntries().map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          disabled
          data-rsi-nav-entry={id}
          className="flex w-full cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-left text-body font-medium tracking-tight text-worktree-sidebar-foreground/45"
        >
          <Icon
            className="size-4 shrink-0 text-worktree-sidebar-foreground/30"
            strokeWidth={1.75}
          />
          <span className="min-w-0 flex-1 truncate">{label}</span>
          <span className="shrink-0 text-caption text-worktree-sidebar-foreground/45">
            {notConnected}
          </span>
        </button>
      ))}
    </>
  )
}
