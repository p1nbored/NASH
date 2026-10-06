// @vitest-environment happy-dom
import { cleanup, render, screen, within } from '@testing-library/react'
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
vi.mock('./dot-ingress-section', () => ({ DotIngressSection: () => null }))

import { IntegrationsPane } from './IntegrationsPane'
import { getIntegrationsPaneSearchEntries } from './integrations-search'

describe('IntegrationsPane task routing group', () => {
  afterEach(() => {
    cleanup()
  })

  it('adds a Task routing group with the Clef card after the existing groups', () => {
    render(<IntegrationsPane />)

    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(headings).toEqual(['Review providers', 'Task providers', 'Task routing'])
    const group = screen.getByRole('heading', { name: 'Task routing' }).closest('section')
    if (!(group instanceof HTMLElement)) {
      throw new Error('Task routing section is missing')
    }
    expect(within(group).getByText('Clef routing card')).toBeTruthy()
  })

  it('shows the Routing Table before the Clef classifier in the Task routing group', () => {
    render(<IntegrationsPane />)

    const group = screen.getByRole('heading', { name: 'Task routing' }).closest('section')
    const text = group?.textContent ?? ''
    expect(text.indexOf('Routing Table card')).toBeGreaterThan(-1)
    expect(text.indexOf('Routing Table card')).toBeLessThan(text.indexOf('Clef routing card'))
    expect(text).toMatch(/Clef classifies/)
  })

  it('lets settings search find the Routing Table', () => {
    const entry = getIntegrationsPaneSearchEntries().find((item) => item.title === 'Routing Table')
    expect(entry).toBeDefined()
    expect(entry?.keywords).toEqual(
      expect.arrayContaining(['routing table', 'model', 'reasoning', 'proposal'])
    )
  })

  it('lets settings search find the Clef routing credentials', () => {
    const entry = getIntegrationsPaneSearchEntries().find((item) => item.title === 'Clef routing')
    expect(entry).toBeDefined()
    expect(entry?.keywords).toEqual(
      expect.arrayContaining(['clef', 'routing', 'cloudflare', 'api token', 'account id'])
    )
  })
})
