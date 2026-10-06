import { beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'

const {
  constructDatabase,
  ensureRelay,
  scheduleRepoints,
  resetFederation,
  clearRepoints,
  getPath
} = vi.hoisted(() => ({
  constructDatabase: vi.fn(),
  ensureRelay: vi.fn(),
  scheduleRepoints: vi.fn(),
  resetFederation: vi.fn(),
  clearRepoints: vi.fn(),
  getPath: vi.fn()
}))

vi.mock('./orca-runtime-pty-foreground-process-reads', () => ({
  OrcaRuntimeWithPtyForegroundProcessReads: class {
    protected _orchestrationDb: unknown = null
    protected orchestrationFederation = { resetForDatabaseChange: resetFederation }
    protected mailPointerRepointScheduler = { clear: clearRepoints }
    protected ensureOrchestrationFederationRelay = ensureRelay
    protected scheduleRestoredMessageRepoints = scheduleRepoints
  }
}))
vi.mock('./orchestration/db', () => ({
  OrchestrationDb: class {
    constructor(path: string) {
      constructDatabase(path)
    }
  }
}))
vi.mock('../../shared/app-environment', () => ({ getAppEnvironment: () => ({ getPath }) }))

import { OrcaRuntimeWithAutomationOperations } from './orca-runtime-automation-operations'

describe('passive orchestration database acquisition', () => {
  beforeEach(() => {
    constructDatabase.mockReset()
    ensureRelay.mockReset()
    scheduleRepoints.mockReset()
    resetFederation.mockReset()
    clearRepoints.mockReset()
    getPath.mockReset().mockReturnValue('fixture-profile')
  })

  it('opens one shared database without starting delivery when acquired passively', () => {
    const runtime = new OrcaRuntimeWithAutomationOperations()
    const database = runtime.getOrchestrationDb({ passive: true })
    expect(runtime.getOrchestrationDb({ passive: true })).toBe(database)
    expect(getPath).toHaveBeenCalledExactlyOnceWith('userData')
    expect(constructDatabase).toHaveBeenCalledExactlyOnceWith(
      join('fixture-profile', 'orchestration.db')
    )
    expect(ensureRelay).not.toHaveBeenCalled()
    expect(scheduleRepoints).not.toHaveBeenCalled()
  })

  it('starts delivery once on the same database after passive acquisition', () => {
    const runtime = new OrcaRuntimeWithAutomationOperations()
    const database = runtime.getOrchestrationDb({ passive: true })
    expect(runtime.getOrchestrationDb()).toBe(database)
    expect(runtime.getOrchestrationDb()).toBe(database)
    expect(runtime.getOrchestrationDb({ passive: true })).toBe(database)
    expect(constructDatabase).toHaveBeenCalledTimes(1)
    expect(ensureRelay).toHaveBeenCalledTimes(1)
    expect(scheduleRepoints).toHaveBeenCalledTimes(1)
  })

  it('retains normal first-acquisition delivery and fences reentrant acquisition', () => {
    const runtime = new OrcaRuntimeWithAutomationOperations()
    let reentrantDatabase: unknown
    ensureRelay.mockImplementation(() => {
      reentrantDatabase = runtime.getOrchestrationDb()
    })
    const database = runtime.getOrchestrationDb()
    expect(reentrantDatabase).toBe(database)
    expect(runtime.getOrchestrationDb()).toBe(database)
    expect(constructDatabase).toHaveBeenCalledTimes(1)
    expect(ensureRelay).toHaveBeenCalledTimes(1)
    expect(scheduleRepoints).toHaveBeenCalledTimes(1)
  })

  it.each(['relay', 'repoints'])(
    'retries failed %s initialization without replacing the database',
    (stage) => {
      const runtime = new OrcaRuntimeWithAutomationOperations()
      const database = runtime.getOrchestrationDb({ passive: true })
      const failingStep = stage === 'relay' ? ensureRelay : scheduleRepoints
      failingStep.mockImplementationOnce(() => {
        throw new Error('Fixture initialization failed.')
      })
      expect(() => runtime.getOrchestrationDb()).toThrow('Fixture initialization failed.')
      expect(runtime.getOrchestrationDb({ passive: true })).toBe(database)
      expect(ensureRelay).toHaveBeenCalledTimes(1)
      expect(scheduleRepoints).toHaveBeenCalledTimes(stage === 'relay' ? 0 : 1)
      expect(runtime.getOrchestrationDb()).toBe(database)
      expect(runtime.getOrchestrationDb()).toBe(database)
      expect(constructDatabase).toHaveBeenCalledTimes(1)
      expect(ensureRelay).toHaveBeenCalledTimes(2)
      expect(scheduleRepoints).toHaveBeenCalledTimes(stage === 'relay' ? 1 : 2)
    }
  )

  it('allows retry when database construction itself fails', () => {
    const runtime = new OrcaRuntimeWithAutomationOperations()
    constructDatabase.mockImplementationOnce(() => {
      throw new Error('Fixture construction failed.')
    })
    expect(() => runtime.getOrchestrationDb({ passive: true })).toThrow(
      'Fixture construction failed.'
    )
    const database = runtime.getOrchestrationDb({ passive: true })
    expect(runtime.getOrchestrationDb({ passive: true })).toBe(database)
    expect(constructDatabase).toHaveBeenCalledTimes(2)
    expect(ensureRelay).not.toHaveBeenCalled()
    expect(scheduleRepoints).not.toHaveBeenCalled()
  })

  it('preserves injection reset, clear and immediate delivery on the injected database', () => {
    const donor = new OrcaRuntimeWithAutomationOperations()
    const database = donor.getOrchestrationDb({ passive: true })
    const runtime = new OrcaRuntimeWithAutomationOperations()
    ensureRelay.mockImplementation(() => {
      expect(runtime.getOrchestrationDb()).toBe(database)
    })
    runtime.setOrchestrationDb(database)
    expect(resetFederation).toHaveBeenCalledTimes(1)
    expect(clearRepoints).toHaveBeenCalledTimes(1)
    expect(resetFederation.mock.invocationCallOrder[0]).toBeLessThan(
      clearRepoints.mock.invocationCallOrder[0]
    )
    expect(clearRepoints.mock.invocationCallOrder[0]).toBeLessThan(
      ensureRelay.mock.invocationCallOrder[0]
    )
    expect(ensureRelay.mock.invocationCallOrder[0]).toBeLessThan(
      scheduleRepoints.mock.invocationCallOrder[0]
    )
    expect(runtime.getOrchestrationDb()).toBe(database)
    expect(constructDatabase).toHaveBeenCalledTimes(1)
    expect(ensureRelay).toHaveBeenCalledTimes(1)
    expect(scheduleRepoints).toHaveBeenCalledTimes(1)
  })

  it.each(['relay', 'repoints'])(
    'retries failed injected %s initialization on the injected database',
    (stage) => {
      const database = new OrcaRuntimeWithAutomationOperations().getOrchestrationDb({
        passive: true
      })
      const runtime = new OrcaRuntimeWithAutomationOperations()
      const failingStep = stage === 'relay' ? ensureRelay : scheduleRepoints
      failingStep.mockImplementationOnce(() => {
        throw new Error('Fixture injected initialization failed.')
      })
      expect(() => runtime.setOrchestrationDb(database)).toThrow(
        'Fixture injected initialization failed.'
      )
      expect(runtime.getOrchestrationDb({ passive: true })).toBe(database)
      expect(runtime.getOrchestrationDb()).toBe(database)
      expect(runtime.getOrchestrationDb()).toBe(database)
      expect(resetFederation).toHaveBeenCalledTimes(1)
      expect(clearRepoints).toHaveBeenCalledTimes(1)
      expect(constructDatabase).toHaveBeenCalledTimes(1)
      expect(ensureRelay).toHaveBeenCalledTimes(2)
      expect(scheduleRepoints).toHaveBeenCalledTimes(stage === 'relay' ? 1 : 2)
    }
  )
})
