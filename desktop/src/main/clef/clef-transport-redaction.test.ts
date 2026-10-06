import { inspect } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { setActiveSink } from '../observability/tracer'
import { sendClefRequest } from './clef-transport'
import {
  FIXTURE_ONLY_ACCOUNT_ID,
  FIXTURE_ONLY_RUN_URL,
  FIXTURE_ONLY_TOKEN,
  allowEveryAttempt,
  fixtureBody,
  fixtureCredentials,
  fixtureDeps
} from './clef-transport.test-fixture'

const FORBIDDEN = [FIXTURE_ONLY_TOKEN, FIXTURE_ONLY_ACCOUNT_ID]
const OUTCOME_KEYS = ['attempts', 'blocker', 'errorClass', 'kind', 'latch', 'status']

function request(overrides: Partial<Parameters<typeof sendClefRequest>[0]> = {}) {
  return {
    credentials: fixtureCredentials(),
    body: fixtureBody(),
    beforeAttempt: allowEveryAttempt,
    ...overrides
  }
}

/** A failure that carries every secret in its message, its stack text and three levels of causes. */
function secretBearingFailure(label: string): Error {
  const innermost = new Error(
    `${label} innermost ${FIXTURE_ONLY_TOKEN} accounts/${FIXTURE_ONLY_ACCOUNT_ID}`
  )
  const middle = new TypeError(`${label} middle ${FIXTURE_ONLY_RUN_URL}`, { cause: innermost })
  return new Error(`${label} outer Authorization: Bearer ${FIXTURE_ONLY_TOKEN}`, { cause: middle })
}

function collectRecords(): unknown[] {
  const records: unknown[] = []
  setActiveSink({ push: (record) => records.push(record), flush: () => {}, close: () => {} })
  return records
}

/** Every record and the outcome as Node would print them, so nothing hides inside an object. */
function printed(records: readonly unknown[], outcome: unknown): string {
  return inspect({ records, outcome }, { depth: 20, maxArrayLength: null, maxStringLength: null })
}

function expectNoSecret(text: string): void {
  for (const secret of FORBIDDEN) {
    expect(text).not.toContain(secret)
    expect(text.toLowerCase()).not.toContain(secret.toLowerCase())
  }
}

afterEach(() => {
  setActiveSink(null)
})

describe('sendClefRequest redaction of internal failures', () => {
  it('scrubs the clef.internal_error event, nested causes included', async () => {
    const records = collectRecords()
    const deps = fixtureDeps([{ status: 500 }, { status: 500 }])
    deps.random = () => {
      throw secretBearingFailure('random failed')
    }
    const outcome = await sendClefRequest(request(), deps)

    expect(outcome).toMatchObject({ errorClass: 'internal', attempts: 1 })
    const text = printed(records, outcome)
    expect(text).toContain("name: 'clef.internal_error'")
    expectNoSecret(text)
    expect(text).toContain('random failed')
    expect(text).toContain('[redacted]')
  })

  it('scrubs the clef.proxy_setup_failed event, nested causes included', async () => {
    const records = collectRecords()
    const deps = fixtureDeps([{ status: 200 }])
    deps.prepareProxy = async () => {
      throw secretBearingFailure('proxy failed')
    }
    const outcome = await sendClefRequest(request(), deps)

    expect(outcome.kind).toBe('response')
    const text = printed(records, outcome)
    expect(text).toContain("name: 'clef.proxy_setup_failed'")
    expectNoSecret(text)
    expect(text).toContain('proxy failed')
    expect(text).toContain('[redacted]')
  })

  it('scrubs the clef.before_attempt_failed event, nested causes included', async () => {
    const records = collectRecords()
    const deps = fixtureDeps([])
    const outcome = await sendClefRequest(
      request({
        beforeAttempt: async () => {
          throw secretBearingFailure('ledger failed')
        }
      }),
      deps
    )

    expect(outcome).toMatchObject({ errorClass: 'vetoed', attempts: 0 })
    const text = printed(records, outcome)
    expect(text).toContain("name: 'clef.before_attempt_failed'")
    expectNoSecret(text)
    expect(text).toContain('ledger failed')
    expect(text).toContain('[redacted]')
  })

  it('scrubs the clef.attempt_failed event for a non-Error rejection and a string cause', async () => {
    const records = collectRecords()
    const deps = fixtureDeps([
      { throws: `socket reset for Bearer ${FIXTURE_ONLY_TOKEN}` },
      { throws: new Error('wrapped', { cause: `${FIXTURE_ONLY_RUN_URL} ${FIXTURE_ONLY_TOKEN}` }) }
    ])
    const outcome = await sendClefRequest(request(), deps)

    const text = printed(records, outcome)
    expect(text).toContain("name: 'clef.attempt_failed'")
    expectNoSecret(text)
  })
})

describe('sendClefRequest outcome internals', () => {
  it('carries no error text, only the pinned set of fields, on every failure path', async () => {
    const records = collectRecords()
    const failing = fixtureDeps([{ throws: secretBearingFailure('first') }])
    failing.prepareProxy = async () => {
      throw secretBearingFailure('proxy')
    }
    const crashing = fixtureDeps([{ status: 500 }])
    crashing.random = () => {
      throw secretBearingFailure('random')
    }
    const vetoing = request({
      beforeAttempt: async () => {
        throw secretBearingFailure('ledger')
      }
    })
    const outcomes = [
      await sendClefRequest(request({ maxAttempts: 1 }), failing),
      await sendClefRequest(request(), crashing),
      await sendClefRequest(vetoing, fixtureDeps([]))
    ]

    for (const outcome of outcomes) {
      expect(outcome.kind).toBe('blocked')
      expect(Object.keys(outcome).sort()).toEqual(OUTCOME_KEYS)
      expectNoSecret(inspect(outcome, { depth: 20 }))
    }
    expectNoSecret(printed(records, outcomes))
  })
})
