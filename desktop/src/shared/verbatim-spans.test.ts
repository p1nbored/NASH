import { describe, expect, it } from 'vitest'
import {
  VERBATIM_SPAN_MAX_CHARS,
  VERBATIM_SPAN_MAX_COUNT,
  VERBATIM_SPAN_PLACEHOLDER,
  splitVerbatimSpans,
  type VerbatimSpan
} from './verbatim-spans'

function split(text: string): { prose: string; outsideSpans: string; spans: VerbatimSpan[] } {
  const result = splitVerbatimSpans(text)
  if (!result.ok) {
    throw new Error(`unexpected ${result.reason}`)
  }
  return { prose: result.prose, outsideSpans: result.outsideSpans, spans: [...result.spans] }
}

describe('verbatim span constants', () => {
  it('pins the D-013 limits and the neutral placeholder', () => {
    expect(VERBATIM_SPAN_PLACEHOLDER).toBe('[quoted text]')
    expect(VERBATIM_SPAN_MAX_CHARS).toBe(1_000)
    expect(VERBATIM_SPAN_MAX_COUNT).toBe(32)
  })
})

describe('splitVerbatimSpans delimiters', () => {
  it.each([
    [
      'double quotes',
      'Rename "old name" to the new one.',
      'double_quote',
      '"old name"',
      'old name'
    ],
    [
      'typographic double quotes',
      'Rename “old name” to the new one.',
      'typographic_quote',
      '“old name”',
      'old name'
    ],
    ['single backticks', 'Rename `old name` to the new one.', 'backtick', '`old name`', 'old name'],
    [
      'a triple-backtick fence',
      'Rename\n```\nold name\n```\nto the new one.',
      'fence',
      '```\nold name\n```',
      '\nold name\n'
    ]
  ])('masks %s', (_label, text, kind, raw, content) => {
    const { prose, spans } = split(text)
    expect(spans).toHaveLength(1)
    expect(spans[0]).toMatchObject({ kind, raw, content })
    expect(prose).toBe(text.replace(raw, VERBATIM_SPAN_PLACEHOLDER))
    expect(text.slice(spans[0]?.start, spans[0]?.end)).toBe(raw)
  })

  it('replaces every span with the placeholder and lists them in order', () => {
    const { prose, spans } = split('Compare "a" with `b` and “c”, then ```d``` too.')
    expect(prose).toBe(
      `Compare ${'[quoted text]'} with [quoted text] and [quoted text], then [quoted text] too.`
    )
    expect(spans.map((span) => span.content)).toEqual(['a', 'b', 'c', 'd'])
    expect(spans.map((span) => span.kind)).toEqual([
      'double_quote',
      'backtick',
      'typographic_quote',
      'fence'
    ])
  })

  it('returns the text outside spans separately from the placeholders', () => {
    const { outsideSpans } = split('Fix "x" now.')
    expect(outsideSpans).toBe('Fix   now.')
    expect(outsideSpans).not.toContain('quoted')
  })

  it('returns text without delimiters unchanged', () => {
    expect(split('Add a retry button.')).toEqual({
      prose: 'Add a retry button.',
      outsideSpans: 'Add a retry button.',
      spans: []
    })
    expect(split('')).toEqual({ prose: '', outsideSpans: '', spans: [] })
  })

  it('does not treat single typographic quotes or ASCII apostrophes as delimiters', () => {
    const text = "Don’t rename ‘this’ or isn't that one."
    expect(split(text)).toEqual({ prose: text, outsideSpans: text, spans: [] })
  })

  it('does not nest: the first closing delimiter of the same family ends the span', () => {
    const quoted = split('Say "a “b” `c` d" now.')
    expect(quoted.spans).toHaveLength(1)
    expect(quoted.spans[0]?.content).toBe('a “b” `c` d')
    const typographic = split('Say “a "b" c” now.')
    expect(typographic.spans).toHaveLength(1)
    expect(typographic.spans[0]?.content).toBe('a "b" c')
    const fenced = split('Run ```a `b` c``` now.')
    expect(fenced.spans).toHaveLength(1)
    expect(fenced.spans[0]?.content).toBe('a `b` c')
  })

  it('ends a typographic span at the first closing mark, even when another opener comes first', () => {
    const { spans } = split('“a “b” c”')
    expect(spans).toHaveLength(1)
    expect(spans[0]?.raw).toBe('“a “b”')
  })

  it('has no escape syntax: a backslash does not protect a delimiter', () => {
    const { spans } = split('Use "a\\" then b"')
    expect(spans.map((span) => span.content)).toEqual(['a\\'])
  })
})

describe('splitVerbatimSpans prose fallbacks', () => {
  it.each([
    ['an unterminated double quote', 'Say "hello there'],
    ['an unterminated typographic quote', 'Say “hello there'],
    ['an unterminated backtick', 'Say `hello there'],
    ['an unterminated fence', 'Say ```hello there'],
    ['a lone closing typographic quote', 'Say hello” there'],
    ['empty double quotes', 'Say "" there'],
    ['empty typographic quotes', 'Say “” there'],
    ['empty backticks', 'Say `` there'],
    ['an empty fence', 'Say ```` there']
  ])('keeps %s as prose', (_label, text) => {
    expect(split(text)).toEqual({ prose: text, outsideSpans: text, spans: [] })
  })

  it('keeps a stray quote after a valid span as prose', () => {
    const { prose, spans } = split('A "x" and a stray " here')
    expect(spans.map((span) => span.content)).toEqual(['x'])
    expect(prose).toBe('A [quoted text] and a stray " here')
  })

  it('treats three backticks as a fence opener only, never as an empty span plus an opener', () => {
    const { spans } = split('```a```')
    expect(spans.map((span) => [span.kind, span.content])).toEqual([['fence', 'a']])
  })
})

