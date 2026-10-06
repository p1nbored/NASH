import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// FIXTURE_ONLY: placeholder values; the scrub must delete them without reading them.
const FIXTURE_ONLY_VALUE = 'FIXTURE_ONLY_NOT_A_CLEF_CREDENTIAL'
const PLANTED = ['AUTOPILOT_CLEF_API_TOKEN', 'autopilot_clef_account_id'] as const

describe('clef environment scrub at module load', () => {
  beforeEach(() => {
    vi.resetModules()
    for (const name of PLANTED) {
      process.env[name] = FIXTURE_ONLY_VALUE
    }
  })

  afterEach(() => {
    for (const name of PLANTED) {
      delete process.env[name]
    }
    vi.restoreAllMocks()
  })

  it('deletes the Clef variables from process.env as soon as the module is evaluated', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await import('./clef-environment-scrub-at-load')

    for (const name of PLANTED) {
      expect(Object.keys(process.env)).not.toContain(name)
    }
    expect(warn).toHaveBeenCalledTimes(1)
    const logged = JSON.stringify(warn.mock.calls)
    expect(logged).toContain('AUTOPILOT_CLEF_API_TOKEN')
    expect(logged).not.toContain(FIXTURE_ONLY_VALUE)
  })

  it('stays silent when nothing had to be removed', async () => {
    for (const name of PLANTED) {
      delete process.env[name]
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await import('./clef-environment-scrub-at-load')

    expect(warn).not.toHaveBeenCalled()
  })
})
