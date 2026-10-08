import { describe, expect, it } from 'vitest'
import { toAgentLaunchPreferences } from './agent-launch-preferences'

describe('toAgentLaunchPreferences', () => {
  it('preserves checked routed task permissions through a terminal launch', () => {
    expect(
      toAgentLaunchPreferences({
        model: 'provider/exact-model',
        effort: 'ultra',
        taskAccess: 'read_only',
        routeValidated: 'true'
      })
    ).toEqual({
      model: 'provider/exact-model',
      effort: 'ultra',
      taskAccess: 'read_only',
      routeValidated: true
    })
    expect(
      toAgentLaunchPreferences({ taskAccess: 'danger-full-access', routeValidated: 'yes' })
    ).toBeUndefined()
  })
  it('keeps only supported string launch preferences', () => {
    expect(
      toAgentLaunchPreferences({
        model: ' gpt-5 ',
        effort: 'high',
        mode: 'plan',
        fastMode: true
      })
    ).toEqual({ model: 'gpt-5', effort: 'high', mode: 'plan' })
  })

  it('answers nothing when no preference survives', () => {
    expect(toAgentLaunchPreferences({ model: '  ', fastMode: true })).toBeUndefined()
    expect(toAgentLaunchPreferences(undefined)).toBeUndefined()
  })
})
