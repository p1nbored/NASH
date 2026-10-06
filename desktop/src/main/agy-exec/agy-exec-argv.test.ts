import { describe, expect, it } from 'vitest'
import {
  AgyExecArgvError,
  buildAgyExecArgv,
  describeAgyExecArgv,
  isAgyExecEffort,
  isAgyExecModelId
} from './agy-exec-argv'

const PROMPT = 'Summarize the repository in three bullet points.'

function codeOf(run: () => unknown): string | null {
  try {
    run()
    return null
  } catch (error) {
    return error instanceof AgyExecArgvError ? error.code : `unexpected:${String(error)}`
  }
}

describe('buildAgyExecArgv', () => {
  it('builds exactly --print=<prompt> --sandbox --model <id> and no --effort when none is given', () => {
    expect(
      buildAgyExecArgv({ sandbox: true, prompt: PROMPT, model: 'gemini-3.8-flash-high' })
    ).toEqual([`--print=${PROMPT}`, '--sandbox', '--model', 'gemini-3.8-flash-high'])
  })

  it('leaves out --sandbox when the caller asks for no sandbox, and adds no other flag (D-025)', () => {
    expect(
      buildAgyExecArgv({ sandbox: false, prompt: PROMPT, model: 'gemini-3.8-flash-high' })
    ).toEqual([`--print=${PROMPT}`, '--model', 'gemini-3.8-flash-high'])
  })

  it('refuses a sandbox input that is not a boolean', () => {
    for (const sandbox of [undefined, null, 'read-only', 1]) {
      expect(
        codeOf(() =>
          // @ts-expect-error FIXTURE_ONLY: untyped routing data reaches the builder.
          buildAgyExecArgv({ sandbox, prompt: PROMPT, model: 'gemini-3.8-flash-high' })
        )
      ).toBe('invalid_sandbox')
    }
  })

  it('appends --effort <value> last when an effort is requested', () => {
    expect(
      buildAgyExecArgv({
        sandbox: true,
        prompt: PROMPT,
        model: 'claude-sonnet-5-5-low',
        effort: 'medium'
      })
    ).toEqual([
      `--print=${PROMPT}`,
      '--sandbox',
      '--model',
      'claude-sonnet-5-5-low',
      '--effort',
      'medium'
    ])
  })

  it.each(['low', 'medium', 'high', 'max'])('accepts the effort %s', (effort) => {
    const argv = buildAgyExecArgv({
      sandbox: true,
      prompt: PROMPT,
      model: 'gemini-3.1-pro-high',
      effort
    })
    expect(argv.slice(-2)).toEqual(['--effort', effort])
  })

  it('always passes --model, whatever the caller leaves out', () => {
    for (const model of [undefined, null, '', '   ', 7, {}]) {
      // @ts-expect-error FIXTURE_ONLY: untyped routing data reaches the builder.
      expect(codeOf(() => buildAgyExecArgv({ sandbox: true, prompt: PROMPT, model }))).toBe(
        'invalid_model'
      )
    }
  })

  it('keeps a prompt that starts with a dash bound to --print=', () => {
    const argv = buildAgyExecArgv({
      sandbox: true,
      prompt: '--dangerously-skip-permissions please',
      model: 'gemini-3.8-flash-high'
    })
    expect(argv[0]).toBe('--print=--dangerously-skip-permissions please')
    expect(argv.slice(1)).toEqual(['--sandbox', '--model', 'gemini-3.8-flash-high'])
  })

  it('carries quotes, newlines, equals signs, percent signs and emoji byte-exact', () => {
    const prompt = 'say "hi" \\ and\n  %PATH% = a=b \u{1F600} \\'
    expect(buildAgyExecArgv({ sandbox: true, prompt, model: 'gemini-3.8-flash-low' })[0]).toBe(
      `--print=${prompt}`
    )
  })

  it.each([
    'gemini-3.8-flash-high',
    'gemini-3.7-flash-medium',
    'claude-opus-5-5-high',
    'gpt-oss-120b-medium'
  ])('accepts the listed model id %s', (model) => {
    expect(isAgyExecModelId(model)).toBe(true)
    expect(buildAgyExecArgv({ sandbox: true, prompt: PROMPT, model })).toContain(model)
  })
})

