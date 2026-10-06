import { describe, expect, it } from 'vitest'
import { createJsonlLineReader, type JsonlLine } from './codex-exec-jsonl-line-reader'

function collect(maxLineBytes: number, prefixBytes?: number) {
  const lines: JsonlLine[] = []
  const reader = createJsonlLineReader({
    maxLineBytes,
    ...(prefixBytes === undefined ? {} : { prefixBytes }),
    onLine: (line) => lines.push(line)
  })
  return { lines, reader }
}

describe('createJsonlLineReader', () => {
  it('emits complete lines split across chunk boundaries', () => {
    const { lines, reader } = collect(1024)
    reader.push(Buffer.from('{"a":1}\n{"b"'))
    reader.push(Buffer.from(':2}\n'))
    reader.end()
    expect(lines).toEqual([
      { kind: 'line', text: '{"a":1}', lineNumber: 1 },
      { kind: 'line', text: '{"b":2}', lineNumber: 2 }
    ])
  })

  it('flushes a final line that has no trailing newline on end()', () => {
    const { lines, reader } = collect(1024)
    reader.push(Buffer.from('{"a":1}\n{"tail":true}'))
    expect(lines).toHaveLength(1)
    reader.end()
    expect(lines.at(-1)).toEqual({ kind: 'line', text: '{"tail":true}', lineNumber: 2 })
  })

  it('strips CRLF and skips blank lines while still numbering them', () => {
    const { lines, reader } = collect(1024)
    reader.push(Buffer.from('one\r\n\r\n   \ntwo\r\n'))
    reader.end()
    expect(lines).toEqual([
      { kind: 'line', text: 'one', lineNumber: 1 },
      { kind: 'line', text: 'two', lineNumber: 4 }
    ])
  })

  it('never splits a multi-byte UTF-8 character that straddles chunks', () => {
    const { lines, reader } = collect(1024)
    const bytes = Buffer.from('{"t":"café 你好 🌍"}\n', 'utf8')
    for (let index = 0; index < bytes.length; index += 1) {
      reader.push(bytes.subarray(index, index + 1))
    }
    reader.end()
    expect(lines).toEqual([{ kind: 'line', text: '{"t":"café 你好 🌍"}', lineNumber: 1 }])
  })

  it('accepts a line of exactly the maximum size and flags one byte more', () => {
    const exact = collect(10)
    exact.reader.push(Buffer.from('0123456789\n'))
    exact.reader.end()
    expect(exact.lines).toEqual([{ kind: 'line', text: '0123456789', lineNumber: 1 }])

    const over = collect(10)
    over.reader.push(Buffer.from('0123456789A\nnext\n'))
    over.reader.end()
    expect(over.lines).toEqual([
      { kind: 'oversized', lineNumber: 1, totalBytes: 11, prefix: '0123456789A' },
      { kind: 'line', text: 'next', lineNumber: 2 }
    ])
  })

  it('discards an oversized line across many chunks without retaining it', () => {
    const { lines, reader } = collect(64, 16)
    reader.push(Buffer.from('{"type":"item.completed","pad":"'))
    for (let index = 0; index < 1000; index += 1) {
      reader.push(Buffer.from('x'.repeat(100)))
    }
    reader.push(Buffer.from('"}\n{"type":"turn.completed"}\n'))
    reader.end()
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({ kind: 'oversized', lineNumber: 1 })
    const first = lines[0]
    if (first.kind === 'oversized') {
      expect(first.totalBytes).toBeGreaterThan(100_000)
      expect(first.prefix.length).toBeLessThanOrEqual(16)
      expect(first.prefix.startsWith('{"type":"item.co')).toBe(true)
    }
    expect(lines[1]).toEqual({ kind: 'line', text: '{"type":"turn.completed"}', lineNumber: 2 })
  })

  it('flags an oversized unterminated final line on end()', () => {
    const { lines, reader } = collect(8)
    reader.push(Buffer.from('this line is far too long'))
    reader.end()
    expect(lines).toEqual([
      { kind: 'oversized', lineNumber: 1, totalBytes: 25, prefix: 'this line is far too long' }
    ])
  })

  it('ignores pushes after end()', () => {
    const { lines, reader } = collect(64)
    reader.end()
    reader.push(Buffer.from('late\n'))
    expect(lines).toEqual([])
  })
})
