// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./source-control-integration-cards', () => ({
  AzureDevOpsIntegrationCard: () => null,
  BitbucketIntegrationCard: () => null,
  GiteaIntegrationCard: () => null,
  GitHubIntegrationCard: () => null,
  GitLabIntegrationCard: () => null
}))
vi.mock('./task-tracker-integration-cards', () => ({
  JiraIntegrationCard: () => null,
  LinearIntegrationCard: () => null
}))
vi.mock('./use-integration-provider-status-refresh', () => ({
  useIntegrationProviderStatusRefresh: () => {}
}))
vi.mock('./clef-routing-card', () => ({
  ClefRoutingCard: () => <div>Clef routing card</div>
}))
vi.mock('./routing-table-card', () => ({
  RoutingTableCard: () => <div>Routing Table card</div>
}))

import { IntegrationsPane } from './IntegrationsPane'
import { getIntegrationsPaneSearchEntries } from './integrations-search'
import { TaskRoutingPane } from './TaskRoutingPane'
import { getTaskRoutingSearchEntries } from './task-routing-search'

describe('Task routing category', () => {
  afterEach(() => {
    cleanup()
  })

  it('keeps Integrations to source hosts and task trackers', () => {
    render(<IntegrationsPane />)

    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(headings).toEqual(['Review providers', 'Task providers'])
    expect(screen.queryByText('Clef routing card')).toBeNull()
    expect(screen.queryByText('Routing Table card')).toBeNull()
  })

  it('shows the Routing Table before the Clef classifier', () => {
    const { container } = render(<TaskRoutingPane />)

    const text = container.textContent ?? ''
    expect(text.indexOf('Routing Table card')).toBeGreaterThan(-1)
    expect(text.indexOf('Routing Table card')).toBeLessThan(text.indexOf('Clef routing card'))
  })

  it('lets settings search find the per-task agents under Task routing only', () => {
    const entry = getTaskRoutingSearchEntries().find(
      (item) => item.title === 'Agents for each task'
    )
    expect(entry).toBeDefined()
    expect(entry?.keywords).toEqual(expect.arrayContaining(['routing table', 'model', 'effort']))
    expect(entry?.keywords).not.toContain('proposal')
    expect(entry?.description).not.toMatch(/suggested changes/)
    expect(entry?.description).not.toMatch(/executor/)
    expect(getIntegrationsPaneSearchEntries().map((item) => item.title)).not.toContain(
      'Agents for each task'
    )
  })

  it('lets settings search find the classifier credentials under Task routing only', () => {
    const entry = getTaskRoutingSearchEntries().find((item) => item.title === 'Classifier')
    expect(entry).toBeDefined()
    expect(entry?.keywords).toEqual(
      expect.arrayContaining([
        'Classifier',
        'clef',
        'routing',
        'cloudflare',
        'api token',
        'account id'
      ])
    )
    expect(getIntegrationsPaneSearchEntries().map((item) => item.title)).not.toContain('Classifier')
  })
})
