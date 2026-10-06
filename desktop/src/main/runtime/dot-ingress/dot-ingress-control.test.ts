import { afterEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationError } from '../orchestration/orchestration-error'
import {
  getDotIngressPort,
  type DotIngressControl,
  type DotIngressStatus
} from './dot-ingress-control'
import { thrownCodeOf } from './dot-ingress-transport.test-fixture'

const OFF: DotIngressStatus = { enabled: false, listening: false, failure: null }

function fakeControl(): DotIngressControl {
  return { sync: vi.fn(async () => OFF), status: vi.fn(() => OFF) }
}

describe('dot ingress control port', () => {
  afterEach(() => vi.restoreAllMocks())

  it('is one port per runtime object, and runtimes never share one', () => {
    const first = {}
    const second = {}

    expect(getDotIngressPort(first)).toBe(getDotIngressPort(first))
    expect(getDotIngressPort(first)).not.toBe(getDotIngressPort(second))
  })

  describe('the persisted switch', () => {
    it('reads off until a reader is installed', () => {
      expect(getDotIngressPort({}).readEnabled()).toBe(false)
    })

    it('asks the reader every time, so a change is seen at the next sync', () => {
      const port = getDotIngressPort({})
      let enabled = false
      port.installEnabledReader(() => enabled)

      expect(port.readEnabled()).toBe(false)
      enabled = true
      expect(port.readEnabled()).toBe(true)
      enabled = false
      expect(port.readEnabled()).toBe(false)
    })

    it('treats anything but a true boolean as off', () => {
      const port = getDotIngressPort({})
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: proves the port does not trust a reader that breaks its type.
      port.installEnabledReader(() => 1 as never)

      expect(port.readEnabled()).toBe(false)
    })

    it('keeps the interface off when the reader throws, and logs no error text', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const port = getDotIngressPort({})
      port.installEnabledReader(() => {
        throw new Error('unable to open C:\\Users\\fixture\\orchestration.db')
      })

      expect(port.readEnabled()).toBe(false)
      expect(warn).toHaveBeenCalledTimes(1)
      expect(JSON.stringify(warn.mock.calls)).not.toContain('fixture')
    })
  })

  describe('the control', () => {
    it('is unavailable until the RPC server installs it, with a Workbench-prefixed code', () => {
      const port = getDotIngressPort({})

      expect(thrownCodeOf(() => port.requireControl())).toBe('workbench_dot_ingress_unavailable')
      try {
        port.requireControl()
        expect.unreachable('the control must be unavailable')
      } catch (error) {
        expect(error).toBeInstanceOf(OrchestrationError)
      }
    })

    it('returns the installed control, and a later install replaces it', () => {
      const port = getDotIngressPort({})
      const first = fakeControl()
      const second = fakeControl()

      port.installControl(first)
      expect(port.requireControl()).toBe(first)
      port.installControl(second)
      expect(port.requireControl()).toBe(second)
    })

    it('uninstalls only the control it was given, so a stale server cannot remove a newer one', () => {
      const port = getDotIngressPort({})
      const stale = fakeControl()
      const current = fakeControl()
      port.installControl(current)

      port.uninstallControl(stale)
      expect(port.requireControl()).toBe(current)
      port.uninstallControl(current)
      expect(thrownCodeOf(() => port.requireControl())).toBe('workbench_dot_ingress_unavailable')
    })
  })
})
