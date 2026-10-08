// @vitest-environment happy-dom

import { act, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PluginSettingsOverview } from './PluginSettingsOverview'

const mocks = vi.hoisted(() => ({ browserMounts: 0 }))

vi.mock('./PluginMarketplaceBrowser', () => ({
  PluginMarketplaceBrowser: () => {
    useEffect(() => {
      mocks.browserMounts += 1
    }, [])
    return <div>marketplace</div>
  }
}))
vi.mock('./PluginDevelopmentSection', () => ({ PluginDevelopmentSection: () => null }))

function overview(orcaCatalogEnabled: boolean): React.JSX.Element {
  return (
    <PluginSettingsOverview
      featureEnabled
      featureBusy={false}
      settingsError={null}
      loading={false}
      error={null}
      plugins={[]}
      busyPluginKeys={new Set()}
      openLogs={new Set()}
      logsByPlugin={{}}
      devPaths={[]}
      devPathsBusy={false}
      orcaCatalogEnabled={orcaCatalogEnabled}
      onSetOrcaCatalog={vi.fn().mockResolvedValue(undefined)}
      onToggleFeature={vi.fn()}
      onRefresh={vi.fn().mockResolvedValue(undefined)}
      onReview={vi.fn()}
      onToggleEnabled={vi.fn()}
      onToggleLogs={vi.fn()}
      onMarketplaceInstalled={vi.fn().mockResolvedValue(undefined)}
      onRollbackRequest={vi.fn()}
      onRemoveRequest={vi.fn()}
      onUpdateDevPaths={vi.fn().mockResolvedValue(undefined)}
    />
  )
}

afterEach(() => {
  document.body.innerHTML = ''
  mocks.browserMounts = 0
})

describe('PluginSettingsOverview', () => {
  it('reloads the marketplace browser when the Orca plugin catalog switch changes', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => root.render(overview(false)))
    expect(container.querySelector('[aria-labelledby="orca-plugin-catalog-label"]')).toBeTruthy()
    expect(mocks.browserMounts).toBe(1)

    await act(async () => root.render(overview(true)))

    // Why: the browser loads sources once on mount; Orca's marketplace appears only after a reload.
    expect(mocks.browserMounts).toBe(2)
    act(() => root.unmount())
  })
})
