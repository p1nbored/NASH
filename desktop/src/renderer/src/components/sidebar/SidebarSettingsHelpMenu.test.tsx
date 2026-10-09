// @vitest-environment happy-dom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SidebarSettingsHelpMenu } from './SidebarSettingsHelpMenu'

const mocks = vi.hoisted(() => {
  const feed: { updateFeed: unknown } = { updateFeed: null }
  return {
    openModal: vi.fn(),
    openSettingsPage: vi.fn(),
    openSettingsTarget: vi.fn(),
    appRestart: vi.fn(),
    updaterCheck: vi.fn(),
    shellOpenUrl: vi.fn(),
    useShortcutKeyDetails: vi.fn(),
    /** Counts evaluations of the feedback chunk; a dynamic import evaluates it exactly once. */
    feedbackChunkLoads: 0,
    ...feed,
    setupProgress: {
      ready: true,
      coreDoneCount: 2,
      coreTotal: 5,
      stepDone: {}
    }
  }
})

let updateStatus = { state: 'idle' } as const
const roots: Root[] = []

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: unknown) => unknown) =>
    selector({
      openModal: mocks.openModal,
      openSettingsPage: mocks.openSettingsPage,
      openSettingsTarget: mocks.openSettingsTarget,
      updateStatus
    })
}))

vi.mock('../../../../shared/app-update-feed', () => ({
  getAppUpdateFeed: () => mocks.updateFeed
}))

vi.mock('@/hooks/useShortcutLabel', () => ({
  useShortcutKeyDetails: mocks.useShortcutKeyDetails
}))

vi.mock('@/hooks/useMountedRef', () => ({
  useMountedRef: () => ({ current: true })
}))

vi.mock('../onboarding/show-onboarding-event', () => ({
  showOnboardingFromRenderer: vi.fn()
}))

vi.mock('../setup-guide/use-setup-guide-progress', () => ({
  useSetupGuideProgress: () => mocks.setupProgress
}))

vi.mock('../setup-guide/SetupGuideProgressRing', () => ({
  SetupGuideProgressRing: () => <span data-testid="setup-guide-progress-ring" />
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({
    children,
    onOpenChange
  }: {
    children: ReactNode
    onOpenChange?: (open: boolean) => void
  }) => (
    <>
      <button data-testid="open-menu" onClick={() => onOpenChange?.(true)} />
      {children}
    </>
  ),
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuItem: ({
    children,
    disabled,
    onPointerDown,
    onSelect,
    title
  }: {
    children: ReactNode
    disabled?: boolean
    onPointerDown?: (event: React.PointerEvent<HTMLButtonElement>) => void
    onSelect?: (event: Event) => void
    title?: string
  }) => (
    <button
      data-testid="menu-item"
      disabled={disabled}
      onClick={() => onSelect?.(new Event('menu.itemSelect'))}
      onPointerDown={onPointerDown}
      title={title}
    >
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    'aria-label': ariaLabel
  }: {
    children: ReactNode
    onClick?: (event: React.MouseEvent) => void
    'aria-label'?: string
  }) => (
    <button data-testid="trigger-button" aria-label={ariaLabel} onClick={onClick}>
      {children}
    </button>
  )
}))

vi.mock('sonner', () => ({
  toast: {
    info: vi.fn(),
    error: vi.fn()
  }
}))

vi.mock('./SidebarFeedbackDialog', () => {
  mocks.feedbackChunkLoads += 1
  return { SidebarFeedbackDialog: () => <div data-testid="feedback-dialog" /> }
})

function installWindowApi(): void {
  Object.assign(window, {
    api: {
      app: {
        restart: mocks.appRestart
      },
      shell: {
        openUrl: mocks.shellOpenUrl
      },
      updater: {
        check: mocks.updaterCheck
      }
    }
  })
}

async function renderMenu(): Promise<HTMLDivElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(<SidebarSettingsHelpMenu />)
  })

  return container
}

function findMenuItem(container: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(
    container.querySelectorAll<HTMLButtonElement>('[data-testid="menu-item"]')
  ).find((element) => element.textContent?.includes(label))
  expect(button).toBeDefined()
  return button as HTMLButtonElement
}

