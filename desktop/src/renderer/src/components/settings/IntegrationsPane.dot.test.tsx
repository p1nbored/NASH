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
vi.mock('./clef-routing-card', () => ({ ClefRoutingCard: () => <div>Clef routing card</div> }))
vi.mock('./routing-table-card', () => ({ RoutingTableCard: () => <div>Routing Table card</div> }))
vi.mock('./dot-ingress-section', () => ({
  DotIngressSection: () => <div>Dot settings section</div>
}))

import { IntegrationsPane } from './IntegrationsPane'
import { getIntegrationsPaneSearchEntries } from './integrations-search'

describe('IntegrationsPane dot settings', () => {
  afterEach(() => {
    cleanup()
  })

  it('places the dot settings after the Task routing group', () => {
    render(<IntegrationsPane />)

    const text = document.body.textContent ?? ''
    expect(text.indexOf('Dot settings section')).toBeGreaterThan(text.indexOf('Clef routing card'))
    expect(screen.getByText('Dot settings section')).toBeTruthy()
  })

  it('lets settings search find the dot settings', () => {
    const entry = getIntegrationsPaneSearchEntries().find((item) => item.title === 'Tasks from dot')
    expect(entry).toBeDefined()
    expect(entry?.keywords).toEqual(
      expect.arrayContaining(['dot', 'workspace write', 'read only', 'rate limit'])
    )
  })

  it('lets settings search find remote access through GPT Sites', () => {
    const entry = getIntegrationsPaneSearchEntries().find(
      (item) => item.title === 'Remote access (GPT Sites)'
    )
    expect(entry).toBeDefined()
    expect(entry?.keywords).toEqual(
      expect.arrayContaining(['remote access', 'GPT Sites', 'pairing', 'access token'])
    )
  })
})
