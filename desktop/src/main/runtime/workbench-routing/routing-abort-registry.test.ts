import { describe, expect, it } from 'vitest'
import { createRoutingAbortRegistry } from './routing-abort-registry'

describe('routing abort registry', () => {
  it('hands out one controller per in-flight request and refuses a second', () => {
    const registry = createRoutingAbortRegistry()
    const first = registry.begin('request-1')
    expect(first).toBeInstanceOf(AbortController)
    expect(registry.begin('request-1')).toBeNull()
    expect(registry.begin('request-2')).toBeInstanceOf(AbortController)
  })

  it('aborts only the named request and reports whether one was running', () => {
    const registry = createRoutingAbortRegistry()
    const one = registry.begin('request-1')
    const two = registry.begin('request-2')
    expect(registry.abort('request-1')).toBe(true)
    expect(one?.signal.aborted).toBe(true)
    expect(two?.signal.aborted).toBe(false)
    expect(registry.abort('missing')).toBe(false)
  })

  it('frees the slot when the run ends, so a later claim can route again', () => {
    const registry = createRoutingAbortRegistry()
    const first = registry.begin('request-1')
    expect(first).not.toBeNull()
    if (first) {
      registry.end('request-1', first)
    }
    expect(registry.has('request-1')).toBe(false)
    expect(registry.begin('request-1')).not.toBeNull()
  })

  it('does not let a finished run free a newer run of the same request', () => {
    const registry = createRoutingAbortRegistry()
    const stale = registry.begin('request-1')
    if (stale) {
      registry.end('request-1', stale)
    }
    const current = registry.begin('request-1')
    if (stale) {
      registry.end('request-1', stale)
    }
    expect(registry.has('request-1')).toBe(true)
    expect(registry.abort('request-1')).toBe(true)
    expect(current?.signal.aborted).toBe(true)
  })

  it('aborts every in-flight request on shutdown and returns how many it stopped', () => {
    const registry = createRoutingAbortRegistry()
    const controllers = ['a', 'b', 'c'].map((id) => registry.begin(id))
    expect(registry.abortAll()).toBe(3)
    expect(controllers.every((controller) => controller?.signal.aborted)).toBe(true)
  })
})
