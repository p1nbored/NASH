import { afterEach, describe, expect, it, vi } from 'vitest'
import { setTaskClassificationRuntime } from '../runtime/task-classification/classification-runtime'
import { setWorkbenchRoutingRuntime } from '../runtime/workbench-routing/workbench-routing-runtime'
import { setPrimarySessionRuntime } from '../runtime/workflow-run/primary-session-runtime'
import type { AccountChangeSource } from './autopilot-install-context'
import { fakeInstallPorts } from './autopilot-install-ports.test-fixture'
import {
  installAutopilotRuntime,
  type AutopilotRuntimeInstallation
} from './autopilot-runtime-install'
import { createFakeAutopilot, type FakeAutopilotOptions } from './autopilot-runtime.test-fixture'

// Route availability caches model listings and the CLI detection; an account switch must drop them,
// or a reading of the outgoing account would keep answering for the new one.

type Provider = Parameters<Parameters<AccountChangeSource['subscribe']>[0]>[0]

let installation: AutopilotRuntimeInstallation | null = null

afterEach(async () => {
  await installation?.shutdown()
  installation = null
  setTaskClassificationRuntime(null)
  setPrimarySessionRuntime(null)
  setWorkbenchRoutingRuntime(null)
})

/** FIXTURE_ONLY: stands in for the rate-limit service, where every account switch reports. */
function accountChangeSource() {
  const listeners = new Set<(provider: Provider) => void>()
  const subscribe = vi.fn((listener: (provider: Provider) => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  })
  return {
    source: { subscribe } satisfies AccountChangeSource,
    subscribe,
    emit(provider: Provider): void {
      for (const listener of listeners) {
        listener(provider)
      }
    },
    listening: (): number => listeners.size
  }
}

async function install(changes: AccountChangeSource, options: FakeAutopilotOptions = {}) {
  const fake = createFakeAutopilot(options)
  installation = await installAutopilotRuntime(
    { ...fakeInstallPorts(fake), accountChanges: changes },
    fake.builders
  )
  return { fake, installation }
}

const invalidations = (calls: readonly string[]): number =>
  calls.filter((call) => call === 'routing.invalidate').length

describe('route availability and account switches', () => {
  it('forgets the cached route readings each time the selected Claude or Codex account changes', async () => {
    const changes = accountChangeSource()
    const { fake } = await install(changes.source)
    expect(changes.subscribe).toHaveBeenCalledTimes(1)
    expect(invalidations(fake.calls)).toBe(0)
    changes.emit('claude')
    expect(invalidations(fake.calls)).toBe(1)
    changes.emit('codex')
    expect(invalidations(fake.calls)).toBe(2)
  })

  it('watches nothing when the routing table failed to install', async () => {
    const changes = accountChangeSource()
    const { fake } = await install(changes.source, { fail: 'createRoutingTable' })
    expect(changes.subscribe).not.toHaveBeenCalled()
    changes.emit('claude')
    expect(invalidations(fake.calls)).toBe(0)
  })

  it('stops watching at will-quit', async () => {
    const changes = accountChangeSource()
    const { fake, installation: installed } = await install(changes.source)
    await installed.shutdown()
    expect(changes.listening()).toBe(0)
    changes.emit('codex')
    expect(invalidations(fake.calls)).toBe(0)
  })

  it('installs without a source, as a host with no account services does', async () => {
    const fake = createFakeAutopilot()
    installation = await installAutopilotRuntime(fakeInstallPorts(fake), fake.builders)
    expect(installation.report.steps.every((step) => step.status === 'installed')).toBe(true)
  })
})
