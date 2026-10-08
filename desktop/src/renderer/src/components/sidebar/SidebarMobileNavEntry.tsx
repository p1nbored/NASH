import React from 'react'
import { EyeOff, Smartphone } from 'lucide-react'
import { useAppStore } from '@/store'
import { cn } from '@/lib/utils'
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { useMobileSidebarOnboardingBadge } from './mobile-sidebar-onboarding-badge'
import { HideSidebarMenu } from './sidebar-nav-controls'

/** The Orca Mobile row; SidebarNav mounts it only while Orca Mobile is shown (D-038). */
export function SidebarMobileNavEntry(): React.JSX.Element {
  const openMobilePage = useAppStore((s) => s.openMobilePage)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const mobileActive = useAppStore((s) => s.activeView === 'mobile')
  const mobileOnboardingBadge = useMobileSidebarOnboardingBadge(true)
  const hideMobileButton = React.useCallback(() => {
    void updateSettings({ showMobileButton: false })
  }, [updateSettings])

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={cn(
            'group flex w-full items-center rounded-md text-[13px] font-medium tracking-tight transition-colors',
            mobileActive
              ? 'bg-worktree-sidebar-accent text-worktree-sidebar-accent-foreground'
              : 'text-worktree-sidebar-foreground/60 hover:bg-worktree-sidebar-foreground/8'
          )}
        >
          <button
            type="button"
            onClick={() => {
              mobileOnboardingBadge.dismiss()
              openMobilePage()
            }}
            aria-current={mobileActive ? 'page' : undefined}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left"
          >
            <Smartphone
              className={cn(
                'size-4 shrink-0',
                !mobileActive && 'text-worktree-sidebar-foreground/30'
              )}
              strokeWidth={mobileActive ? 2.25 : 1.75}
            />
            <span className="min-w-0 flex-1 truncate">
              {translate('auto.components.sidebar.SidebarNav.1b5c41caee', 'Orca Mobile')}
            </span>
            {mobileOnboardingBadge.visible ? (
              <span className="shrink-0 rounded-full bg-primary px-1.5 py-px text-[10px] font-semibold text-primary-foreground">
                {translate('auto.components.sidebar.SidebarNav.c86d83b5c3', 'New')}
              </span>
            ) : null}
          </button>
          {mobileOnboardingBadge.hasPairedDevice ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className={cn(
                    'mr-1 text-worktree-sidebar-foreground/55 hover:bg-worktree-sidebar-foreground/10 hover:text-worktree-sidebar-foreground',
                    mobileActive &&
                      'text-worktree-sidebar-accent-foreground/70 hover:text-worktree-sidebar-accent-foreground'
                  )}
                  onClick={(event) => {
                    event.stopPropagation()
                    hideMobileButton()
                  }}
                  aria-label={translate(
                    'auto.components.sidebar.SidebarNav.d599269755',
                    'Hide from sidebar'
                  )}
                >
                  <EyeOff className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={4}>
                {translate('auto.components.sidebar.SidebarNav.d599269755', 'Hide from sidebar')}
              </TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      </ContextMenuTrigger>
      <HideSidebarMenu onHide={hideMobileButton} />
    </ContextMenu>
  )
}
