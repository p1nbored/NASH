import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// D-017: the macOS helper builds stamp the bundle id TCC and notification settings key on, so it must
// come from the NASH identity and never name a real Orca install's bundle.
const read = (name) => readFileSync(join(import.meta.dirname, name), 'utf8')

describe('macOS helper build scripts', () => {
  it.each(['build-computer-macos.mjs', 'build-notification-status-macos.mjs'])(
    '%s takes its default bundle id from the NASH identity',
    (script) => {
      const source = read(script)

      expect(source).not.toMatch(/com\.stablyai/)
      expect(source).toContain('app-identity-constants.json')
      expect(source).toMatch(/identity\.appId/)
    }
  )
})
