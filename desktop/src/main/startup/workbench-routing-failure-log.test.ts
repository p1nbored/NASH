import { describe, expect, it, vi } from 'vitest'
import { createRoutingFailureLogger } from './workbench-routing-failure-log'

// FIXTURE_ONLY values: invented, shaped like the real ones so the redactor's rules are exercised.
const FIXTURE_ACCOUNT_ID = '0123456789abcdef0123456789abcdef'
const FIXTURE_TOKEN = 'FIXTUREONLYtoken0123456789ABCDEFGHIJKL'

function logged(error: unknown): string {
  const sink = vi.fn()
  createRoutingFailureLogger(sink)(error)
  expect(sink).toHaveBeenCalledTimes(1)
  return JSON.stringify(sink.mock.calls[0])
}

describe('createRoutingFailureLogger', () => {
  it('logs the error class and a bounded message under the routing scope', () => {
    const sink = vi.fn()
    createRoutingFailureLogger(sink)(new TypeError('the decision row was malformed'))
    expect(sink).toHaveBeenCalledWith('[workbench-routing] router failure', {
      name: 'TypeError',
      code: null,
      message: 'the decision row was malformed',
      causes: []
    })
  })

  it('keeps a plain system code and drops one that is not', () => {
    const withCode = Object.assign(new Error('disk is busy'), { code: 'EBUSY' })
    expect(logged(withCode)).toContain('"code":"EBUSY"')
    const hostile = Object.assign(new Error('x'), { code: `${FIXTURE_TOKEN} with spaces` })
    expect(logged(hostile)).not.toContain(FIXTURE_TOKEN)
  })

  it('redacts a token, an account path and a bearer header from the message', () => {
    const text = logged(
      new Error(
        `request to /client/v4/accounts/${FIXTURE_ACCOUNT_ID}/ai/run failed: Authorization: Bearer ${FIXTURE_TOKEN}`
      )
    )
    expect(text).not.toContain(FIXTURE_ACCOUNT_ID)
    expect(text).not.toContain(FIXTURE_TOKEN)
  })

  it('redacts secrets that sit in nested causes and caps how many are read', () => {
    const root = new Error(`root cause with ${FIXTURE_TOKEN}`)
    let chained: Error = root
    for (let depth = 0; depth < 6; depth += 1) {
      chained = new Error(`wrapper ${depth}`, { cause: chained })
    }
    const text = logged(chained)
    expect(text).not.toContain(FIXTURE_TOKEN)
    expect(JSON.parse(text)[1].causes.length).toBeLessThanOrEqual(3)
  })

  it('never logs a stack, because a stack repeats the message and its file paths', () => {
    const text = logged(new Error('boom'))
    expect(text).not.toMatch(/\sat\s|\.ts:\d+/)
    expect(text).not.toContain('stack')
  })

  it.each([undefined, null, 42, 'a bare string', { code: 'x', token: FIXTURE_TOKEN }, Symbol('s')])(
    'describes a thrown value that is not an Error without reading its fields: %s',
    (value) => {
      const text = logged(value)
      expect(text).not.toContain(FIXTURE_TOKEN)
      expect(JSON.parse(text)[1].name).toBe('NonError')
    }
  )

  it('truncates a very long message', () => {
    const text = logged(new Error('x'.repeat(5_000)))
    expect(text.length).toBeLessThan(1_000)
  })

  it('falls back to the console and never throws, even if the sink does', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(() => createRoutingFailureLogger()(new Error('quiet'))).not.toThrow()
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
    const throwing = createRoutingFailureLogger(() => {
      throw new Error('sink failed')
    })
    expect(() => throwing(new Error('boom'))).not.toThrow()
  })
})
