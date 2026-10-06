import type { TranscriptSink } from './attempt-transcript'

// Turns a pipe's chunks into one `output` record per line; a line is redacted whole, so a secret
// split across chunks is still seen. Memory per stream stays under the line cap.

/** Far above the 8 KiB record cap, so a cut line still ends with the trimmed marker. */
export const MAX_TRANSCRIPT_LINE_BYTES = 64 * 1024

const NEWLINE = 0x0a
const CARRIAGE_RETURN = 0x0d

export type TranscriptLineSplitter = {
  readonly push: (chunk: Uint8Array) => void
  /** Writes a final line that has no newline; later pushes are ignored. */
  readonly end: () => void
}

export function createTranscriptLineSplitter(
  stream: 'stdout' | 'stderr',
  sink: TranscriptSink,
  maxLineBytes: number = MAX_TRANSCRIPT_LINE_BYTES
): TranscriptLineSplitter {
  // A private accumulator, appended in place so a line spread over many chunks stays linear.
  const parts: Buffer[] = []
  let heldBytes = 0
  let ended = false

  const hold = (segment: Buffer): void => {
    const room = maxLineBytes - heldBytes
    if (room <= 0 || segment.length === 0) {
      return
    }
    const kept = segment.length > room ? segment.subarray(0, room) : segment
    // Why copy: a slice would keep the whole pipe chunk alive until the line ends.
    parts.push(Buffer.from(kept))
    heldBytes += kept.length
  }

  const emit = (): void => {
    const bytes = Buffer.concat(parts)
    const end = bytes.at(-1) === CARRIAGE_RETURN ? bytes.length - 1 : bytes.length
    parts.length = 0
    heldBytes = 0
    try {
      sink.append({ kind: 'output', stream, text: bytes.subarray(0, end).toString('utf8') })
    } catch {
      sink.fault()
    }
  }

  return {
    push: (chunk) => {
      if (ended) {
        return
      }
      const buffer = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
      let offset = 0
      for (let newline = buffer.indexOf(NEWLINE); newline !== -1;) {
        hold(buffer.subarray(offset, newline))
        emit()
        offset = newline + 1
        newline = buffer.indexOf(NEWLINE, offset)
      }
      hold(buffer.subarray(offset))
    },
    end: () => {
      if (ended) {
        return
      }
      ended = true
      if (heldBytes > 0) {
        emit()
      }
    }
  }
}
