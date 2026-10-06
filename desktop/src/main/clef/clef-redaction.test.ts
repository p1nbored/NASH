import { inspect } from 'node:util'
import { describe, expect, it } from 'vitest'
import { CLEF_REDACTED, redactClefError, redactClefText, redactClefValue } from './clef-redaction'

// FIXTURE_ONLY: fake credentials shaped like real ones so the rules see real formats.
const FIXTURE_ONLY_ACCOUNT_ID = '0123456789abcdef0123456789abcdef'
const FIXTURE_ONLY_TOKEN = 'FAKE_CLEF_TOKEN_FIXTURE_ONLY_0000000000'
const SECRETS = [FIXTURE_ONLY_TOKEN, FIXTURE_ONLY_ACCOUNT_ID]
const RUN_URL = `https://api.cloudflare.com/client/v4/accounts/${FIXTURE_ONLY_ACCOUNT_ID}/ai/run/@cf/cloudflare/clef`

function expectClean(text: string): void {
  expect(text).not.toContain(FIXTURE_ONLY_TOKEN)
  expect(text.toLowerCase()).not.toContain(FIXTURE_ONLY_ACCOUNT_ID)
}

describe('redactClefText', () => {
  it('scrubs the live token and account id wherever they appear', () => {
    const text = `token=${FIXTURE_ONLY_TOKEN} account ${FIXTURE_ONLY_ACCOUNT_ID.toUpperCase()}`
    const redacted = redactClefText(text, SECRETS)
    expectClean(redacted)
    expect(redacted).toContain(CLEF_REDACTED)
  })

  it('scrubs a URL-encoded live secret', () => {
    const secret = 'FAKE/CLEF+TOKEN=FIXTURE_ONLY'
    const redacted = redactClefText(`q=${encodeURIComponent(secret)}`, [secret])
    expect(redacted).toBe(`q=${CLEF_REDACTED}`)
  })

  it('scrubs any account path segment even without the live value', () => {
    expect(redactClefText(`POST ${RUN_URL} failed`)).toBe(
      `POST https://api.cloudflare.com/client/v4/accounts/${CLEF_REDACTED}/ai/run/@cf/cloudflare/clef failed`
    )
    expect(redactClefText('see /accounts/some-other-id?x=1')).toBe(
      `see /accounts/${CLEF_REDACTED}?x=1`
    )
    expect(redactClefText('ends at /ACCOUNTS/abc')).toBe(`ends at /ACCOUNTS/${CLEF_REDACTED}`)
  })

  it('keeps the recorded URL template placeholder', () => {
    const template = 'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/x'
    expect(redactClefText(template)).toBe(template)
  })

  it('scrubs bearer credentials in headers and serialized objects', () => {
    expect(redactClefText(`Authorization: Bearer ${FIXTURE_ONLY_TOKEN}`)).toBe(
      `Authorization: Bearer ${CLEF_REDACTED}`
    )
    expect(redactClefText(`{"authorization":"bearer ${FIXTURE_ONLY_TOKEN}"}`)).toBe(
      `{"authorization":"bearer ${CLEF_REDACTED}"}`
    )
  })

  it('is idempotent', () => {
    const once = redactClefText(`Bearer ${FIXTURE_ONLY_TOKEN} ${RUN_URL}`, SECRETS)
    expect(redactClefText(once, SECRETS)).toBe(once)
  })

  it('ignores empty or very short secrets instead of shredding the text', () => {
    expect(redactClefText('plain diagnostic text', ['', 'a', 'te'])).toBe('plain diagnostic text')
  })
})

