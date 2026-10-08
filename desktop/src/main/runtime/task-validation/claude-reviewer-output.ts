import { z } from 'zod'

// Stdout is one bounded --output-format json envelope whose .result holds the answer; stderr is dropped.

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
