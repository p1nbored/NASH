import { readFileSync, rmSync } from 'node:fs'
import {
  DotIngressMetadataSchema,
  getDotIngressMetadataPath,
  type DotIngressMetadata
} from '../../../shared/dot-ingress/dot-ingress-metadata'
import { writeSecureJsonFile } from '../../../shared/secure-file'

export type DotIngressMetadataFailure = 'invalid' | 'not_secured' | 'write_failed'

/** Messages are fixed text plus an errno code: the token and the paths never appear in them. */
export class DotIngressMetadataError extends Error {
  readonly reason: DotIngressMetadataFailure

  constructor(reason: DotIngressMetadataFailure, message: string) {
    super(message)
    this.name = 'DotIngressMetadataError'
    this.reason = reason
  }
}

/** The identity that proves a discovery file was written by one particular listener start. */
export type DotIngressFileOwner = Pick<DotIngressMetadata, 'pid' | 'runtimeId' | 'ingressToken'>

function readMetadata(userDataPath: string): DotIngressMetadata | null {
  try {
    const parsed = DotIngressMetadataSchema.safeParse(
      JSON.parse(readFileSync(getDotIngressMetadataPath(userDataPath), 'utf8'))
    )
    return parsed.success ? parsed.data : null
  } catch {
    // Why: a missing or unreadable file proves nothing about who wrote it, so callers leave it alone.
    return null
  }
}

function errnoCode(error: unknown): string {
  const code: unknown = error instanceof Error ? Reflect.get(error, 'code') : undefined
  return typeof code === 'string' ? ` (${code})` : ''
}

function isProcessDead(pid: number): boolean {
  try {
    // Why: signal 0 is the liveness probe; ESRCH means no such process, EPERM means a live foreign one.
    process.kill(pid, 0)
    return false
  } catch (error) {
    return Reflect.get(Object(error), 'code') === 'ESRCH'
  }
}

/**
 * Publishes the endpoint and token through the owner-only secure writer. A file whose permissions
 * could not be restricted is removed again: a token that others can read is no token.
 */
export function writeDotIngressMetadata(userDataPath: string, metadata: DotIngressMetadata): void {
  const parsed = DotIngressMetadataSchema.safeParse(metadata)
  if (!parsed.success) {
    throw new DotIngressMetadataError('invalid', 'The discovery file does not match the contract.')
  }
  const path = getDotIngressMetadataPath(userDataPath)
  let restricted: boolean
  try {
    restricted = writeSecureJsonFile(path, parsed.data)
  } catch (error) {
    throw new DotIngressMetadataError(
      'write_failed',
      `The discovery file could not be written${errnoCode(error)}.`
    )
  }
  if (!restricted) {
    rmSync(path, { force: true })
    throw new DotIngressMetadataError(
      'not_secured',
      'The discovery file could not be restricted to the current user.'
    )
  }
}

/** Mirrors clearRuntimeMetadataIfOwned: a newer listener's file is never removed by an older one. */
export function clearDotIngressMetadataIfOwned(
  userDataPath: string,
  owner: DotIngressFileOwner
): boolean {
  const current = readMetadata(userDataPath)
  if (
    !current ||
    current.pid !== owner.pid ||
    current.runtimeId !== owner.runtimeId ||
    current.ingressToken !== owner.ingressToken
  ) {
    return false
  }
  rmSync(getDotIngressMetadataPath(userDataPath), { force: true })
  return true
}

/** Removes the file of a runtime that died without cleaning up; a live runtime's file is never touched. */
export function clearStaleDotIngressMetadata(userDataPath: string, ownPid: number): boolean {
  const current = readMetadata(userDataPath)
  if (!current || current.pid === ownPid || !isProcessDead(current.pid)) {
    return false
  }
  rmSync(getDotIngressMetadataPath(userDataPath), { force: true })
  return true
}
