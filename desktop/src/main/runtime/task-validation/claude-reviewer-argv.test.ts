import { describe, expect, it } from 'vitest'
import { buildClaudeReviewArgv } from './claude-reviewer-argv'

const BASE = [
  '-p',
  '--output-format',
  'json',
  '--model',
  'claude-opus-5-5',
  '--effort',
  'high',
  '--no-session-persistence'
]

describe('headless Claude reviewer argv', () => {
  it("runs print mode with Claude Code's own default settings and no saved session (D-027 restriction 30)", () => {
    expect(buildClaudeReviewArgv({ model: 'claude-opus-5-5', effort: 'high' })).toEqual(BASE)
  })

  it('no longer narrows the permission mode, tools, MCP servers or customizations', () => {
    const argv = buildClaudeReviewArgv({ model: 'claude-opus-5-5', effort: 'high' })
    for (const flag of [
      '--permission-mode',
      '--tools',
      '--disallowedTools',
      '--strict-mcp-config',
      '--safe-mode'
    ]) {
      expect(argv).not.toContain(flag)
    }
  })

  it('omits the effort flag when the availability check resolved none', () => {
    const argv = buildClaudeReviewArgv({ model: 'claude-opus-5-5', effort: null })
    expect(argv).not.toContain('--effort')
  })

  it('refuses aliases, unpinned or malformed models and unknown efforts', () => {
    for (const model of ['opus', 'sonnet', 'latest', '--dangerously-skip-permissions', 'a b', '']) {
      expect(() => buildClaudeReviewArgv({ model, effort: 'high' })).toThrow()
    }
    expect(() => buildClaudeReviewArgv({ model: 'claude-opus-5-5', effort: 'ultracode' })).toThrow()
  })
})
