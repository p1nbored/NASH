import React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { AgentStateDot, agentStateLabel, type AgentDotState } from './AgentStateDot'

vi.mock('@/components/StateIndicatorTooltip', async () => {
  const { createElement } = await import('react')
  return {
    StateIndicatorTooltip: ({
      label,
      children
    }: {
      label: string | null
      children: React.ReactElement
    }) =>
      label === null
        ? children
        : createElement('span', { 'data-state-indicator-tooltip': label }, children)
  }
})

function hexContrast(foreground: string, background: string): number {
  const luminance = (hex: string): number => {
    const [r, g, b] = [1, 3, 5]
      .map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
      .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (light + 0.05) / (dark + 0.05)
}

function renderMarkup(state: AgentDotState): string {
  return renderToStaticMarkup(React.createElement(AgentStateDot, { state }))
}

function renderDotClassNames(state: AgentDotState): string[] {
  const markup = renderMarkup(state)
  const dotClassName = markup.match(/<span class="([^"]*rounded-full[^"]*)"/)?.[1]

  expect(dotClassName).toBeDefined()

  return dotClassName!.split(/\s+/)
}

describe('AgentStateDot', () => {
  // Why: the glyph's non-text floor (3:1) is the guarantee; the token values are the theme's choice.
  it('keeps the question glyph above the non-text contrast floor on every sidebar surface', () => {
    const css = readFileSync(join(__dirname, '../assets/main.css'), 'utf8')
    for (const selector of [':root', '.dark']) {
      const start = css.indexOf(`\n${selector} {`)
      const body = css.slice(start, css.indexOf('\n}', start))
      const token = (name: string): string =>
        new RegExp(`\\n\\s*${name}:\\s*(#[0-9a-f]{6});`).exec(body)?.[1] ?? ''
      for (const surface of ['--background', '--worktree-sidebar', '--worktree-sidebar-accent']) {
        expect(
          hexContrast(token('--agent-question'), token(surface)),
          `${selector} ${surface}`
        ).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it('renders working as a yellow spinner', () => {
    const markup = renderMarkup('working')

    // The spinner's own classes and animation contract belong to AgentWorkingSpinner.test.tsx;
    // this pins only that 'working' reaches for it.
    expect(markup).toContain('data-agent-spinner')
  })

  it('renders monitoring as a static yellow heartbeat glyph', () => {
    const markup = renderMarkup('monitoring')

    expect(markup).toContain('aria-label="Monitoring background tasks"')
    expect(markup).toContain('lucide-activity')
    expect(markup).toContain('text-yellow-500')
    expect(markup).not.toContain('data-agent-spinner')
  })

  it('renders done as an emerald check icon', () => {
    const markup = renderMarkup('done')

    // Why: 'done' renders a CircleCheck icon rather than a dot so it is
    // visually distinct from other emerald-adjacent states across surfaces.
    // Note: the sidebar's StatusIndicator intentionally diverges and uses an
    // emerald dot for 'done'. Assertion targets the lucide 'circle-check'
    // class hook + emerald text color, identifying the check icon without
    // coupling to the exact SVG path markup lucide emits.
    expect(markup).toContain('lucide-circle-check')
    expect(markup).toContain('text-emerald-500')
  })

  it.each(['permission', 'waiting'] satisfies AgentDotState[])(
    'renders %s as the shared question glyph',
    (state) => {
      const markup = renderMarkup(state)

      expect(markup).toContain('lucide-message-circle-question-mark')
      // One token across sidebar, tabs, dashboard and map — never a raw hue.
      expect(markup).toContain('text-agent-question')
      expect(markup).not.toContain('text-amber-500')
      expect(markup).not.toContain('data-agent-spinner')
    }
  )

  it('renders unverifiable as an amber dashed ring, never the done check or the spinner', () => {
    const markup = renderMarkup('unverifiable')

    expect(markup).toContain('lucide-circle-dashed')
    expect(markup).toContain('text-amber-500')
    expect(markup).not.toContain('lucide-circle-check')
    expect(markup).not.toContain('data-agent-spinner')
  })

  it.each(['blocked', 'failed'] satisfies AgentDotState[])(
    'renders %s as a red attention dot',
    (state) => {
      const classNames = renderDotClassNames(state)

      expect(classNames).toContain('bg-red-500')
      expect(classNames).not.toContain('bg-amber-500')
    }
  )

  it("renders a user's Stop as a muted dot, neither the fault red nor the idle grey", () => {
    const classNames = renderDotClassNames('interrupted')

    expect(classNames).toContain('bg-muted-foreground')
    expect(classNames).not.toContain('bg-red-500')
    expect(classNames).not.toContain('bg-neutral-500/40')
  })

  const ALL_STATES = [
    'working',
    'monitoring',
    'blocked',
    'waiting',
    'interrupted',
    'failed',
    'done',
    'idle',
    'unverifiable',
    'unconfirmed',
    'permission'
  ] satisfies AgentDotState[]

  it.each(ALL_STATES)('labels %s with the shared hover tooltip', (state) => {
    const markup = renderMarkup(state)

    expect(markup).toContain(`data-state-indicator-tooltip="${agentStateLabel(state)}"`)
    expect(markup).not.toContain(' title=')
  })

  // Typecheck-time guard: a new AgentDotState member that ALL_STATES omits
  // fails `pnpm tc`, so the tooltip case above can never silently skip a state.
  type UncoveredState = Exclude<AgentDotState, (typeof ALL_STATES)[number]>
  const _allStatesAreCovered: UncoveredState extends never ? true : never = true
  void _allStatesAreCovered

  it('lets a caller override the tooltip', () => {
    const markup = renderToStaticMarkup(
      React.createElement(AgentStateDot, { state: 'done', title: 'Finished 2m ago' })
    )

    expect(markup).toContain('data-state-indicator-tooltip="Finished 2m ago"')
    expect(markup).not.toContain(' title=')
    expect(markup).toContain('aria-label="Done"')
  })

  it('lets a caller with an existing tooltip suppress the shared tooltip', () => {
    const markup = renderToStaticMarkup(
      React.createElement(AgentStateDot, { state: 'interrupted', title: null })
    )

    expect(markup).not.toContain('data-state-indicator-tooltip')
    expect(markup).toContain('aria-label="Interrupted"')
    expect(renderMarkup('interrupted')).toContain(
      `data-state-indicator-tooltip="${agentStateLabel('interrupted')}"`
    )
  })
})
