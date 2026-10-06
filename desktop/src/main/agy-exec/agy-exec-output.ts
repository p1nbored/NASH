import { createHash } from 'node:crypto'
import { open } from 'node:fs/promises'
import { createOutputSink } from '../../shared/child-process/bounded-output-sink'
import { containsSecretLikeText, redactAndBound } from '../agent-exec-shared/secret-redaction'
import type { AgyExecOutputRecord } from './agy-exec-types'

// The answer is stdout: kept bounded in memory, written once to the run directory, and shown only as a redacted preview.

const PRIVATE_FILE_MODE = 0o600

export type AgyOutputCapture = {
  readonly write: (chunk: Buffer | string) => void
  /** The head of the output, at most the cap. */
  readonly bytes: () => Buffer
  /** Every byte seen, including those past the cap. */
  readonly totalBytes: () => number
  readonly overflowed: () => boolean
}

/** Keeps at most `maxBytes` of the head; `onOverflow` fires once, when the cap is first exceeded. */
export function createAgyOutputCapture(
  maxBytes: number,
  onOverflow: () => void = () => {}
): AgyOutputCapture {
  const sink = createOutputSink(maxBytes, 'head')
  let total = 0
  let reported = false
  return {
    write: (chunk) => {
      total += Buffer.byteLength(chunk)
      sink.write(chunk)
      if (!reported && sink.truncated()) {
        reported = true
        onOverflow()
      }
    },
    bytes: () => sink.buffer(),
    totalBytes: () => total,
    overflowed: () => sink.truncated()
  }
}

export type FinalizeOutputOptions = {
  /** Where the raw answer is written; the file is created exclusively, so an existing file or link is never written through. */
  readonly path: string
  readonly maxPreviewChars: number
}

function withoutOutput(
  state: 'empty' | 'oversized' | 'unwritable',
  bytes: number | null
): AgyExecOutputRecord {
  return {
    state,
    path: null,
    bytes,
    sha256: null,
    secretLike: null,
    preview: '',
    previewTruncated: false
  }
}

/** Exclusive create: it fails on an existing file or link instead of writing through it. */
async function writeExclusive(path: string, bytes: Buffer): Promise<void> {
  const handle = await open(path, 'wx', PRIVATE_FILE_MODE)
  try {
    await handle.writeFile(bytes)
  } finally {
    await handle.close()
  }
}

/** Judge the captured answer and persist it; nothing here throws, a failure is a state. */
export async function finalizeAgyOutput(
  capture: AgyOutputCapture,
  options: FinalizeOutputOptions
): Promise<AgyExecOutputRecord> {
  if (capture.overflowed()) {
    return withoutOutput('oversized', capture.totalBytes())
  }
  const bytes = capture.bytes()
  const decoded = bytes.toString('utf8')
  // Why strip by code unit: a literal byte-order mark in source is invisible and easy to lose.
  const text = decoded.charCodeAt(0) === 0xfeff ? decoded.slice(1) : decoded
  if (text.trim() === '') {
    return withoutOutput('empty', null)
  }
  try {
    await writeExclusive(options.path, bytes)
  } catch {
    return withoutOutput('unwritable', null)
  }
  const preview = redactAndBound(text, options.maxPreviewChars)
  return {
    state: 'ok',
    path: options.path,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    secretLike: containsSecretLikeText(text),
    preview: preview.text,
    previewTruncated: preview.truncated
  }
}
