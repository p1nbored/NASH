// Kept over createIncrementalNdjsonFramer: it takes decoded strings, counts decoded not raw bytes, and gives no line numbers or dropped-line size.

export type JsonlLine =
  | { readonly kind: 'line'; readonly text: string; readonly lineNumber: number }
  | {
      readonly kind: 'oversized'
      readonly lineNumber: number
      readonly totalBytes: number
      readonly prefix: string
    }

export type JsonlLineReaderOptions = {
  readonly maxLineBytes: number
  /** Bytes of an oversized line kept so its event type can still be hinted. */
  readonly prefixBytes?: number
  readonly onLine: (line: JsonlLine) => void
}

export type JsonlLineReader = {
  push: (chunk: Uint8Array) => void
  /** Flush a final line that has no trailing newline; later pushes are ignored. */
  end: () => void
}

const NEWLINE = 0x0a
const CARRIAGE_RETURN = 0x0d
const DEFAULT_PREFIX_BYTES = 256

/** Memory is bounded by maxLineBytes per line: an over-long line is dropped as it arrives, keeping a short prefix. */
class LineSplitter {
  private pending: Buffer[] = []
  private pendingBytes = 0
  private discardedBytes = 0
  private discardedPrefix: Buffer | null = null
  private lineNumber = 1
  private ended = false

  constructor(
    private readonly options: JsonlLineReaderOptions,
    private readonly prefixBytes: number
  ) {}

  push(chunk: Uint8Array): void {
    if (this.ended) {
      return
    }
    const buffer = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
    let offset = 0
    while (offset < buffer.length) {
      const newline = buffer.indexOf(NEWLINE, offset)
      if (newline === -1) {
        this.append(buffer.subarray(offset))
        return
      }
      this.append(buffer.subarray(offset, newline))
      this.finishLine()
      offset = newline + 1
    }
  }

  end(): void {
    if (this.ended) {
      return
    }
    this.ended = true
    if (this.pendingBytes > 0 || this.discardedPrefix !== null) {
      this.finishLine()
    }
  }

  private append(segment: Buffer): void {
    if (this.discardedPrefix !== null) {
      this.discardedBytes += segment.length
      return
    }
    if (this.pendingBytes + segment.length > this.options.maxLineBytes) {
      const joined = Buffer.concat([...this.pending, segment])
      this.discardedBytes = joined.length
      this.discardedPrefix = joined.subarray(0, this.prefixBytes)
      this.pending = []
      this.pendingBytes = 0
      return
    }
    this.pending.push(segment)
    this.pendingBytes += segment.length
  }

  private finishLine(): void {
    if (this.discardedPrefix !== null) {
      this.options.onLine({
        kind: 'oversized',
        lineNumber: this.lineNumber,
        totalBytes: this.discardedBytes,
        prefix: this.discardedPrefix.toString('utf8')
      })
    } else {
      this.emitText()
    }
    this.pending = []
    this.pendingBytes = 0
    this.discardedBytes = 0
    this.discardedPrefix = null
    this.lineNumber += 1
  }

  private emitText(): void {
    const bytes = this.pending.length === 1 ? this.pending[0] : Buffer.concat(this.pending)
    const end = bytes.at(-1) === CARRIAGE_RETURN ? bytes.length - 1 : bytes.length
    const text = bytes.subarray(0, end).toString('utf8')
    if (text.trim() !== '') {
      this.options.onLine({ kind: 'line', text, lineNumber: this.lineNumber })
    }
  }
}

export function createJsonlLineReader(options: JsonlLineReaderOptions): JsonlLineReader {
  const splitter = new LineSplitter(options, options.prefixBytes ?? DEFAULT_PREFIX_BYTES)
  return { push: (chunk) => splitter.push(chunk), end: () => splitter.end() }
}
