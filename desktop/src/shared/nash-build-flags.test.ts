import { describe, expect, it } from 'vitest'
import {
  ORCA_ACCOUNT_AND_MOBILE_UI_ENABLED,
  ORCA_STAR_PROMPT_ENABLED,
  RSI_NAVIGATION_ENABLED
} from './nash-build-flags'

describe('NASH build flags (D-038)', () => {
  it('hides the Orca account and Orca Mobile surfaces', () => {
    expect(ORCA_ACCOUNT_AND_MOBILE_UI_ENABLED).toBe(false)
  })

  it('hides the RSI navigation until its backend exists', () => {
    expect(RSI_NAVIGATION_ENABLED).toBe(false)
  })

  it('never asks the user to star the Orca repository', () => {
    expect(ORCA_STAR_PROMPT_ENABLED).toBe(false)
  })
})