describe('buildAgyExecArgv refusals', () => {
  it.each([
    'gemini-4',
    'gemini-4-flash-high',
    'gemini-4.0-pro',
    'models/gemini-4',
    'argon-1',
    'gemini-argon-high'
  ])('refuses the Gemini 4 family id %s by the model pin policy', (model) => {
    expect(codeOf(() => buildAgyExecArgv({ sandbox: true, prompt: PROMPT, model }))).toBe(
      'model_excluded'
    )
  })

  it('refuses a Gemini 4 model by its label even when the id looks fine', () => {
    for (const modelLabel of [
      'Gemini 4 Pro (High)',
      'gemini-4',
      'GEMINI_4 Flash',
      'Gemini 4.1 Ultra'
    ]) {
      expect(
        codeOf(() =>
          buildAgyExecArgv({
            sandbox: true,
            prompt: PROMPT,
            model: 'gemini-3.8-flash-high',
            modelLabel
          })
        )
      ).toBe('model_excluded')
    }
  })

  it('accepts an ordinary label and never lets a label reach the argv', () => {
    const argv = buildAgyExecArgv({
      sandbox: true,
      prompt: PROMPT,
      model: 'gemini-3.8-flash-high',
      modelLabel: 'Gemini 3.8 Flash (High)'
    })
    expect(argv.join(' ')).not.toContain('Gemini 3.8 Flash (High)')
  })

  it.each([
    'auto',
    'latest',
    'inherit',
    'flash',
    'pro',
    'default',
    'Default',
    'GEMINI-3.8-FLASH-HIGH',
    '-x',
    '--model',
    'gemini 3.8',
    'gemini-3.8-flash-high --effort max',
    'a'.repeat(65)
  ])('refuses the model %s (an alias, the default sentinel, or not a slug)', (model) => {
    const code = codeOf(() => buildAgyExecArgv({ sandbox: true, prompt: PROMPT, model }))
    expect(['invalid_model', 'model_excluded']).toContain(code)
    expect(isAgyExecModelId(model)).toBe(false)
  })

  it.each(['xhigh', 'ultra', 'none', 'minimal', '', 'HIGH', ' high', 'high ', 5, null])(
    'refuses the effort %s',
    (effort) => {
      const attempt = () => {
        return buildAgyExecArgv({
          sandbox: true,
          prompt: PROMPT,
          model: 'gemini-3.8-flash-high',
          // @ts-expect-error FIXTURE_ONLY: untyped routing data reaches the builder.
          effort
        })
      }
      expect(codeOf(attempt)).toBe('invalid_effort')
      expect(isAgyExecEffort(effort)).toBe(false)
    }
  )

  it.each([[''], ['   \n'], ['bad\u0000prompt']])('refuses the prompt %j', (prompt) => {
    expect(
      codeOf(() => buildAgyExecArgv({ sandbox: true, prompt, model: 'gemini-3.8-flash-high' }))
    ).toBe('invalid_prompt')
  })

  it('refuses a non-string prompt', () => {
    expect(
      codeOf(() =>
        // @ts-expect-error FIXTURE_ONLY: untyped routing data reaches the builder.
        buildAgyExecArgv({ sandbox: true, prompt: 5, model: 'gemini-3.8-flash-high' })
      )
    ).toBe('invalid_prompt')
  })

  it('has no prompt size cap of its own; the runner checks the command line (D-027)', () => {
    const model = 'gemini-3.8-flash-high'
    const argv = buildAgyExecArgv({ sandbox: true, prompt: 'a'.repeat(20_000), model })
    expect(argv[0]).toHaveLength('--print='.length + 20_000)
  })
})

describe('describeAgyExecArgv', () => {
  it('replaces the prompt with its size so a result never carries the objective', () => {
    const argv = buildAgyExecArgv({
      sandbox: true,
      prompt: 'SECRET-OBJECTIVE-TEXT',
      model: 'gemini-3.8-flash-high',
      effort: 'low'
    })
    const described = describeAgyExecArgv(argv)
    expect(described).toEqual([
      '--print=[prompt omitted, 21 chars]',
      '--sandbox',
      '--model',
      'gemini-3.8-flash-high',
      '--effort',
      'low'
    ])
    expect(described.join(' ')).not.toContain('SECRET-OBJECTIVE-TEXT')
  })
})
