// FIXTURE_ONLY: synthetic CLI output; no process is started.
import { describe, expect, it } from 'vitest'
import { createTranscriptLineSplitter } from './attempt-transcript-lines'
import type { TranscriptRecord } from './attempt-transcript-records'
import type { TranscriptSink } from './attempt-transcript'

function recorder(): { records: TranscriptRecord[]; sink: TranscriptSink } {
  const records: TranscriptRecord[] = []
  return { records, sink: { append: (record) => records.push(record), fault: () => {} } }
}

const bytes = (text: string) => Buffer.from(text, 'utf8')

describe('createTranscriptLineSplitter', () => {
  it('writes one output record per line, named by stream, without the CR of CRLF', () => {
    const { records, sink } = recorder()
    const lines = createTranscriptLineSplitter('stderr', sink)
    lines.push(bytes('first\r\nsecond\n'))
    expect(records).toEqual([
      { kind: 'output', stream: 'stderr', text: 'first' },
      { kind: 'output', stream: 'stderr', text: 'second' }
    ])
  })

  it('joins a line split across chunks, even inside a multibyte character', () => {
    const { records, sink } = recorder()
    const lines = createTranscriptLineSplitter('stdout', sink)
    const whole = bytes('café 界 done\n')
    lines.push(whole.subarray(0, 4))
    lines.push(whole.subarray(4, 8))
    expect(records).toEqual([])
    lines.push(whole.subarray(8))
    expect(records).toEqual([{ kind: 'output', stream: 'stdout', text: 'café 界 done' }])
  })

  it('keeps blank lines, flushes a final partial line at end and ignores later pushes', () => {
    const { records, sink } = recorder()
    const lines = createTranscriptLineSplitter('stdout', sink)
    lines.push(bytes('# Title\n\nbody'))
    lines.end()
    lines.push(bytes('late\n'))
    lines.end()
    expect(records.map((record) => (record.kind === 'output' ? record.text : null))).toEqual([
      '# Title',
      '',
      'body'
    ])
  })

  it('writes nothing for output that ends with its newline', () => {
    const { records, sink } = recorder()
    const lines = createTranscriptLineSplitter('stdout', sink)
    lines.push(bytes('only\n'))
    lines.end()
    expect(records).toHaveLength(1)
  })

  it('holds at most the line cap of an over-long line and still writes one record for it', () => {
    const { records, sink } = recorder()
    const lines = createTranscriptLineSplitter('stdout', sink, 1024)
    lines.push(bytes('x'.repeat(800)))
    lines.push(bytes('y'.repeat(800)))
    lines.push(bytes('z'.repeat(800)))
    lines.push(bytes('\nnext\n'))
    expect(records).toHaveLength(2)
    const first = records[0]
    expect(first?.kind === 'output' ? first.text : '').toBe(`${'x'.repeat(800)}${'y'.repeat(224)}`)
    expect(records[1]).toEqual({ kind: 'output', stream: 'stdout', text: 'next' })
  })
})