describe('redactClefError', () => {
  it('returns a new error with a scrubbed message and stack, leaving the original intact', () => {
    const original = new TypeError(`fetch ${RUN_URL} with Bearer ${FIXTURE_ONLY_TOKEN} failed`)
    const originalMessage = original.message
    const originalStack = original.stack
    const redacted = redactClefError(original, SECRETS)

    expect(redacted).not.toBe(original)
    expect(redacted).toBeInstanceOf(Error)
    expect(redacted.name).toBe('TypeError')
    expectClean(redacted.message)
    expectClean(redacted.stack ?? '')
    expect(redacted.stack).toContain(CLEF_REDACTED)
    expect(original.message).toBe(originalMessage)
    expect(original.stack).toBe(originalStack)
  })

  it('scrubs nested cause chains of errors, strings and objects', () => {
    const innermost = { url: RUN_URL, headers: { Authorization: `Bearer ${FIXTURE_ONLY_TOKEN}` } }
    const middle = new Error(`account ${FIXTURE_ONLY_ACCOUNT_ID}`, { cause: innermost })
    const outer = new Error('fetch failed', { cause: middle })
    const redacted = redactClefError(outer, SECRETS)

    const redactedMiddle = redacted.cause
    expect(redactedMiddle).toBeInstanceOf(Error)
    expect(redactedMiddle).not.toBe(middle)
    expectClean(
      redactedMiddle instanceof Error ? `${redactedMiddle.message}${redactedMiddle.stack}` : ''
    )
    expect(redactedMiddle instanceof Error && redactedMiddle.cause).toEqual({
      url: `https://api.cloudflare.com/client/v4/accounts/${CLEF_REDACTED}/ai/run/@cf/cloudflare/clef`,
      headers: { Authorization: `Bearer ${CLEF_REDACTED}` }
    })
    expect(middle.cause).toBe(innermost)
    expect(innermost.url).toBe(RUN_URL)
  })

  it('scrubs string causes, aggregate errors and error codes', () => {
    const aggregate = new AggregateError(
      [new Error(`connect ${FIXTURE_ONLY_ACCOUNT_ID}`)],
      `all attempts failed for ${FIXTURE_ONLY_TOKEN}`,
      { cause: `Bearer ${FIXTURE_ONLY_TOKEN}` }
    )
    const withCode = Object.assign(aggregate, { code: `E_${FIXTURE_ONLY_TOKEN}` })
    const redacted = redactClefError(withCode, SECRETS)

    expect(redacted.cause).toBe(`Bearer ${CLEF_REDACTED}`)
    expectClean(redacted.message)
    const errors: unknown = Reflect.get(redacted, 'errors')
    expect(Array.isArray(errors)).toBe(true)
    expectClean(Array.isArray(errors) && errors[0] instanceof Error ? errors[0].message : 'x')
    expect(Reflect.get(redacted, 'code')).toBe(`E_${CLEF_REDACTED}`)
  })

  it('terminates on a cyclic cause chain', () => {
    const first = new Error(`first ${FIXTURE_ONLY_TOKEN}`)
    const second = new Error('second', { cause: first })
    Object.defineProperty(first, 'cause', { value: second, enumerable: false })
    const redacted = redactClefError(first, SECRETS)
    expectClean(redacted.message)
    expect(redacted.cause).toBeInstanceOf(Error)
  })

  it('drops an error stack it cannot read as text', () => {
    const error = new Error(`boom ${FIXTURE_ONLY_TOKEN}`)
    Object.defineProperty(error, 'stack', { value: undefined })
    expect(redactClefError(error, SECRETS).stack).toBe(`Error: boom ${CLEF_REDACTED}`)
  })
})

describe('redactClefValue', () => {
  it('returns new arrays and plain objects without mutating the input', () => {
    const input = { list: [`Bearer ${FIXTURE_ONLY_TOKEN}`, 3, true, null], nested: { RUN_URL } }
    const snapshot = JSON.stringify(input)
    const output = redactClefValue(input, SECRETS)

    expect(output).not.toBe(input)
    expect(output).toEqual({
      list: [`Bearer ${CLEF_REDACTED}`, 3, true, null],
      nested: {
        RUN_URL: `https://api.cloudflare.com/client/v4/accounts/${CLEF_REDACTED}/ai/run/@cf/cloudflare/clef`
      }
    })
    expect(JSON.stringify(input)).toBe(snapshot)
  })

  it('stringifies class instances through their own redacting toString', () => {
    class FakeHandle {
      readonly #token = FIXTURE_ONLY_TOKEN
      tokenLength(): number {
        return this.#token.length
      }
      toString(): string {
        return '[redacted clef credential]'
      }
    }
    expect(redactClefValue(new FakeHandle(), SECRETS)).toBe('[redacted clef credential]')
  })

  it('replaces cycles, deep nesting, functions and unprintable values with markers', () => {
    const cyclic: Record<string, unknown> = { name: 'loop' }
    cyclic.self = cyclic
    expect(redactClefValue(cyclic)).toEqual({ name: 'loop', self: '[circular]' })

    const deep = { a: { b: { c: { d: { e: { f: { g: { h: { i: { j: 'x' } } } } } } } } } }
    expect(JSON.stringify(redactClefValue(deep))).toContain('[truncated]')

    expect(redactClefValue(() => FIXTURE_ONLY_TOKEN)).toBe('[function]')
    const hostile = Object.create({
      toString(): string {
        throw new Error('no')
      }
    })
    expect(redactClefValue(hostile)).toBe('[unprintable]')
    expect(redactClefValue(10n)).toBe(10n)
    expect(redactClefValue(undefined)).toBeUndefined()
  })
})

