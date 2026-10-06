import { afterEach, describe, expect, it } from 'vitest'
import { scrubClefEnvironment } from './clef-env-scrub'

// FIXTURE_ONLY: placeholder values; the scrub must remove them without reading them.
const FIXTURE_ONLY_VALUE = 'FAKE_CLEF_TOKEN_FIXTURE_ONLY_0000000000'

describe('scrubClefEnvironment', () => {
  it('removes the canonical Clef variable names and reports them', () => {
    const env: Record<string, string | undefined> = {
      AUTOPILOT_CLEF_API_TOKEN: FIXTURE_ONLY_VALUE,
      AUTOPILOT_CLEF_ACCOUNT_ID: FIXTURE_ONLY_VALUE,
      PATH: '/usr/bin'
    }
    const removed = scrubClefEnvironment(env)
    expect([...removed].sort()).toEqual(['AUTOPILOT_CLEF_ACCOUNT_ID', 'AUTOPILOT_CLEF_API_TOKEN'])
    expect(env).toEqual({ PATH: '/usr/bin' })
  })

  it('removes the names in any letter case and reports the spelling it found', () => {
    const env: Record<string, string | undefined> = {
      autopilot_clef_api_token: FIXTURE_ONLY_VALUE,
      Autopilot_Clef_Api_Token: FIXTURE_ONLY_VALUE,
      AUTOPILOT_clef_ACCOUNT_id: FIXTURE_ONLY_VALUE,
      Home: '/home/fixture'
    }
    const removed = scrubClefEnvironment(env)
    expect([...removed].sort()).toEqual([
      'AUTOPILOT_clef_ACCOUNT_id',
      'Autopilot_Clef_Api_Token',
      'autopilot_clef_api_token'
    ])
    expect(env).toEqual({ Home: '/home/fixture' })
  })

  it('leaves look-alike names untouched', () => {
    const env: Record<string, string | undefined> = {
      AUTOPILOT_CLEF_API_TOKEN_OLD: FIXTURE_ONLY_VALUE,
      X_AUTOPILOT_CLEF_ACCOUNT_ID: FIXTURE_ONLY_VALUE,
      CLEF_API_TOKEN: FIXTURE_ONLY_VALUE,
      AUTOPILOT_CLEF_ACCOUNT: FIXTURE_ONLY_VALUE
    }
    const before = { ...env }
    expect(scrubClefEnvironment(env)).toEqual([])
    expect(env).toEqual(before)
  })

  it('removes names whose value is empty or undefined', () => {
    const env: Record<string, string | undefined> = {
      AUTOPILOT_CLEF_API_TOKEN: '',
      AUTOPILOT_CLEF_ACCOUNT_ID: undefined
    }
    expect([...scrubClefEnvironment(env)].sort()).toEqual([
      'AUTOPILOT_CLEF_ACCOUNT_ID',
      'AUTOPILOT_CLEF_API_TOKEN'
    ])
    expect(Object.keys(env)).toEqual([])
  })

  it('never reads a Clef variable value', () => {
    const env: Record<string, string | undefined> = { KEEP: 'kept' }
    Object.defineProperty(env, 'AUTOPILOT_CLEF_API_TOKEN', {
      enumerable: true,
      configurable: true,
      get: () => {
        throw new Error('the scrub read a Clef credential value')
      }
    })
    expect(scrubClefEnvironment(env)).toEqual(['AUTOPILOT_CLEF_API_TOKEN'])
    expect(Object.keys(env)).toEqual(['KEEP'])
  })

  describe('against process.env', () => {
    const fixtureName = 'autopilot_clef_account_id'

    afterEach(() => {
      delete process.env[fixtureName]
    })

    it('deletes a lower-case Clef variable from the live process environment', () => {
      process.env[fixtureName] = FIXTURE_ONLY_VALUE
      const removed = scrubClefEnvironment(process.env)
      expect(removed.map((name) => name.toUpperCase())).toContain('AUTOPILOT_CLEF_ACCOUNT_ID')
      expect(process.env[fixtureName]).toBeUndefined()
      expect(process.env.AUTOPILOT_CLEF_ACCOUNT_ID).toBeUndefined()
    })
  })
})
