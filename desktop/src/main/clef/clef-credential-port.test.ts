import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ClefCredentialGeneration } from './clef-credential-generation'
import { ClefCredentialHandle } from './clef-credential-handle'
import {
  getClefCredentialSource,
  setClefCredentialSource,
  type ClefCredentialSource
} from './clef-credential-port'

// FIXTURE_ONLY: fake values shaped like real Clef credentials; never real secrets.
const FIXTURE_ONLY_ACCOUNT_ID = '0123456789abcdef0123456789abcdef'
const FIXTURE_ONLY_TOKEN = 'FAKE_CLEF_TOKEN_FIXTURE_ONLY_0000000000'

const CLEF_DIR = import.meta.dirname
const ELECTRON_IMPORT =
  /(?:from\s*['"]electron['"]|import\s*\(\s*['"]electron['"]|require\s*\(\s*['"]electron['"])/
const SEALED_STORE_FILE = 'clef-sealed-credential-store.ts'

describe('clef credential port', () => {
  afterEach(() => {
    setClefCredentialSource(null)
  })

  it('defaults to a source that reports absent credentials and reads nothing', () => {
    const source = getClefCredentialSource()
    expect(source.status()).toEqual({
      tokenPresent: false,
      accountPresent: false,
      protection: 'absent'
    })
    expect(source.read()).toBeNull()
  })

  it('gives the default source one stable opaque generation', () => {
    const generation = getClefCredentialSource().generation()
    expect(generation).toBeInstanceOf(ClefCredentialGeneration)
    expect(getClefCredentialSource().generation().equals(generation)).toBe(true)
  })

  it('returns the installed source until it is reset to the default', () => {
    const handle = new ClefCredentialHandle(FIXTURE_ONLY_TOKEN, FIXTURE_ONLY_ACCOUNT_ID)
    const generation = ClefCredentialGeneration.mint()
    const installed: ClefCredentialSource = {
      status: () => ({ tokenPresent: true, accountPresent: true, protection: 'sealed' }),
      read: () => handle,
      generation: () => generation
    }
    setClefCredentialSource(installed)
    expect(getClefCredentialSource()).toBe(installed)
    expect(getClefCredentialSource().read()).toBe(handle)
    expect(getClefCredentialSource().generation()).toBe(generation)

    setClefCredentialSource(null)
    expect(getClefCredentialSource()).not.toBe(installed)
    expect(getClefCredentialSource().status().protection).toBe('absent')
    expect(getClefCredentialSource().read()).toBeNull()
    expect(getClefCredentialSource().generation().equals(generation)).toBe(false)
  })

  it('keeps electron out of every clef module except the sealed store', () => {
    const sources = readdirSync(CLEF_DIR).filter(
      (name) => name.endsWith('.ts') && !name.endsWith('.test.ts') && name !== SEALED_STORE_FILE
    )
    expect(sources).toContain('clef-credential-port.ts')
    expect(sources).toContain('clef-credential-handle.ts')
    const offenders = sources.filter((name) =>
      ELECTRON_IMPORT.test(readFileSync(join(CLEF_DIR, name), 'utf8'))
    )
    expect(offenders).toEqual([])
  })
})
