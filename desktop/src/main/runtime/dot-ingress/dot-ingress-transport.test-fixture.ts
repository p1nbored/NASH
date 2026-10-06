// FIXTURE_ONLY: tokens, ids and paths here are synthetic and grant nothing.
import { createConnection } from 'node:net'
import { readFileSync } from 'node:fs'
import {
  DotIngressMetadataSchema,
  getDotIngressMetadataPath,
  type DotIngressMetadata
} from '../../../shared/dot-ingress/dot-ingress-metadata'

/** Shaped like the CLI token (24 random bytes as hex), so a mix-up between the two tokens is realistic. */
export const FIXTURE_CLI_TOKEN = 'ab'.repeat(24)
export const FIXTURE_INGRESS_TOKEN = '0123456789abcdef'.repeat(4)
export const FIXTURE_RUNTIME_ID = 'runtime-fixture-1'

/** The `code` an operation threw, or undefined when it did not throw a coded error. */
export function thrownCodeOf(operation: () => unknown): string | undefined {
  try {
    operation()
    return undefined
  } catch (error) {
    const code: unknown = error instanceof Error ? Reflect.get(error, 'code') : undefined
    return typeof code === 'string' ? code : undefined
  }
}

export type WireFrame = Record<string, unknown>

/**
 * Writes every line on one connection and returns one parsed response per line, in arrival order.
 * Keepalive frames are skipped; the connection is closed once all responses are in.
 */
export async function sendRawLines(
  endpoint: string,
  lines: readonly string[],
  expectedResponses = lines.length
): Promise<WireFrame[]> {
  return await new Promise((resolve, reject) => {
    const socket = createConnection(endpoint)
    const responses: WireFrame[] = []
    let buffer = ''
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error(`timed out with ${responses.length} of ${expectedResponses} responses`))
    }, 10_000)
    const finish = (outcome: () => void): void => {
      clearTimeout(timer)
      socket.destroy()
      outcome()
    }
    socket.setEncoding('utf8')
    socket.once('error', (error) => finish(() => reject(error)))
    socket.on('data', (chunk: string) => {
      buffer += chunk
      let newline = buffer.indexOf('\n')
      while (newline !== -1) {
        const raw = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        const parsed: unknown = raw ? JSON.parse(raw) : null
        if (parsed && typeof parsed === 'object' && !Reflect.has(parsed, '_keepalive')) {
          responses.push({ ...parsed })
        }
        newline = buffer.indexOf('\n')
      }
      if (responses.length >= expectedResponses) {
        finish(() => resolve(responses))
      }
    })
    socket.once('connect', () => socket.write(lines.map((line) => `${line}\n`).join('')))
  })
}

/** One request per connection-line; responses come back in arrival order, so match them by id. */
export async function sendFrames(
  endpoint: string,
  frames: readonly WireFrame[]
): Promise<WireFrame[]> {
  return await sendRawLines(
    endpoint,
    frames.map((frame) => JSON.stringify(frame))
  )
}

export async function sendFrame(endpoint: string, frame: WireFrame): Promise<WireFrame> {
  const [response] = await sendFrames(endpoint, [frame])
  if (!response) {
    throw new Error('no response frame')
  }
  return response
}

/** Reads the discovery file the way a dot client would, validating it against the shared schema. */
export function readDotMetadata(userDataPath: string): DotIngressMetadata {
  return DotIngressMetadataSchema.parse(
    JSON.parse(readFileSync(getDotIngressMetadataPath(userDataPath), 'utf8'))
  )
}

export function errorCodeOfFrame(frame: WireFrame): string | undefined {
  const error: unknown = frame.error
  if (error && typeof error === 'object') {
    const code: unknown = Reflect.get(error, 'code')
    return typeof code === 'string' ? code : undefined
  }
  return undefined
}
