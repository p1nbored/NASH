import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { AUTOPILOT_TASK_SPEC_MAX_BYTES } from '../../../shared/rpc-contract/orchestration-autopilot-params'
import { RuntimeClientError } from '../../runtime/types'

/** What the text is, for the caps and for the English refusal that names it. */
export type AutopilotInputKind = 'spec' | 'summary'

const MAX_BYTES: Readonly<Record<AutopilotInputKind, number>> = {
  // D-027: the app holds the TaskSpec to the same technical ceiling.
  spec: AUTOPILOT_TASK_SPEC_MAX_BYTES,
  summary: 64 * 1024
}
const NAMES: Readonly<Record<AutopilotInputKind, string>> = {
  spec: 'TaskSpec',
  summary: 'summary'
}

export type AutopilotInputSource = {
  cwd: string
  stdin: AsyncIterable<Uint8Array | string>
  stdinIsTty: boolean
}

function tooLarge(kind: AutopilotInputKind): RuntimeClientError {
  return new RuntimeClientError(
    'invalid_argument',
    `The ${NAMES[kind]} is too large; the limit is ${MAX_BYTES[kind]} bytes.`
  )
}

async function readStdin(
  stdin: AsyncIterable<Uint8Array | string>,
  kind: AutopilotInputKind
): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of stdin) {
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk)
    size += bytes.length
    if (size > MAX_BYTES[kind]) {
      throw tooLarge(kind)
    }
    chunks.push(bytes)
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function readPath(path: string, cwd: string, kind: AutopilotInputKind): Promise<string> {
  const absolute = isAbsolute(path) ? path : join(cwd, path)
  let size: number
  try {
    size = (await stat(absolute)).size
  } catch {
    throw new RuntimeClientError(
      'invalid_argument',
      `Cannot read the ${NAMES[kind]} file \`${path}\`.`
    )
  }
  if (size > MAX_BYTES[kind]) {
    throw tooLarge(kind)
  }
  return await readFile(absolute, 'utf8')
}

/**
 * Long text for the task commands comes only from a file or stdin (`-`), never argv, where quoting
 * and length limits would mangle it. Errors are English and never echo the content.
 */
export async function readAutopilotInput(
  path: string,
  kind: AutopilotInputKind,
  source: AutopilotInputSource
): Promise<string> {
  if (path !== '-') {
    return await readPath(path, source.cwd, kind)
  }
  if (source.stdinIsTty) {
    throw new RuntimeClientError(
      'invalid_argument',
      `The ${NAMES[kind]} is read from stdin, but stdin is a terminal. Pipe it in, for example with a heredoc.`
    )
  }
  return await readStdin(source.stdin, kind)
}
