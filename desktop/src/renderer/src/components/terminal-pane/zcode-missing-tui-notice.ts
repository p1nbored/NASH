import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'

/** Explain a missing ZCode terminal UI before the user waits on a dead pane. */
export async function warnIfZCodeCannotOpenSession(): Promise<void> {
  // Why swallow: this is advisory. A probe that could not run must never interrupt a launch.
  const capability = await window.api.preflight.zcodeInteractiveCapability().catch(() => 'unknown')
  if (capability !== 'missing-tui') {
    return
  }
  toast.error(
    translate(
      'auto.components.terminal.pane.zcode.missing.tui.title',
      'This ZCode build has no terminal UI'
    ),
    {
      // Why a stable id: launching several ZCode panes must not stack the same notice.
      id: 'zcode-missing-tui',
      description: translate(
        'auto.components.terminal.pane.zcode.missing.tui.description',
        'This ZCode installation cannot open terminal sessions. Install a build with a terminal UI, then run zcode outside NASH to verify it.'
      ),
      duration: 20_000
    }
  )
}