describe('SidebarSettingsHelpMenu', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    vi.clearAllMocks()
    installWindowApi()
    mocks.useShortcutKeyDetails.mockReturnValue({ keys: ['⌘', ','], doubleTap: false })
    updateStatus = { state: 'idle' }
    mocks.updateFeed = null
    mocks.setupProgress = {
      ready: true,
      coreDoneCount: 2,
      coreTotal: 5,
      stepDone: {}
    }
  })

  afterEach(() => {
    roots.splice(0).forEach((root) => {
      act(() => root.unmount())
    })
    document.body.replaceChildren()
  })

  it('renders the help button with correct aria-label', () => {
    const html = renderToStaticMarkup(<SidebarSettingsHelpMenu />)
    expect(html).toContain('Help')
  })

  it('renders the settings button with correct aria-label', () => {
    const html = renderToStaticMarkup(<SidebarSettingsHelpMenu />)
    expect(html).toContain('aria-label="Settings"')
  })

  it('renders the settings button before the help button', () => {
    const html = renderToStaticMarkup(<SidebarSettingsHelpMenu />)
    const settingsIndex = html.indexOf('lucide-settings')
    const helpIndex = html.indexOf('lucide-circle-question-mark')
    expect(settingsIndex).toBeGreaterThanOrEqual(0)
    expect(helpIndex).toBeGreaterThan(settingsIndex)
  })

  it('offers feedback through NASH GitHub Issues', () => {
    const html = renderToStaticMarkup(<SidebarSettingsHelpMenu />)
    expect(html).toContain('Send Feedback')
  })

  it('renders Keyboard Shortcuts menu item', () => {
    const html = renderToStaticMarkup(<SidebarSettingsHelpMenu />)
    expect(html).toContain('Keyboard Shortcuts')
  })

  it('renders Milestones with progress when setup is incomplete', () => {
    const html = renderToStaticMarkup(<SidebarSettingsHelpMenu />)
    expect(html).toContain('Milestones')
    expect(html).toContain('data-testid="setup-guide-progress-ring"')
  })

  it('hides Milestones when setup is complete', () => {
    mocks.setupProgress = {
      ready: true,
      coreDoneCount: 5,
      coreTotal: 5,
      stepDone: {}
    }
    const html = renderToStaticMarkup(<SidebarSettingsHelpMenu />)
    expect(html).not.toContain('Milestones')
  })

  it('renders the Onboarding menu item by default', () => {
    const html = renderToStaticMarkup(<SidebarSettingsHelpMenu />)
    expect(html).toContain('Onboarding')
  })

  it('renders Restart NASH by default', () => {
    const html = renderToStaticMarkup(<SidebarSettingsHelpMenu />)
    expect(html).toContain('Restart NASH')
  })

  it('links only to the NASH repository, never to Orca, Discord or X (D-036)', () => {
    const html = renderToStaticMarkup(<SidebarSettingsHelpMenu />)
    expect(html).toContain('Report an issue')
    expect(html).toContain('Source')
    for (const removed of ['Docs', 'Changelog', 'Discord', '>X<', 'GitHub']) {
      expect(html).not.toContain(removed)
    }
  })

  it('opens a new NASH issue through the shell bridge', async () => {
    const container = await renderMenu()

    await act(async () => {
      findMenuItem(container, 'Report an issue').click()
    })

    expect(mocks.shellOpenUrl).toHaveBeenCalledWith('https://github.com/p1nbored/NASH/issues/new')
  })

  it('opens the NASH source repository through the shell bridge', async () => {
    const container = await renderMenu()

    await act(async () => {
      findMenuItem(container, 'Source').click()
    })

    expect(mocks.shellOpenUrl).toHaveBeenCalledWith('https://github.com/p1nbored/NASH')
  })

  it('hides Check for Updates while the build has no update feed (D-026)', () => {
    const html = renderToStaticMarkup(<SidebarSettingsHelpMenu />)
    expect(html).not.toContain('Check for Updates')
  })

  it('renders Check for Updates menu item when the build has an update feed', () => {
    mocks.updateFeed = { owner: 'example', repo: 'nash-releases', whatsNew: null }
    const html = renderToStaticMarkup(<SidebarSettingsHelpMenu />)
    expect(html).toContain('Check for Updates')
    expect(html).toMatch(/(⇧\+click|Shift\+click) checks the latest RC/)
    expect(html).toMatch(/(⌘\+click|Ctrl\+click) checks the latest perf build/)
  })

  it('passes update-check modifier options through the updater bridge', async () => {
    mocks.updateFeed = { owner: 'example', repo: 'nash-releases', whatsNew: null }
    const container = await renderMenu()
    const checkButton = findMenuItem(container, 'Check for Updates')
    const primaryModifier = navigator.userAgent.includes('Mac')
      ? { metaKey: true }
      : { ctrlKey: true }

    await act(async () => {
      checkButton.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, shiftKey: true }))
      checkButton.click()
    })
    await act(async () => {
      checkButton.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, ...primaryModifier })
      )
      checkButton.click()
    })
    await act(async () => {
      checkButton.click()
    })

    expect(mocks.updaterCheck).toHaveBeenNthCalledWith(1, {
      includePrerelease: true,
      includePerfPrerelease: false
    })
    expect(mocks.updaterCheck).toHaveBeenNthCalledWith(2, {
      includePrerelease: false,
      includePerfPrerelease: true
    })
    expect(mocks.updaterCheck).toHaveBeenNthCalledWith(3, {
      includePrerelease: false,
      includePerfPrerelease: false
    })
  })

  it('loads the restored feedback form when the menu opens', async () => {
    const container = await renderMenu()

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="open-menu"]')?.click()
    })

    expect(mocks.feedbackChunkLoads).toBeGreaterThan(0)
    expect(container.textContent).toContain('Send Feedback')
    expect(document.body.querySelector('[data-testid="feedback-dialog"]')).toBeNull()
  })

  it('renders shortcut keys in the settings tooltip', () => {
    const html = renderToStaticMarkup(<SidebarSettingsHelpMenu />)
    expect(html).toContain('⌘')
    expect(html).toContain('>,</span>')
  })
})
