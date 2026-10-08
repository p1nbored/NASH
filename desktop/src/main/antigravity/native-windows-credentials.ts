import { createRequire } from 'node:module'
import {
  parseAntigravityNativeCredential,
  type AntigravityNativeCredential
} from './native-credential-codec'

/** Win32 CRED_MAX_CREDENTIAL_BLOB_SIZE; agy's own login write fails above it too. */
export const ANTIGRAVITY_WINDOWS_CREDENTIAL_MAX_BYTES = 2560
const CRED_PERSIST_LOCAL_MACHINE = 2
const VALID_PERSIST = new Set([1, 2, 3])
const CONFLICT =
  'The native Antigravity credential changed during selection; refresh before retrying.'

export type WindowsGenericCredentialReadResult =
  | { status: 'found'; blob: Uint8Array; userName: string | null; persist: number }
  | { status: 'missing' }
  | { status: 'error'; code: number }
export type WindowsGenericCredentialWriteResult =
  | { status: 'ok' }
  | { status: 'error'; code: number }
/** The `@orca/windows-credentials` addon surface this adapter uses; injectable for tests. */
export type WindowsGenericCredentialApi = {
  readGenericCredential(target: string): WindowsGenericCredentialReadResult
  writeGenericCredential(
    target: string,
    userName: string | null,
    blob: Uint8Array,
    persist: number
  ): WindowsGenericCredentialWriteResult
}
export type AntigravityWindowsCredentialTarget = { target: string; userName: string }
export type AntigravityWindowsCredentialOptions = {
  api?: WindowsGenericCredentialApi
  target?: AntigravityWindowsCredentialTarget
}

// go-keyring on Windows: generic credential "<service>:<user>", user name set, raw blob, no wrapper.
const nativeTarget: AntigravityWindowsCredentialTarget = {
  target: 'gemini:antigravity',
  userName: 'antigravity'
}

const requireFromMain = createRequire(__filename)

function isWindowsGenericCredentialApi(value: unknown): value is WindowsGenericCredentialApi {
  return (
    typeof value === 'object' &&
    value !== null &&
    'readGenericCredential' in value &&
    typeof value.readGenericCredential === 'function' &&
    'writeGenericCredential' in value &&
    typeof value.writeGenericCredential === 'function'
  )
}

function loadWindowsGenericCredentialApi(): WindowsGenericCredentialApi {
  let loaded: unknown
  try {
    // Why lazy: only Windows installs build this optional addon.
    loaded = requireFromMain('@orca/windows-credentials')
  } catch {
    loaded = null
  }
  if (!isWindowsGenericCredentialApi(loaded)) {
    throw new Error('The Windows credential helper is missing from this build.')
  }
  return loaded
}

function requireWindows(): void {
  if (process.platform !== 'win32') {
    throw new Error('The Antigravity Windows credential store is unavailable on this host.')
  }
}

function windowsErrorSuffix(result: unknown): string {
  const code =
    typeof result === 'object' && result !== null && 'code' in result ? result.code : null
  return typeof code === 'number' && Number.isInteger(code) ? ` (Windows error ${code})` : ''
}

function decodeBlob(blob: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(blob)
  } catch {
    throw new Error('Antigravity credentials could not be decoded.')
  }
}

type StoredCredential = {
  credential: AntigravityNativeCredential
  userName: string | null
  persist: number
}

function readStored(
  api: WindowsGenericCredentialApi,
  target: AntigravityWindowsCredentialTarget
): StoredCredential | null {
  let result: WindowsGenericCredentialReadResult
  try {
    result = api.readGenericCredential(target.target)
  } catch {
    // Never surface native exception text next to credential I/O.
    throw new Error('The Antigravity Windows credential store could not be accessed.')
  }
  if (result?.status === 'missing') {
    return null
  }
  if (
    result?.status !== 'found' ||
    !(result.blob instanceof Uint8Array) ||
    result.blob.byteLength > ANTIGRAVITY_WINDOWS_CREDENTIAL_MAX_BYTES ||
    !VALID_PERSIST.has(result.persist) ||
    (result.userName !== null && typeof result.userName !== 'string')
  ) {
    throw new Error(
      `The Antigravity Windows credential store could not be read${windowsErrorSuffix(result)}.`
    )
  }
  return {
    credential: parseAntigravityNativeCredential(decodeBlob(result.blob)),
    userName: result.userName,
    persist: result.persist
  }
}

export async function readAntigravityWindowsCredential(
  options: AntigravityWindowsCredentialOptions = {}
): Promise<AntigravityNativeCredential | null> {
  requireWindows()
  const api = options.api ?? loadWindowsGenericCredentialApi()
  return readStored(api, options.target ?? nativeTarget)?.credential ?? null
}

export async function writeAntigravityWindowsCredential(
  contents: string,
  expected: string | null,
  options: AntigravityWindowsCredentialOptions = {}
): Promise<void> {
  requireWindows()
  parseAntigravityNativeCredential(contents)
  const blob = Buffer.from(contents, 'utf8')
  if (blob.byteLength > ANTIGRAVITY_WINDOWS_CREDENTIAL_MAX_BYTES) {
    throw new Error(
      'Antigravity credentials exceed the Windows Credential Manager limit of 2,560 bytes.'
    )
  }
  const api = options.api ?? loadWindowsGenericCredentialApi()
  const target = options.target ?? nativeTarget
  const current = readStored(api, target)
  if ((current?.credential.contents ?? null) !== expected) {
    throw new Error(CONFLICT)
  }
  let result: WindowsGenericCredentialWriteResult
  try {
    result = api.writeGenericCredential(
      target.target,
      current ? current.userName : target.userName,
      blob,
      current?.persist ?? CRED_PERSIST_LOCAL_MACHINE
    )
  } catch {
    throw new Error('The Antigravity Windows credential store could not be accessed.')
  }
  if (result?.status !== 'ok') {
    throw new Error(
      `The Antigravity Windows credential store could not be updated${windowsErrorSuffix(result)}.`
    )
  }
  if (readStored(api, target)?.credential.contents !== contents) {
    throw new Error(
      'The Antigravity Windows credential update could not be verified. The credential may have changed; sign in again if needed.'
    )
  }
}
