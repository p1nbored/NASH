import { afterEach, describe, expect, it, vi } from 'vitest'
import { scanClefContent } from './clef-content-scan'
import type * as ClefContentScanModule from './clef-content-scan'
import { buildClefRequest } from './clef-request-builder'

vi.mock('./clef-content-scan', async (importOriginal) => {
  const actual = await importOriginal<typeof ClefContentScanModule>()
  return { ...actual, scanClefContent: vi.fn(actual.scanClefContent) }
})

const scan = vi.mocked(scanClefContent)
const PLACEHOLDER = '[quoted text]'

const SCRIPTS = [
  ['CJK', '\u767B\u5F55\u9875\u9762'],
  ['Cyrillic', '\u0441\u0435\u0440\u0432\u0435\u0440'],
  ['RTL Arabic', '\u0645\u0631\u062D\u0628\u0627'],
  ['RTL Hebrew', '\u05E9\u05DC\u05D5\u05DD'],
  ['combining marks', 'e\u0301a\u0308o\u0302'],
  ['emoji', '\u{1F680}\u{1F9D1}\u200D\u{1F4BB}']
] as const

function bodyText(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes)
}

afterEach(() => {
  scan.mockClear()
})

describe('buildClefRequest verbatim spans (D-013)', () => {
  it.each(SCRIPTS)(
    'builds a request when %s sits inside a span and leaves its bytes out of the body',
    (_label, content) => {
      const result = buildClefRequest({ objective: `Rename "${content}" to the new name.` })
      expect(result.ok).toBe(true)
      if (!result.ok) {
        return
      }
      const serialized = bodyText(result.request.bodyBytes)
      expect(serialized).not.toContain(content)
      expect(serialized).not.toContain(content.normalize('NFC'))
      expect(result.request.body.state.objective).toBe(`Rename ${PLACEHOLDER} to the new name.`)
      expect(JSON.stringify(result.request.body)).not.toContain(content)
    }
  )

  it('never lets span characters reach the body through any delimiter family', () => {
    const result = buildClefRequest({
      objective:
        'Move "\u767B\u5F55", `\u0645\u0631\u062D\u0628\u0627` and \u201C\u05E9\u05DC\u05D5\u05DD\u201D.',
      expectedOutputs: ['```\n\u{1F680}\n```']
    })
    expect(result.ok).toBe(true)
    const serialized = result.ok ? bodyText(result.request.bodyBytes) : ''
    for (const [, content] of SCRIPTS) {
      expect(serialized).not.toContain(content)
    }
  })

  it('masks spans in every TaskSpec field, not only the objective', () => {
    const result = buildClefRequest({
      objective: 'Rename the page.',
      expectedOutputs: ['A note about "\u767B\u5F55".'],
      acceptanceCriteria: ['`\u0441\u0435\u0440\u0432\u0435\u0440` still starts.'],
      explicitConstraints: ['Keep \u201C\u05E9\u05DC\u05D5\u05DD\u201D as it is.']
    })
    expect(result.ok && result.request.body.state).toEqual({
      objective: 'Rename the page.',
      expected_outputs: [`A note about ${PLACEHOLDER}.`],
      acceptance_criteria: [`${PLACEHOLDER} still starts.`],
      explicit_constraints: [`Keep ${PLACEHOLDER} as it is.`],
      data_class: 'agent_task_spec'
    })
  })

  it('hashes the masked state, so the same prose with different spans is the same state', () => {
    const build = (name: string) => {
      const result = buildClefRequest({ objective: `Rename "${name}" now.` })
      return result.ok ? result.request.stateSha256 : null
    }
    expect(build('\u767B\u5F55')).not.toBeNull()
    expect(build('\u767B\u5F55')).toBe(build('\u0441\u0435\u0440'))
  })

  it('scans only the masked text, so a path or an email inside a span is not a data-boundary hit', () => {
    const result = buildClefRequest({
      objective: 'Open "C:\\work\\repo\\notes.txt" or "dev@example.com" and read it.'
    })
    expect(result.ok).toBe(true)
    const masked = `Open ${PLACEHOLDER} or ${PLACEHOLDER} and read it.`
    expect(scan.mock.calls).toEqual([[[masked]], [[masked, 'agent_task_spec']]])
  })

  it('still blocks a path or an email in the prose outside the spans', () => {
    const result = buildClefRequest({
      objective: 'Open C:\\work\\repo\\notes.txt and read "this".'
    })
    expect(result).toEqual({
      ok: false,
      blocker: { reason: 'classifier_unavailable', detail: 'data_boundary_forbids' },
      matchedRules: ['windows_absolute_path']
    })
  })

  it('builds for non-Latin prose and still masks its spans (D-027)', () => {
    const result = buildClefRequest({ objective: '\u4FEE\u590D "page" now' })
    expect(result.ok && result.request.body.state.objective).toBe(`\u4FEE\u590D ${PLACEHOLDER} now`)
  })

  it('maps an objective with no letters outside its spans to needs_clarification', () => {
    expect(buildClefRequest({ objective: '"\u767B\u5F55"' })).toEqual({
      ok: false,
      blocker: { reason: 'missing_inputs', detail: 'needs_clarification' },
      matchedRules: []
    })
  })

  it('masks more than 32 spans and scans only the masked text (D-027)', () => {
    const objective = `Rename ${Array.from({ length: 40 }, () => '"C:\\\\a"').join(' ')}.`
    const result = buildClefRequest({ objective })
    expect(result.ok && result.request.body.state.objective).toBe(
      `Rename ${Array.from({ length: 40 }, () => PLACEHOLDER).join(' ')}.`
    )
    expect(JSON.stringify(scan.mock.calls)).not.toContain('C:')
  })

  it('reports a data-boundary hit in the prose even when a span holds non-Latin text', () => {
    const result = buildClefRequest({
      objective: 'Bill 0123456789abcdef0123456789abcdef for "\u767B\u5F55".'
    })
    expect(!result.ok && result.blocker.detail).toBe('data_boundary_forbids')
  })
})
