// Design-review harness entry. Installs a fixture-only preload API before the
// real renderer bootstrap evaluates, so captures show actual Orca components
// without Electron, a runtime daemon, PTYs or any user state. Every value the
// fixture returns is synthetic and labeled FIXTURE_ONLY in the capture manifest.
import { installFixtureApi } from './fixture-api'
import { createBaseFixtures } from './base-fixtures'
import {
  createWorkspaceScenarioFixtures,
  seedWorkspaceScenarioStorage,
  type HarnessDirection,
  type HarnessTheme
} from './scenario-workspace'
import { createSettingsScenarioFixtures } from './scenario-settings'

const params = new URLSearchParams(window.location.search)
const theme: HarnessTheme = params.get('theme') === 'dark' ? 'dark' : 'light'

// Set by the capture script through addInitScript; absent means Orca's own theme.
const direction = (window as { __designDirection?: HarnessDirection }).__designDirection ?? null

seedWorkspaceScenarioStorage(theme, direction)
const base = createBaseFixtures()
const scenario = createWorkspaceScenarioFixtures()
const settings = createSettingsScenarioFixtures(window.location.search)
installFixtureApi({
  ...base,
  ...scenario,
  clefCredentials: settings.clefCredentials,
  runtime: {
    ...base.runtime,
    ...scenario.runtime,
    call: settings.wrapRuntimeCall(scenario.runtime?.call)
  } as typeof base.runtime
})
await import('@renderer/main')

if (direction) {
  // Why after main: the exploration sheet must follow main.css in cascade order.
  const style = document.createElement('style')
  style.dataset.designDirection = direction.id
  style.textContent = direction.css
  document.head.append(style)
}
