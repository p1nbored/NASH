import { describe, expect, it } from 'vitest'
import { CLAUDE_AUTH_ENV_VARS, hasClaudeAuthEnvConflict } from './environment'
import {
  normalizeTuiAgentEnvRecord,
  resolveTuiAgentLaunchEnv
} from '../../shared/tui-agent-launch-defaults'
import { claudeStructuredAuthPolicy } from './claude-structured-auth-policy'

describe('claudeStructuredAuthPolicy', () => {
  it('never strips: structured Claude runs on the own login, so an API-key user keeps it', () => {
    expect(claudeStructuredAuthPolicy()).toEqual({ stripAuthEnv: false })
  })
})

describe('the strip vocabulary the policy governs', () => {
  it('covers every Anthropic auth variable the terminal path knows about', () => {
    // A new auth var added to the list without a matching refusal/strip path is the
    // shape of the leak this lane already shipped once.
    expect([...CLAUDE_AUTH_ENV_VARS]).toEqual([
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_AUTH_TOKEN',
      'CLAUDE_CODE_OAUTH_TOKEN',
      'AWS_BEARER_TOKEN_BEDROCK'
    ])
  })
})

// The refusal has to cover exactly what the strip removes. Anything narrower lets an
// override reach the child that applyClaudeEnvPatch would have deleted.
describe('hasClaudeAuthEnvConflict matches the strip it guards', () => {
  it('refuses each Anthropic auth variable', () => {
    for (const key of CLAUDE_AUTH_ENV_VARS) {
      expect(hasClaudeAuthEnvConflict({ [key]: 'v' }, 'linux')).toBe(true)
    }
  })

  // `ANTHROPIC_API_KEY=` in the agent env box is how a user blanks a variable, and the
  // settings pipeline preserves the empty value (agent-default-env-draft.ts assigns
  // everything after the `=`; normalizeTuiAgentEnvRecord drops empty KEYS only). An
  // empty value cannot beat the pinned account and the strip removes the name anyway,
  // so refusing it would break a terminal launch that works today for no security gain.
  it('admits an override whose value is empty, the documented way to blank a variable', () => {
    expect(hasClaudeAuthEnvConflict({ ANTHROPIC_API_KEY: '' }, 'linux')).toBe(false)
    expect(hasClaudeAuthEnvConflict({ anthropic_api_key: '' }, 'win32')).toBe(false)
    expect(hasClaudeAuthEnvConflict({ ANTHROPIC_CUSTOM_HEADERS: '' }, 'linux')).toBe(false)
  })

  it('still refuses the same names once they carry a value', () => {
    expect(hasClaudeAuthEnvConflict({ ANTHROPIC_API_KEY: 'sk-ant' }, 'linux')).toBe(true)
  })

  // The end-to-end shape the regression actually took: settings text -> normalized
  // record -> launch env -> the predicate the terminal preflight gates on.
  it('admits a blanked variable all the way from the settings record', () => {
    const configured = normalizeTuiAgentEnvRecord({ claude: { ANTHROPIC_API_KEY: '' } })
    const launchEnv = resolveTuiAgentLaunchEnv('claude', configured)

    expect(launchEnv).toEqual({ ANTHROPIC_API_KEY: '' })
    expect(hasClaudeAuthEnvConflict(launchEnv, 'linux')).toBe(false)
  })

  it('folds case on win32, where the OS does', () => {
    expect(hasClaudeAuthEnvConflict({ anthropic_api_key: 'sk-lower' }, 'win32')).toBe(true)
    expect(hasClaudeAuthEnvConflict({ Anthropic_Custom_Headers: 'x-api-key: v' }, 'win32')).toBe(
      true
    )
  })

  it('keeps env names case-sensitive off win32', () => {
    expect(hasClaudeAuthEnvConflict({ anthropic_api_key: 'sk-lower' }, 'linux')).toBe(false)
  })

  it('admits non-auth Anthropic settings on both platforms', () => {
    expect(hasClaudeAuthEnvConflict({ ANTHROPIC_BASE_URL: 'https://gw.test' }, 'linux')).toBe(false)
    expect(hasClaudeAuthEnvConflict({ ANTHROPIC_BASE_URL: 'https://gw.test' }, 'win32')).toBe(false)
    expect(hasClaudeAuthEnvConflict({ ANTHROPIC_CUSTOM_HEADERS: 'X-Trace: 1' }, 'linux')).toBe(
      false
    )
    expect(hasClaudeAuthEnvConflict(undefined, 'linux')).toBe(false)
  })
})
