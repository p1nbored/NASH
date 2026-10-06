import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, type FileHandle } from 'node:fs/promises'
import { containsSecretLikeText } from '../agent-exec-shared/secret-redaction'

// The deliverable: read from a fresh run directory through one opened handle, hard-capped, never through a link.

export const DEFAULT_MAX_LAST_MESSAGE_BYTES = 4 * 1024 * 1024
const READ_CHUNK_BYTES = 64 * 1024
/** O_NOFOLLOW does not exist on Windows; there the lstat check is the only link guard. */
const OPEN_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)

export type CodexExecLastMessageCheck =
  | {
      readonly state: 'ok'
      readonly text: string
      readonly bytes: number
      readonly sha256: string
      /** A credential shape occurs in the text, which Codex sandboxes do not stop it from reading. */
      readonly secretLike: boolean
    }
  | { readonly state: 'missing' }
  | { readonly state: 'empty' }
  | { readonly state: 'oversized'; readonly bytes: number }
  | { readonly state: 'unreadable'; readonly code: string }

type OpenedFile =
  | { readonly failure: CodexExecLastMessageCheck }
  | { readonly handle: FileHandle; readonly size: number }

type ReadableHandle = {
  readonly read: (
    buffer: Buffer,
    offset: number,
    length: number,
    position: number | null
  ) => Promise<{ readonly bytesRead: number }>
}

function errorCode(error: unknown): string {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : 'UNKNOWN'
}

/** Read at most `maxBytes` plus one byte, so a file that keeps growing is cut and flagged. */
export async function readBoundedFromHandle(
  handle: ReadableHandle,
  maxBytes: number
): Promise<{ readonly bytes: Buffer; readonly truncated: boolean }> {
  const limit = maxBytes + 1
  const chunks: Buffer[] = []
  let total = 0
  while (total < limit) {
    const chunk = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, limit - total))
    const { bytesRead } = await handle.read(chunk, 0, chunk.length, null)
    if (bytesRead === 0) {
      break
    }
    chunks.push(chunk.subarray(0, bytesRead))
    total += bytesRead
  }
  return { bytes: Buffer.concat(chunks, total), truncated: total > maxBytes }
}

function interpret(bytes: Buffer): CodexExecLastMessageCheck {
  const text = bytes.toString('utf8').replace(/^﻿/, '')
  if (text.trim() === '') {
    return { state: 'empty' }
  }
  return {
    state: 'ok',
    text,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    secretLike: containsSecretLikeText(text)
  }
}

/** The path must be a regular file now, and the handle opened on it must be that same file. */
async function openRegularFile(path: string): Promise<OpenedFile> {
  const link = await lstat(path)
  if (link.isSymbolicLink()) {
    return { failure: { state: 'unreadable', code: 'SYMLINK' } }
  }
  if (!link.isFile()) {
    return { failure: { state: 'unreadable', code: 'NOT_A_FILE' } }
  }
  const handle = await open(path, OPEN_FLAGS)
  const opened = await handle.stat()
  const sameFile =
    link.ino === 0 || opened.ino === 0 || (link.ino === opened.ino && link.dev === opened.dev)
  if (!opened.isFile() || !sameFile) {
    await handle.close()
    return { failure: { state: 'unreadable', code: 'CHANGED' } }
  }
  return { handle, size: opened.size }
}

export async function readLastMessage(
  path: string,
  maxBytes: number
): Promise<CodexExecLastMessageCheck> {
  try {
    const opened = await openRegularFile(path)
    if ('failure' in opened) {
      return opened.failure
    }
    try {
      if (opened.size > maxBytes) {
        return { state: 'oversized', bytes: opened.size }
      }
      const { bytes, truncated } = await readBoundedFromHandle(opened.handle, maxBytes)
      return truncated ? { state: 'oversized', bytes: bytes.length } : interpret(bytes)
    } finally {
      await opened.handle.close()
    }
  } catch (error) {
    const code = errorCode(error)
    return code === 'ENOENT' ? { state: 'missing' } : { state: 'unreadable', code }
  }
}
