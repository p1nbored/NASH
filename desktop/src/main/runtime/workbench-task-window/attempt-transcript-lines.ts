import { open } from 'node:fs/promises'
import { z } from 'zod'

const LF = 0x0a
// Why 16 KiB: a record is at most 8 KiB, and only the truncated note and the end record matter here.
const TAIL_BYTES = 16 * 1024

/** Bytes to hand over without splitting a UTF-8 sequence; used only for a line longer than a read. */
function utf8BoundaryLength(bytes: Uint8Array): number {
  let lead = bytes.length - 1
  while (lead > 0 && bytes.length - lead < 4 && (bytes[lead] & 0xc0) === 0x80) {
    lead -= 1
  }
  if (lead < 0) {
    return bytes.length
  }
  const byte = bytes[lead]
  const width = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : byte >= 0xc0 ? 2 : 1
  const boundary = lead + width <= bytes.length ? bytes.length : lead
  // Why: a window too small for one character still has to move forward.
  return boundary > 0 ? boundary : bytes.length
}

/**
 * How much of a read to return: whole lines, so the next offset starts a line. A line longer than
 * the whole window goes out in pieces, and a settled attempt's last unterminated line goes out too.
 */
export function wholeLinePrefixLength(
  bytes: Uint8Array,
  options: { readonly fullWindow: boolean; readonly flushAtEnd: boolean }
): number {
  if (options.flushAtEnd) {
    return bytes.length
  }
  const lastLf = bytes.lastIndexOf(LF)
  if (lastLf !== -1) {
    return lastLf + 1
  }
  return options.fullWindow ? utf8BoundaryLength(bytes) : 0
}

export type TranscriptTail = {
  readonly size: number
  readonly lastKind: string | null
  readonly truncated: boolean
}

// Why lenient: only the kind and a note's code matter here; any other shape reads as neither.
const TailRecordSchema = z.object({
  kind: z.string().nullable().catch(null),
  code: z.string().nullable().catch(null)
})

function kindOf(line: string): { kind: string | null; code: string | null } {
  try {
    const parsed = TailRecordSchema.safeParse(JSON.parse(line))
    return parsed.success
      ? { kind: parsed.data.kind ?? null, code: parsed.data.code ?? null }
      : { kind: null, code: null }
  } catch {
    return { kind: null, code: null }
  }
}

/** The last two whole records: the writer stops after a `truncated` note except for `end`. */
export async function readTranscriptTail(path: string): Promise<TranscriptTail> {
  const handle = await open(path, 'r')
  try {
    const { size } = await handle.stat()
    const start = Math.max(0, size - TAIL_BYTES)
    const buffer = Buffer.alloc(size - start)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start)
    const text = buffer.subarray(0, bytesRead).toString('utf8')
    const lastLf = text.lastIndexOf('\n')
    const lines = text
      .slice(0, lastLf + 1)
      .split('\n')
      .filter(Boolean)
    const whole = start > 0 ? lines.slice(1) : lines
    const last = whole.slice(-2).map(kindOf)
    return {
      size,
      lastKind: last.at(-1)?.kind ?? null,
      truncated: last.some((entry) => entry.kind === 'note' && entry.code === 'truncated')
    }
  } finally {
    await handle.close()
  }
}
