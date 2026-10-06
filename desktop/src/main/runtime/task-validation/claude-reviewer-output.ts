import { z } from 'zod'
import { createOutputSink } from '../../../shared/child-process/bounded-output-sink'
import type { ChildIo, SpawnedChild } from '../../agent-exec-shared/managed-child-session'

// Stdout is one bounded --output-format json envelope whose .result holds the answer; stderr is dropped.

export const REVIEW_STDOUT_MAX_BYTES = 512 * 1024

const EnvelopeSchema = z.object({
  type: z.literal('result'),
  subtype: z.literal('success'),
  is_error: z.literal(false).optional(),
  result: z.string(),
  modelUsage: z.record(z.string(), z.unknown()).optional()
})

export type ClaudeEnvelope =
  | { readonly ok: true; readonly text: string; readonly reportedModels: readonly string[] }
  | { readonly ok: false }

export function parseClaudeResultEnvelope(stdout: string): ClaudeEnvelope {
  let value: unknown
  try {
    value = JSON.parse(stdout.trim())
  } catch {
    return { ok: false }
  }
  const parsed = EnvelopeSchema.safeParse(value)
  if (!parsed.success) {
    return { ok: false }
  }
  return {
    ok: true,
    text: parsed.data.result,
    reportedModels: Object.keys(parsed.data.modelUsage ?? {})
  }
}

export type ClaudeReviewIo = ChildIo & {
  readonly stdout: () => string
  readonly overflowed: () => boolean
}

export function attachClaudeReviewIo(
  child: SpawnedChild,
  requestStop: (trigger: 'output_limit') => void
): ClaudeReviewIo {
  const sink = createOutputSink(REVIEW_STDOUT_MAX_BYTES, 'head')
  child.stdout.on('data', (chunk: Buffer) => {
    sink.write(chunk)
    if (sink.truncated()) {
      requestStop('output_limit')
    }
  })
  child.stderr.on('data', () => {})
  // Why no-op handlers: an unhandled stream error (EPIPE) would crash the main process.
  for (const stream of [child.stdin, child.stdout, child.stderr]) {
    stream.on('error', () => {})
  }
  return {
    stdout: () => sink.text(),
    overflowed: () => sink.truncated(),
    close: () => {
      child.stdin.destroy()
      child.stdout.destroy()
      child.stderr.destroy()
    }
  }
}
