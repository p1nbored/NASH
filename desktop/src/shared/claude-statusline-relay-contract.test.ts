import { describe, expect, it } from 'vitest'
import {
  CLAUDE_STATUSLINE_RELAY_MAX_ARGUMENT_CHARS,
  decodeClaudeStatusLineRelayRequest,
  encodeClaudeStatusLineRelayRequest
} from './claude-statusline-relay-contract'

const SHELL = 'C:\\Program Files\\Git\\bin\\bash.exe'

describe('claude status-line relay request', () => {
  it('round-trips the shell and the user command through one argument', () => {
    const command = `jq -r '"[\\(.model.display_name)]"' | sed "s/x/y/"; echo $HOME`
    const argument = encodeClaudeStatusLineRelayRequest({ shell: SHELL, command })
    expect(argument).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(decodeClaudeStatusLineRelayRequest(argument)).toEqual({ shell: SHELL, command })
  })

  it('carries no command when the user has no status line', () => {
    const argument = encodeClaudeStatusLineRelayRequest({ shell: SHELL, command: null })
    expect(decodeClaudeStatusLineRelayRequest(argument)).toEqual({ shell: SHELL, command: null })
  })

  it.each([
    ['a missing argument', undefined],
    ['an empty argument', ''],
    ['characters outside base64url', 'abc+/='],
    ['an argument past the cap', 'A'.repeat(CLAUDE_STATUSLINE_RELAY_MAX_ARGUMENT_CHARS + 1)],
    ['text that is not JSON', Buffer.from('not json').toString('base64url')],
    ['another version', Buffer.from('{"v":2,"shell":"x","command":null}').toString('base64url')],
    ['an empty shell', Buffer.from('{"v":1,"shell":"","command":null}').toString('base64url')]
  ])('refuses %s', (_label, argument) => {
    expect(decodeClaudeStatusLineRelayRequest(argument)).toBeNull()
  })
})
