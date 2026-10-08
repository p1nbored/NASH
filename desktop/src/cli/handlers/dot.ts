import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  DOT_REQUEST_ACCESS_LEVELS,
  type DotRequestAccess
} from '../../shared/dot-ingress/dot-ingress-limits'
import type { RuntimeMetadata } from '../../shared/runtime-bootstrap'
import type { CommandHandler, HandlerContext } from '../dispatch'
import {
  createDotIngressClient,
  type DotIngressClient,
  type DotRpcSend
} from '../dot-ingress/dot-ingress-client'
import {
  formatDotDecision,
  formatDotDecisionAnswer,
  formatDotHello,
  formatDotMessage,
  formatDotRequest,
  formatDotValidationDecision,
  formatDotValidations,
  formatDotWorkspaces
} from '../dot-ingress/dot-ingress-format'
import { readDotIngressMetadata } from '../dot-ingress/dot-ingress-metadata-reader'
import {
  getOptionalPositiveIntegerFlag,
  getOptionalStringFlag,
  getRequiredStringFlag
} from '../flags'
import { getDefaultUserDataPath } from '../runtime/metadata'
import { sendRequest } from '../runtime/transport'
import { RuntimeClientError } from '../runtime/types'

// orca dot <command>: the local dot client (contract version 3). Not registered here: package E1 adds
// DOT_HANDLERS to the handler manifest. Text arrives from a file or stdin so no code page rewrites it.

const TEXT_INPUT_MAX_BYTES = 64 * 1024

export type DotCliDeps = {
  userDataPath: () => string
  readMetadata: (userDataPath: string) => RuntimeMetadata
  send: DotRpcSend
  readTextFile: (path: string) => string
  readStdin: () => Promise<string>
  newId: () => string
  print: (text: string) => void
}

function invalid(message: string): RuntimeClientError {
  return new RuntimeClientError('invalid_argument', message)
}

async function readTextInput(deps: DotCliDeps, ctx: HandlerContext, flag: string): Promise<string> {
  const source = getRequiredStringFlag(ctx.flags, flag)
  let text: string
  if (source === '-') {
    text = await deps.readStdin()
  } else {
    try {
      text = deps.readTextFile(resolve(ctx.cwd, source))
    } catch {
      throw invalid(`The file named by --${flag} could not be read.`)
    }
  }
  if (Buffer.byteLength(text, 'utf8') > TEXT_INPUT_MAX_BYTES) {
    throw invalid(`The text named by --${flag} is too large.`)
  }
  if (text.trim() === '') {
    throw invalid(`The text named by --${flag} is empty.`)
  }
  return text
}

function accessFlag(ctx: HandlerContext): DotRequestAccess | undefined {
  const value = getOptionalStringFlag(ctx.flags, 'access')
  if (value === undefined) {
    return undefined
  }
  const level = DOT_REQUEST_ACCESS_LEVELS.find((candidate) => candidate === value)
  if (!level) {
    throw invalid('--access must be read_only or workspace_write.')
  }
  return level
}

function answerFlag(ctx: HandlerContext): 'allow' | 'deny' {
  const value = getRequiredStringFlag(ctx.flags, 'answer')
  if (value !== 'allow' && value !== 'deny') {
    throw invalid('--answer must be allow or deny.')
  }
  return value
}

function validationAnswerFlag(ctx: HandlerContext): 'waive' | 'reject' {
  const value = getRequiredStringFlag(ctx.flags, 'answer')
  if (value !== 'waive' && value !== 'reject') {
    throw invalid('--answer must be waive or reject.')
  }
  return value
}

