import { useState } from 'react'
import { ArrowUpRight, Loader2, RefreshCw, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import type { SettingsNavTarget } from '@/lib/settings-navigation-types'
import { refreshNashSetupSignals } from '../setup-guide/nash-setup-signal-cache'

// Actions for the NASH checklist steps (D-038). Each one opens the place where the step is done;
// the step itself completes from its own signal, never from the click.

function useOpenSettingsPane(): (pane: SettingsNavTarget) => void {
  const closeModal = useAppStore((s) => s.closeModal)
  const openSettingsPage = useAppStore((s) => s.openSettingsPage)
  const openSettingsTarget = useAppStore((s) => s.openSettingsTarget)
  return (pane) => {
    openSettingsTarget({ pane, repoId: null })
    closeModal()
    openSettingsPage()
  }
}

export function ClaudeCodeSetupAction(props: { done: boolean }): React.JSX.Element {
  const refreshDetectedAgents = useAppStore((s) => s.refreshDetectedAgents)
  const [checking, setChecking] = useState(false)

  const checkAgain = (): void => {
    setChecking(true)
    void refreshDetectedAgents()
      .catch(() => [])
      .then(() => refreshNashSetupSignals({ force: true }))
      .finally(() => setChecking(false))
  }

  return (
    <div className="flex flex-col gap-row">
      <p className="text-body text-muted-foreground">
        {props.done
          ? translate(
              'auto.components.feature.wall.FeatureWallSetupNashActions.claudeCodeFound',
              'Claude Code or Codex is installed on this computer.'
            )
          : translate(
              'auto.components.feature.wall.FeatureWallSetupNashActions.claudeCodeMissing',
              'Install Claude Code or Codex, sign in from a terminal, then check again.'
            )}
      </p>
      {props.done ? null : (
        <Button type="button" size="sm" className="w-fit" disabled={checking} onClick={checkAgain}>
          {checking ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
          {translate(
            'auto.components.feature.wall.FeatureWallSetupNashActions.checkAgain',
            'Check again'
          )}
        </Button>
      )}
    </div>
  )
}

export function ClefSetupAction(): React.JSX.Element {
  const openSettingsPane = useOpenSettingsPane()
  return (
    <Button
      type="button"
      size="sm"
      className="w-fit"
      onClick={() => openSettingsPane('task-routing')}
    >
      <Settings className="size-3.5" />
      {translate(
        'auto.components.feature.wall.FeatureWallSetupNashActions.openTaskRouting',
        'Open Task routing'
      )}
    </Button>
  )
}

export function DotSetupAction(): React.JSX.Element {
  const openSettingsPane = useOpenSettingsPane()
  return (
    <Button type="button" size="sm" className="w-fit" onClick={() => openSettingsPane('dot')}>
      <Settings className="size-3.5" />
      {translate(
        'auto.components.feature.wall.FeatureWallSetupNashActions.openDotSettings',
        'Open Dot settings'
      )}
    </Button>
  )
}

export function WorkbenchRunSetupAction(props: { done: boolean }): React.JSX.Element | null {
  const closeModal = useAppStore((s) => s.closeModal)
  const closeSettingsPage = useAppStore((s) => s.closeSettingsPage)
  const setRightSidebarTab = useAppStore((s) => s.setRightSidebarTab)
  const setRightSidebarOpen = useAppStore((s) => s.setRightSidebarOpen)
  if (props.done) {
    return null
  }

  const openWorkbench = (): void => {
    closeModal()
    // Why: the right sidebar is hidden on the Settings page, where the embedded checklist lives.
    if (useAppStore.getState().activeView === 'settings') {
      closeSettingsPage()
    }
    setRightSidebarTab('workbench')
    setRightSidebarOpen(true)
  }

  return (
    <Button type="button" size="sm" className="w-fit" onClick={openWorkbench}>
      <ArrowUpRight className="size-3.5" />
      {translate(
        'auto.components.feature.wall.FeatureWallSetupNashActions.openWorkbench',
        'Open the Workbench'
      )}
    </Button>
  )
}