describe('splitVerbatimSpans length and count limits', () => {
  const quoted = (contentLength: number) => `"${'x'.repeat(contentLength)}"`

  it('accepts a span of exactly 1,000 characters, delimiters included', () => {
    const text = quoted(VERBATIM_SPAN_MAX_CHARS - 2)
    expect(split(text).spans).toHaveLength(1)
  })

  it('leaves a span of 1,001 characters as prose', () => {
    const text = quoted(VERBATIM_SPAN_MAX_CHARS - 1)
    expect(split(text)).toEqual({ prose: text, outsideSpans: text, spans: [] })
  })

  it('consumes an overlong pair as prose so later quotes keep pairing left to right', () => {
    const long = quoted(2_000)
    const { prose, spans } = split(`${long} then "short"`)
    expect(spans.map((span) => span.content)).toEqual(['short'])
    expect(prose).toBe(`${long} then [quoted text]`)
  })

  it('keeps an overlong fence as prose and still masks the next one', () => {
    const long = `\`\`\`${'x'.repeat(2_000)}\`\`\``
    const { prose, spans } = split(`${long} then \`\`\`short\`\`\``)
    expect(spans.map((span) => span.content)).toEqual(['short'])
    expect(prose).toBe(`${long} then [quoted text]`)
  })

  it('accepts exactly 32 spans', () => {
    const result = splitVerbatimSpans(Array.from({ length: 32 }, () => '"a"').join(' '))
    expect(result.ok).toBe(true)
  })

  it('reports too_many_spans for 33 spans', () => {
    const result = splitVerbatimSpans(Array.from({ length: 33 }, () => '"a"').join(' '))
    expect(result).toEqual({ ok: false, reason: 'too_many_spans' })
  })

  it('pairs and masks past 32 spans with the same rules when a caller lifts the count', () => {
    const text = Array.from({ length: 40 }, (_, index) => `"s${index}"`).join(' ')
    const result = splitVerbatimSpans(text, { maxSpans: Number.POSITIVE_INFINITY })
    if (!result.ok) {
      throw new Error('expected a split')
    }
    expect(result.spans).toHaveLength(40)
    expect(result.spans.at(-1)?.content).toBe('s39')
    expect(result.prose).toBe(Array.from({ length: 40 }, () => '[quoted text]').join(' '))
  })
})

describe('splitVerbatimSpans byte preservation', () => {
  const scripts = [
    ['CJK', '登录页面'],
    ['Cyrillic', 'сервер'],
    ['Arabic', 'مرحبا'],
    ['Hebrew', 'שלום'],
    ['Devanagari', 'नमस्ते'],
    ['emoji', '\u{1F680}\u{1F9D1}‍\u{1F4BB}'],
    ['combining marks', 'éä'],
    ['a lone surrogate', 'a\uD800b']
  ] as const

  it.each(scripts)(
    'keeps %s bytes inside a span exactly and masks them out of the prose',
    (_label, content) => {
      const text = `Fix "${content}" now.`
      const { prose, spans } = split(text)
      expect(spans[0]?.content).toBe(content)
      expect(spans[0]?.raw).toBe(`"${content}"`)
      expect(prose).toBe('Fix [quoted text] now.')
      expect(prose).not.toContain(content)
    }
  )

  it('does not normalize: NFC and NFD spans keep their own code points', () => {
    const nfc = 'café'
    const nfd = 'café'
    const { spans } = split(`"${nfc}" and "${nfd}"`)
    expect(spans.map((span) => span.content)).toEqual([nfc, nfd])
    expect(spans[0]?.content).not.toBe(spans[1]?.content)
  })

  it('does not trim or rewrite line endings outside the spans', () => {
    const { prose } = split('  Fix\r\n"a"\r\n  now.  ')
    expect(prose).toBe('  Fix\r\n[quoted text]\r\n  now.  ')
  })
})

describe('splitVerbatimSpans cost', () => {
  const adversarial = [
    ['one repeated quote', '"'.repeat(120_000)],
    ['one repeated backtick', '`'.repeat(120_000)],
    ['repeated fences', '```'.repeat(40_000)],
    ['openers with distant closers', `"${'x'.repeat(1_001)}`.repeat(100)],
    ['fence openers with distant closers', `\`\`\`${'x'.repeat(1_001)}`.repeat(100)],
    ['unterminated openers', '“a '.repeat(40_000)]
  ] as const

  it.each(adversarial)('stays linear on %s', (_label, text) => {
    const started = performance.now()
    splitVerbatimSpans(text)
    // Why: a quadratic scan of 120,000 characters would take many seconds.
    expect(performance.now() - started).toBeLessThan(1_500)
  })
})
