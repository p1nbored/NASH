import { describe, expect, it } from 'vitest'
import { APP_IDENTITY } from '../shared/app-identity-constants'
import appIdentityJson from '../shared/app-identity-constants.json'

// Why here and not next to the constants: the JSON import is only listed in the main tsc project (TS6307 elsewhere).
describe('NASH app identity JSON twin', () => {
  it('keeps the JSON read by electron-builder and the dev scripts equal to the TS constants', () => {
    expect(appIdentityJson).toEqual(APP_IDENTITY)
  })
})
