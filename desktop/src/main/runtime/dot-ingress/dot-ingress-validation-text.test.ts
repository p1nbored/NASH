import { describe, expect, it } from 'vitest'
import { scanClefText } from '../../clef/clef-content-scan'
import { hasSecretLikeText } from '../../agent-exec-shared/secret-shapes'
import {
  DOT_VALIDATION_TITLE_FALLBACK,
  dotSafeLine,
  dotValidationTitle
} from './dot-ingress-validation-text'

// FIXTURE_ONLY: every path, token and address below is synthetic.
const FAKE_GITHUB_TOKEN = `ghp_${'Zx9Yw8Vu7T'.repeat(3)}`
const FAKE_TOKEN_RUN = 'Q7wErTyUiOpAsDfGhJkLzXcVbNm1234567890QwEr'

function shown(text: string, max = 500): string {
  const result = dotSafeLine(text, max)
  expect(result.withheld, text).toBe(false)
  if (result.line === null) {
    throw new Error(`no line for ${text}`)
  }
  return result.line
}

describe('dot validation text: what dot may read of a title or summary', () => {
  it('keeps an ordinary English line unchanged', () => {
    expect(dotSafeLine('Listed four open issues and their owners.', 500)).toEqual({
      line: 'Listed four open issues and their owners.',
      withheld: false
    })
  })

  it('has nothing to show for empty or blank text, without calling it withheld', () => {
    for (const blank of [null, '', '   \n\t ']) {
      expect(dotSafeLine(blank, 500)).toEqual({ line: null, withheld: false })
    }
  })

  it('folds lines and neutralises controls, bidi overrides and line separators', () => {
    const line = shown('First line.\r\nSecond\u2028line\u2029end \u0007bell \u202Eevil\u2066 x')
    expect(line).not.toMatch(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u)
    expect(line).toContain('First line. Second')
    expect(line).toContain('bell')
  })

  it('turns bidi embeddings, isolates and separators into spaces with the shared display rule', () => {
    expect(shown('Fix \u202Eevil\u202C and \u2066docs\u2069 now\u2028done')).toBe(
      'Fix evil and docs now done'
    )
  })

  it('never shows a path: Windows, UNC, POSIX, relative and file URLs become a placeholder', () => {
    const line = shown(
      'Edited C:\\Users\\fixture\\repo\\src\\a.ts and \\\\server\\share\\b.txt, /home/fixture/c.md, src/d.ts and file:///tmp/e.txt.'
    )
    expect(line).toBe('Edited [path] and [path] [path] [path] and [path]')
    for (const part of ['Users', 'fixture', 'server', 'home', 'src', 'tmp']) {
      expect(line).not.toContain(part)
    }
  })

  it('masks names and paths inside quoted spans as Clef does', () => {
    expect(shown('Updated "docs/plan.md" and `notes.txt` as asked.')).toBe(
      'Updated [quoted text] and [quoted text] as asked.'
    )
  })

  it('masks credentials, e-mail addresses and long hex identifiers', () => {
    const line = shown(
      `Used token ${FAKE_GITHUB_TOKEN}, mailed owner@example.com about commit 0123456789abcdef0123456789abcdef01234567.`
    )
    expect(line).toBe('Used token [redacted], mailed [email] about commit [id].')
    expect(hasSecretLikeText(line)).toBe(false)
  })

  it('withholds a summary the content scan still flags after masking', () => {
    expect(dotSafeLine(`The key is ${FAKE_TOKEN_RUN} now.`, 500)).toEqual({
      line: null,
      withheld: true
    })
  })

  it('cuts to the bound in code points and leaves a line the scan accepts', () => {
    const long = `${'Checked the build output carefully. '.repeat(40)}😀😀`
    const line = shown(long, 120)
    expect(Array.from(line).length).toBeLessThanOrEqual(120)
    expect(line.endsWith('…')).toBe(true)
    expect(scanClefText(line)).toEqual([])
  })

  it('never shows a fragment of a credential cut at the scan window', () => {
    const span = `"${'x'.repeat(898)}"`
    const text = `${span} ${span} ${'y'.repeat(190)} ${FAKE_GITHUB_TOKEN}`
    expect(text.indexOf('ghp_')).toBe(1993)
    const line = shown(text, 500)
    expect(line).toContain('[quoted text] [quoted text] yyy')
    expect(line).not.toContain('ghp')
  })

  it('uses a fixed English title when nothing safe remains', () => {
    expect(dotValidationTitle('Fix the "parser" bug')).toBe('Fix the [quoted text] bug')
    expect(dotValidationTitle(null)).toBe(DOT_VALIDATION_TITLE_FALLBACK)
    expect(dotValidationTitle(`Rotate ${FAKE_TOKEN_RUN}`)).toBe(DOT_VALIDATION_TITLE_FALLBACK)
    expect(Array.from(dotValidationTitle('x'.repeat(400))).length).toBeLessThanOrEqual(200)
  })
})
