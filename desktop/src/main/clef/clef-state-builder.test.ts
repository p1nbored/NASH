import { describe, expect, it } from 'vitest'
import {
  CLEF_OBJECTIVE_MAX_CHARS,
  CLEF_RAW_INTAKE_MAX_CHARS,
  CLEF_STATE_DATA_CLASS,
  CLEF_STATE_LIST_ITEM_MAX_CHARS,
  CLEF_STATE_LIST_MAX_ITEMS,
  CLEF_TRUNCATION_MARKER,
  buildClefState,
  clefStateStrings,
  isWithinRawIntakeBounds,
  type ClefStateResult
} from './clef-state-builder'

function stateOf(result: ClefStateResult) {
  if (!result.ok) {
    throw new Error(`expected a state, got ${result.blocker.detail}`)
  }
  return result.state
}

describe('buildClefState', () => {
  it('builds the minimal TaskSpec state from an objective', () => {
    expect(buildClefState({ objective: '  Add a retry button.  ' })).toEqual({
      ok: true,
      state: { objective: 'Add a retry button.', data_class: CLEF_STATE_DATA_CLASS }
    })
    expect(CLEF_STATE_DATA_CLASS).toBe('agent_task_spec')
  })

  it('keeps labeled optional fields in a deterministic key order', () => {
    const result = buildClefState({
      explicitConstraints: ['Do not touch the database.'],
      acceptanceCriteria: ['Tests pass.', '   ', 'Lint is clean.'],
      expectedOutputs: ['A pull request.'],
      objective: 'Add a retry button.'
    })
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(Object.keys(result.state)).toEqual([
      'objective',
      'expected_outputs',
      'acceptance_criteria',
      'explicit_constraints',
      'data_class'
    ])
    expect(result.state.acceptance_criteria).toEqual(['Tests pass.', 'Lint is clean.'])
    expect(clefStateStrings(result.state)).toEqual([
      'Add a retry button.',
      'A pull request.',
      'Tests pass.',
      'Lint is clean.',
      'Do not touch the database.',
      'agent_task_spec'
    ])
  })

  it('omits optional fields that are absent or blank', () => {
    const result = buildClefState({ objective: 'Plan it.', expectedOutputs: ['  ', ''] })
    expect(result).toEqual({
      ok: true,
      state: { objective: 'Plan it.', data_class: CLEF_STATE_DATA_CLASS }
    })
  })

  it('normalizes line endings and composes combining marks', () => {
    const result = buildClefState({ objective: 'Fix the café page.\r\nThen test.' })
    expect(result).toEqual({
      ok: true,
      state: { objective: 'Fix the café page.\nThen test.', data_class: CLEF_STATE_DATA_CLASS }
    })
  })

  it('is deterministic', () => {
    const input = { objective: 'Add a retry button.', acceptanceCriteria: ['Tests pass.'] }
    expect(JSON.stringify(buildClefState(input))).toBe(JSON.stringify(buildClefState(input)))
  })

  it('blocks a blank objective as missing input', () => {
    expect(buildClefState({ objective: ' \n\t ' })).toEqual({
      ok: false,
      blocker: { reason: 'missing_inputs', detail: 'needs_clarification' }
    })
  })

  it('classifies a non-English objective: the state carries it as written (D-027)', () => {
    expect(buildClefState({ objective: '修复登录页面' })).toEqual({
      ok: true,
      state: { objective: '修复登录页面', data_class: CLEF_STATE_DATA_CLASS }
    })
  })

  it('keeps non-English text in an optional field', () => {
    const state = stateOf(
      buildClefState({ objective: 'Fix the login page.', acceptanceCriteria: ['页面可以登录'] })
    )
    expect(state.acceptance_criteria).toEqual(['页面可以登录'])
  })

  it('sends an objective over 2,000 characters as an excerpt ending in the truncation marker', () => {
    expect(CLEF_OBJECTIVE_MAX_CHARS).toBe(2_000)
    expect(CLEF_TRUNCATION_MARKER).toBe('[truncated]')
    const atCap = 'a'.repeat(CLEF_OBJECTIVE_MAX_CHARS)
    expect(stateOf(buildClefState({ objective: atCap })).objective).toBe(atCap)
    const cut = stateOf(buildClefState({ objective: `${atCap}b` })).objective
    expect(cut.length).toBeLessThanOrEqual(CLEF_OBJECTIVE_MAX_CHARS)
    expect(cut).toBe(`${'a'.repeat(CLEF_OBJECTIVE_MAX_CHARS - 12)} ${CLEF_TRUNCATION_MARKER}`)
  })

  it('cuts a long list item to an excerpt and a long list to its head plus a count', () => {
    const tooMany = Array.from({ length: CLEF_STATE_LIST_MAX_ITEMS + 3 }, (_, i) => `Item ${i}.`)
    const outputs = stateOf(
      buildClefState({ objective: 'Plan it.', expectedOutputs: tooMany })
    ).expected_outputs
    expect(outputs).toHaveLength(CLEF_STATE_LIST_MAX_ITEMS)
    expect(outputs?.slice(0, -1)).toEqual(tooMany.slice(0, CLEF_STATE_LIST_MAX_ITEMS - 1))
    expect(outputs?.at(-1)).toBe('[truncated: 4 more items]')
    const longItem = 'b'.repeat(CLEF_STATE_LIST_ITEM_MAX_CHARS + 1)
    const [item] =
      stateOf(buildClefState({ objective: 'Plan it.', explicitConstraints: [longItem] }))
        .explicit_constraints ?? []
    expect(item?.length).toBeLessThanOrEqual(CLEF_STATE_LIST_ITEM_MAX_CHARS)
    expect(item?.endsWith(` ${CLEF_TRUNCATION_MARKER}`)).toBe(true)
    const maxed = Array.from({ length: CLEF_STATE_LIST_MAX_ITEMS }, () =>
      'c'.repeat(CLEF_STATE_LIST_ITEM_MAX_CHARS)
    )
    expect(
      stateOf(buildClefState({ objective: 'Plan it.', explicitConstraints: maxed }))
        .explicit_constraints
    ).toEqual(maxed)
  })

  it('never cuts a surrogate pair in half', () => {
    const objective = `${'a'.repeat(CLEF_OBJECTIVE_MAX_CHARS - 13)}${'🚀'.repeat(10)}`
    const cut = stateOf(buildClefState({ objective })).objective
    // Why encodeURIComponent: it throws on a lone surrogate.
    expect(() => encodeURIComponent(cut)).not.toThrow()
    expect(cut).toBe(`${'a'.repeat(CLEF_OBJECTIVE_MAX_CHARS - 13)} ${CLEF_TRUNCATION_MARKER}`)
  })

  it('cuts to smaller caps when asked, for a request that must fit its body budget', () => {
    const state = stateOf(
      buildClefState(
        { objective: 'o'.repeat(500), expectedOutputs: ['e'.repeat(300), 'f', 'g'] },
        { objectiveChars: 100, listItems: 2, listItemChars: 50 }
      )
    )
    expect(state.objective).toHaveLength(100)
    expect(state.expected_outputs).toEqual([
      `${'e'.repeat(38)} ${CLEF_TRUNCATION_MARKER}`,
      '[truncated: 2 more items]'
    ])
  })
})

