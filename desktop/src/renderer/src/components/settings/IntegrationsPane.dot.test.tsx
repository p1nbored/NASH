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
vi.mock('./dot-ingress-section', () => ({
  DotIngressSection: () => <div>Dot settings section</div>
}))

import { IntegrationsPane } from './IntegrationsPane'
import { getDotIngressSearchEntries } from './dot-ingress-search'
import { getIntegrationsPaneSearchEntries } from './integrations-search'

describe('Dot category (D-038)', () => {
  afterEach(() => {
    cleanup()
  })

  it('no longer renders the dot settings inside Integrations', () => {
    render(<IntegrationsPane />)

    expect(screen.queryByText('Dot settings section')).toBeNull()
  })

  it('lets settings search find the dot settings outside Integrations', () => {
    const entry = getDotIngressSearchEntries().find((item) => item.title === 'Tasks from dot')
    expect(entry).toBeDefined()
    expect(entry?.keywords).toEqual(
      expect.arrayContaining(['dot', 'workspace write', 'read only', 'rate limit'])
    )
    expect(getIntegrationsPaneSearchEntries().map((item) => item.title)).not.toContain(
      'Tasks from dot'
    )
  })

  it('lets settings search find remote access through GPT Sites', () => {
    const entry = getDotIngressSearchEntries().find((item) => item.title === 'Remote access')
    expect(entry).toBeDefined()
    expect(entry?.keywords).toEqual(
      expect.arrayContaining(['remote access', 'GPT Sites', 'pairing', 'access token'])
    )
    expect(entry?.description).toContain('Site address')
  })
})