describe('printed output of scrubbed errors', () => {
  const INSPECT_CUSTOM = Symbol.for('nodejs.util.inspect.custom')

  /** Everything Node would show, hidden and symbol properties and the whole cause chain included. */
  function printed(value: unknown): string {
    return inspect(value, {
      depth: 20,
      showHidden: true,
      maxStringLength: null,
      maxArrayLength: null
    })
  }

  function hostileError(): Error {
    const innermost = new Error(`innermost ${FIXTURE_ONLY_ACCOUNT_ID}`, {
      cause: `/accounts/${FIXTURE_ONLY_ACCOUNT_ID} ${FIXTURE_ONLY_TOKEN}`
    })
    const middle = new TypeError(`middle ${RUN_URL}`, { cause: innermost })
    return Object.assign(
      new Error(`outer Authorization: Bearer ${FIXTURE_ONLY_TOKEN}`, { cause: middle }),
      {
        config: { headers: { Authorization: `Bearer ${FIXTURE_ONLY_TOKEN}` }, url: RUN_URL },
        response: { status: 401, data: { token: FIXTURE_ONLY_TOKEN } },
        request: { path: `/accounts/${FIXTURE_ONLY_ACCOUNT_ID}` },
        [Symbol('trace')]: FIXTURE_ONLY_TOKEN
      }
    )
  }

  it('prints clean with every cause level, stack and hidden property expanded', () => {
    const redacted = redactClefError(hostileError(), SECRETS)
    const text = printed(redacted)
    expectClean(text)
    expect(text).toContain(CLEF_REDACTED)
    expect(text).toContain('innermost')
  })

  it('drops the extra properties a client library hangs on an error', () => {
    const redacted = redactClefError(hostileError(), SECRETS)
    for (const extra of ['config', 'response', 'request']) {
      expect(Object.keys(redacted)).not.toContain(extra)
      expect(Reflect.get(redacted, extra)).toBeUndefined()
    }
    expect(Object.getOwnPropertySymbols(redacted)).toEqual([])
  })

  it('does not carry over a custom inspect or toJSON that would print the original secrets', () => {
    class LeakyError extends Error {
      [INSPECT_CUSTOM](): string {
        return `leak ${FIXTURE_ONLY_TOKEN}`
      }
      toJSON(): string {
        return `leak ${FIXTURE_ONLY_ACCOUNT_ID}`
      }
    }
    const redacted = redactClefError(new LeakyError(`boom ${FIXTURE_ONLY_TOKEN}`), SECRETS)
    expectClean(printed(redacted))
    expectClean(JSON.stringify(redacted))
  })

  it('prints a scrubbed value tree clean when it holds errors, arrays and class instances', () => {
    class Holder {
      constructor(readonly token = FIXTURE_ONLY_TOKEN) {}
    }
    const tree = {
      failures: [hostileError(), new Holder()],
      url: RUN_URL,
      token: FIXTURE_ONLY_TOKEN
    }
    const text = printed(redactClefValue(tree, SECRETS))
    expectClean(text)
    expect(text).toContain(CLEF_REDACTED)
  })

  it('scrubs account paths and bearer values by shape even when no live secret is known', () => {
    const text = printed(redactClefError(hostileError()))
    expect(text).not.toContain(`/accounts/${FIXTURE_ONLY_ACCOUNT_ID}`)
    expect(text).not.toContain(`Bearer ${FIXTURE_ONLY_TOKEN}`)
    expect(text).not.toContain(RUN_URL)
  })
})