export function createDotHandlers(deps: DotCliDeps): Record<string, CommandHandler> {
  // Why per call: the discovery file changes on every interface start, and is absent while it is off.
  const client = (): DotIngressClient =>
    createDotIngressClient(deps.readMetadata(deps.userDataPath()), deps.send)
  const output = (ctx: HandlerContext, result: unknown, text: string): void =>
    deps.print(ctx.json ? JSON.stringify(result, null, 2) : text)

  return {
    'dot hello': async (ctx) => {
      const hello = await client().hello()
      output(ctx, hello, formatDotHello(hello))
    },
    'dot workspaces': async (ctx) => {
      const result = await client().workspaces()
      output(ctx, result, formatDotWorkspaces(result))
    },
    'dot submit': async (ctx) => {
      const workspaceRef = getRequiredStringFlag(ctx.flags, 'workspace')
      const requestedAccess = accessFlag(ctx)
      const objective = await readTextInput(deps, ctx, 'objective-file')
      const idempotencyKey = getOptionalStringFlag(ctx.flags, 'idempotency-key') ?? deps.newId()
      const result = await client().submit({
        workspaceRef,
        objective,
        idempotencyKey,
        ...(requestedAccess ? { requestedAccess } : {})
      })
      const text = `${formatDotRequest(result.request)}${result.duplicate ? ' (submitted before)' : ''}`
      output(
        ctx,
        { idempotencyKey, result },
        `${text}\nIdempotency key: ${idempotencyKey} (reuse it to retry)`
      )
    },
    'dot status': async (ctx) => {
      const result = await client().status(getRequiredStringFlag(ctx.flags, 'request'))
      output(ctx, result, formatDotRequest(result.request))
    },
    'dot list': async (ctx) => {
      const limit = getOptionalPositiveIntegerFlag(ctx.flags, 'limit')
      const beforeSequence = getOptionalPositiveIntegerFlag(ctx.flags, 'before')
      const result = await client().list({
        ...(limit ? { limit } : {}),
        ...(beforeSequence ? { beforeSequence } : {})
      })
      const lines = result.requests.map(formatDotRequest)
      output(ctx, result, lines.length > 0 ? lines.join('\n') : 'No dot requests.')
    },
    'dot cancel': async (ctx) => {
      const result = await client().cancel(getRequiredStringFlag(ctx.flags, 'request'))
      output(ctx, result, formatDotRequest(result.request))
    },
    'dot message': async (ctx) => {
      const dotRequestId = getRequiredStringFlag(ctx.flags, 'request')
      const text = await readTextInput(deps, ctx, 'text-file')
      const messageId = getOptionalStringFlag(ctx.flags, 'message-id') ?? deps.newId()
      const result = await client().message({ dotRequestId, messageId, text })
      output(ctx, result, formatDotMessage(result))
    },
    'dot decisions': async (ctx) => {
      const dotRequestId = getOptionalStringFlag(ctx.flags, 'request')
      const limit = getOptionalPositiveIntegerFlag(ctx.flags, 'limit')
      const result = await client().decisions({
        ...(dotRequestId ? { dotRequestId } : {}),
        ...(limit ? { limit } : {})
      })
      const lines = result.decisions.map(formatDotDecision)
      output(ctx, result, lines.length > 0 ? lines.join('\n') : 'No pending permission prompts.')
    },
    'dot decide': async (ctx) => {
      const decisionId = getRequiredStringFlag(ctx.flags, 'decision')
      const decision = answerFlag(ctx)
      const result = await client().answer({ decisionId, decision })
      output(ctx, result, formatDotDecisionAnswer(result))
    },
    'dot validations': async (ctx) => {
      const dotRequestId = getOptionalStringFlag(ctx.flags, 'request')
      const limit = getOptionalPositiveIntegerFlag(ctx.flags, 'limit')
      const result = await client().validations({
        ...(dotRequestId ? { dotRequestId } : {}),
        ...(limit ? { limit } : {})
      })
      output(ctx, result, formatDotValidations(result))
    },
    'dot validation-decide': async (ctx) => {
      const validationId = getRequiredStringFlag(ctx.flags, 'validation')
      const decision = validationAnswerFlag(ctx)
      const decisionId = getOptionalStringFlag(ctx.flags, 'decision-id') ?? deps.newId()
      const result = await client().decideValidation({ decisionId, validationId, decision })
      output(
        ctx,
        { decisionId, result },
        `${formatDotValidationDecision(result)}\nDecision id: ${decisionId} (reuse it to retry)`
      )
    }
  }
}

async function readProcessStdin(): Promise<string> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    bytes += buffer.length
    if (bytes > TEXT_INPUT_MAX_BYTES) {
      throw invalid('The text on stdin is too large.')
    }
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

export const DOT_HANDLERS: Record<string, CommandHandler> = createDotHandlers({
  userDataPath: () => getDefaultUserDataPath(),
  readMetadata: (userDataPath) => readDotIngressMetadata(userDataPath),
  send: sendRequest,
  readTextFile: (path) => readFileSync(path, 'utf8'),
  readStdin: readProcessStdin,
  newId: () => randomUUID(),
  print: (text) => console.log(text)
})
