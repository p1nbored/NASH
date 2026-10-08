/** CRED_PERSIST_* values accepted by writeGenericCredential. */
export declare const CRED_PERSIST: {
  readonly SESSION: 1
  readonly LOCAL_MACHINE: 2
  readonly ENTERPRISE: 3
}

export type GenericCredentialReadResult =
  | { status: 'found'; blob: Buffer; userName: string | null; persist: number }
  | { status: 'missing' }
  /** Win32 error code only; no system message, no credential bytes. */
  | { status: 'error'; code: number }

export type GenericCredentialWriteResult = { status: 'ok' } | { status: 'error'; code: number }

/** The CRED_TYPE_GENERIC item with exactly this target name. Never enumerates. */
export declare function readGenericCredential(target: string): GenericCredentialReadResult

/** Replaces the CRED_TYPE_GENERIC item with exactly this target name (blob at most 2,560 bytes). */
export declare function writeGenericCredential(
  target: string,
  userName: string | null,
  blob: Uint8Array,
  persist: number
): GenericCredentialWriteResult

/** Test cleanup only: throws for any target outside the disposable `nash-test:` namespace. */
export declare function deleteTestCredential(
  target: `nash-test:${string}`
): { status: 'ok' } | { status: 'missing' } | { status: 'error'; code: number }