describe('buildClefState verbatim spans (D-013)', () => {
  const PLACEHOLDER = '[quoted text]'
  const scripts = [
    ['CJK', '\u767B\u5F55\u9875\u9762'],
    ['Cyrillic', '\u0441\u0435\u0440\u0432\u0435\u0440'],
    ['RTL Arabic', '\u0645\u0631\u062D\u0628\u0627'],
    ['RTL Hebrew', '\u05E9\u05DC\u05D5\u05DD'],
    ['combining marks', 'e\u0301a\u0308o\u0302'],
    ['emoji', '\u{1F680}\u{1F9D1}\u200D\u{1F4BB}']
  ] as const

  it.each(scripts)(
    'lets %s through inside a quoted span and sends only the placeholder',
    (_label, content) => {
      const result = buildClefState({ objective: `Rename "${content}" to the new name.` })
      expect(result).toEqual({
        ok: true,
        state: {
          objective: `Rename ${PLACEHOLDER} to the new name.`,
          data_class: CLEF_STATE_DATA_CLASS
        }
      })
      expect(JSON.stringify(result)).not.toContain(content)
    }
  )

  it('masks every delimiter family and every span of a text', () => {
    const result = buildClefState({
      objective: 'Compare "a登" with `b登` and “c登”, then ```d登\ne```.'
    })
    expect(result).toEqual({
      ok: true,
      state: {
        objective: `Compare ${PLACEHOLDER} with ${PLACEHOLDER} and ${PLACEHOLDER}, then ${PLACEHOLDER}.`,
        data_class: CLEF_STATE_DATA_CLASS
      }
    })
  })

  it('masks spans in the optional list fields too', () => {
    const result = buildClefState({
      objective: 'Plan the rename.',
      expectedOutputs: ['A file named "报告.md".'],
      acceptanceCriteria: ['`登录`'],
      explicitConstraints: ['Keep “ファイル” untouched.']
    })
    expect(result.ok && clefStateStrings(result.state)).toEqual([
      'Plan the rename.',
      `A file named ${PLACEHOLDER}.`,
      PLACEHOLDER,
      `Keep ${PLACEHOLDER} untouched.`,
      CLEF_STATE_DATA_CLASS
    ])
  })

  it.each([
    ['CJK prose around a span', 'Fix 登录 "page" now.', `Fix 登录 ${PLACEHOLDER} now.`],
    ['CJK prose only', '修复登录页面', '修复登录页面'],
    ['an unterminated quote with CJK text', 'Fix "登录 now.', 'Fix "登录 now.'],
    ['emoji prose next to a span', 'Ship 🚀 "now".', `Ship 🚀 ${PLACEHOLDER}.`]
  ])('classifies non-Latin prose and still masks its spans: %s', (_label, objective, sent) => {
    expect(stateOf(buildClefState({ objective })).objective).toBe(sent)
  })

  it('keeps a span over 1,000 characters as prose, cut to the objective cap', () => {
    const objective = stateOf(
      buildClefState({ objective: `Fix "${'登'.repeat(2_500)}" now.` })
    ).objective
    expect(objective.startsWith('Fix "登登')).toBe(true)
    expect(objective.endsWith(` ${CLEF_TRUNCATION_MARKER}`)).toBe(true)
  })

  it('keeps non-Latin prose in an optional field and masks its spans', () => {
    const state = stateOf(
      buildClefState({ objective: 'Fix "page".', explicitConstraints: ['页面 "x"'] })
    )
    expect(state.explicit_constraints).toEqual([`页面 ${PLACEHOLDER}`])
  })

  it.each([
    ['one span only', '"登录页面"'],
    ['several spans and punctuation', '"a" ... `b` 123 “c”'],
    ['a fence only', '```\n登录\n```']
  ])('asks for clarification when no letters remain outside the spans: %s', (_label, objective) => {
    expect(buildClefState({ objective })).toEqual({
      ok: false,
      blocker: { reason: 'missing_inputs', detail: 'needs_clarification' }
    })
  })

  it('does not count the literal placeholder text in the prose as a letter source', () => {
    const result = buildClefState({ objective: 'Fix "x" now.' })
    expect(result.ok).toBe(true)
    expect(buildClefState({ objective: '"x"' }).ok).toBe(false)
  })

  it('masks every span past the 32nd too, instead of blocking (D-027)', () => {
    const spans = (count: number) => Array.from({ length: count }, () => '"登"').join(' ')
    expect(stateOf(buildClefState({ objective: `Rename ${spans(40)}.` })).objective).toBe(
      `Rename ${Array.from({ length: 40 }, () => PLACEHOLDER).join(' ')}.`
    )
  })

  it('applies the character cap to the masked text, and never cuts a placeholder', () => {
    const longSpan = `"${'登'.repeat(900)}"`
    const objective = `Rename ${[longSpan, longSpan, longSpan].join(' and ')} please.`
    expect(objective.length).toBeGreaterThan(CLEF_OBJECTIVE_MAX_CHARS)
    expect(stateOf(buildClefState({ objective })).objective).toBe(
      `Rename ${PLACEHOLDER} and ${PLACEHOLDER} and ${PLACEHOLDER} please.`
    )
    const prose = 'b'.repeat(CLEF_OBJECTIVE_MAX_CHARS - PLACEHOLDER.length)
    expect(stateOf(buildClefState({ objective: `${prose}"x"` })).objective).toBe(
      `${prose}${PLACEHOLDER}`
    )
    const cut = stateOf(buildClefState({ objective: `${prose}b"x"` })).objective
    expect(cut).toBe(`${'b'.repeat(CLEF_OBJECTIVE_MAX_CHARS - 12)} ${CLEF_TRUNCATION_MARKER}`)
    const atPlaceholder = `${'b'.repeat(CLEF_OBJECTIVE_MAX_CHARS - 16)}"x" tail`
    expect(stateOf(buildClefState({ objective: atPlaceholder })).objective).toBe(
      `${'b'.repeat(CLEF_OBJECTIVE_MAX_CHARS - 16)} ${CLEF_TRUNCATION_MARKER}`
    )
  })

  it('normalizes only the text outside the spans for the state, which holds placeholders alone', () => {
    const nfd = buildClefState({ objective: 'Fix the café page and "café".' })
    const nfc = buildClefState({ objective: 'Fix the café page and "café".' })
    expect(nfd).toEqual(nfc)
  })

  it('is deterministic with spans', () => {
    const input = { objective: 'Rename "登录" and `x`.' }
    expect(JSON.stringify(buildClefState(input))).toBe(JSON.stringify(buildClefState(input)))
  })
})

describe('isWithinRawIntakeBounds', () => {
  it('bounds the whole raw TaskSpec at the TaskSpec ceiling, not at the state caps', () => {
    expect(CLEF_RAW_INTAKE_MAX_CHARS).toBe(256 * 1024)
    const half = 'a'.repeat(CLEF_RAW_INTAKE_MAX_CHARS / 2)
    expect(isWithinRawIntakeBounds({ objective: half, acceptanceCriteria: [half] })).toBe(true)
    expect(
      isWithinRawIntakeBounds({
        objective: 'Plan it.',
        expectedOutputs: Array.from({ length: 1_000 }, () => 'b'.repeat(200))
      })
    ).toBe(true)
  })

  it.each([
    ['an objective', { objective: 'a'.repeat(CLEF_RAW_INTAKE_MAX_CHARS + 1) }],
    [
      'the fields together',
      {
        objective: 'a'.repeat(CLEF_RAW_INTAKE_MAX_CHARS / 2),
        explicitConstraints: ['b'.repeat(CLEF_RAW_INTAKE_MAX_CHARS / 2), 'c']
      }
    ]
  ])('rejects %s past the bound', (_label, input) => {
    expect(isWithinRawIntakeBounds(input)).toBe(false)
  })
})
