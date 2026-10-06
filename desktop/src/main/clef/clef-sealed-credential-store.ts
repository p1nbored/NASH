import type { ClefCredentialSaveRefusal } from '../../shared/clef/clef-credential-contract'
import { getSecretStore } from '../../shared/secret-store'
import { ApiKeySealingUnavailableError } from '../credentials/api-key-sealing-unavailable-error'
import { createEncryptedApiKeyFileStore } from '../credentials/encrypted-api-key-file-store'
import { ClefCredentialGeneration } from './clef-credential-generation'
import { ClefCredentialHandle, validateClefCredentialShapes } from './clef-credential-handle'
import type {
  ClefCredentialProtection,
  ClefCredentialSource,
  ClefCredentialStatus
} from './clef-credential-port'

/**
 * Main startup installs one instance through `setClefCredentialSource` and hands the same
 * instance to the IPC handlers. Sealing is judged through the SecretStore port, not electron.
 */

export type { ClefCredentialSaveRefusal } from '../../shared/clef/clef-credential-contract'

export type ClefCredentialSaveResult = { ok: true } | { ok: false; code: ClefCredentialSaveRefusal }

export type ClefCredentialClearResult = { ok: true } | { ok: false; code: 'clear_failed' }

export type ClefSealedCredentialStore = ClefCredentialSource & {
  /** Validates both values, then seals both or leaves neither stored. */
  save(token: string, accountId: string): ClefCredentialSaveResult
  /** Removes both values, attempting each even if the other fails. */
  clear(): ClefCredentialClearResult
}

type EncryptedFileStore = ReturnType<typeof createEncryptedApiKeyFileStore>
type StoredValueState = 'missing' | 'sealed' | 'refused'

function storedValueState(store: EncryptedFileStore): StoredValueState {
  if (!store.has()) {
    return 'missing'
  }
  // Why: a null protection means the envelope is unreadable, which is no more trusted than plaintext.
  return store.protection() === 'sealed' ? 'sealed' : 'refused'
}

/** Same gate as Orca's fail-closed Antigravity store; a missing or throwing port counts as unsealed. */
function sealingAvailable(): boolean {
  try {
    const secrets = getSecretStore()
    return secrets.isEncryptionAvailable() && secrets.describeProtectionGap() === null
  } catch {
    return false
  }
}

function summarizeProtection(states: readonly StoredValueState[]): ClefCredentialProtection {
  if (states.includes('refused')) {
    return 'plaintext_refused'
  }
  if (!sealingAvailable()) {
    return 'sealing_unavailable'
  }
  return states.every((state) => state === 'missing') ? 'absent' : 'sealed'
}

const SAFE_ERROR_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/
const SAFE_ERROR_CODE = /^[A-Z0-9_]{1,32}$/

/** Only fields that cannot carry a value: the error class name and its system code, never message, stack or cause. */
function loggableError(error: unknown): { name: string; code: string | null } {
  const name = error instanceof Error ? error.name : ''
  const code: unknown = error instanceof Error ? Reflect.get(error, 'code') : undefined
  return {
    name: SAFE_ERROR_NAME.test(name) ? name : 'Error',
    code: typeof code === 'string' && SAFE_ERROR_CODE.test(code) ? code : null
  }
}

function removeAll(stores: readonly EncryptedFileStore[]): boolean {
  let removedAll = true
  for (const store of stores) {
    try {
      store.clear()
    } catch (error) {
      removedAll = false
      console.warn('[clef] failed to remove a sealed credential file', loggableError(error))
    }
  }
  return removedAll
}

export function createClefSealedCredentialStore(): ClefSealedCredentialStore {
  const tokenStore = createEncryptedApiKeyFileStore({
    fileName: 'clef-api-token.enc',
    envelopePrefix: 'orca-clef-api-token:v1:',
    providerLabel: 'Clef token',
    logScope: 'clef',
    requireSealing: true
  })
  const accountStore = createEncryptedApiKeyFileStore({
    fileName: 'clef-account-id.enc',
    envelopePrefix: 'orca-clef-account-id:v1:',
    providerLabel: 'Clef account',
    logScope: 'clef',
    requireSealing: true
  })
  const stores = [tokenStore, accountStore] as const
  let generation = ClefCredentialGeneration.mint()
  // Why: any write or removal attempt may change what is stored, so the auth latch must lift.
  const bumpGeneration = (): void => {
    generation = ClefCredentialGeneration.mint()
  }

  function status(): ClefCredentialStatus {
    const tokenState = storedValueState(tokenStore)
    const accountState = storedValueState(accountStore)
    return {
      tokenPresent: tokenState !== 'missing',
      accountPresent: accountState !== 'missing',
      protection: summarizeProtection([tokenState, accountState])
    }
  }

  function read(): ClefCredentialHandle | null {
    const current = status()
    if (current.protection !== 'sealed' || !current.tokenPresent || !current.accountPresent) {
      return null
    }
    let token: string | null
    let accountId: string | null
    try {
      token = tokenStore.read()
      accountId = accountStore.read()
    } catch {
      console.warn('[clef] sealed credentials could not be unsealed')
      return null
    }
    if (token === null || accountId === null) {
      return null
    }
    const shapeCode = validateClefCredentialShapes(token, accountId)
    if (shapeCode !== null) {
      console.warn(`[clef] stored credential failed shape validation: ${shapeCode}`)
      return null
    }
    return new ClefCredentialHandle(token, accountId)
  }

  function save(token: string, accountId: string): ClefCredentialSaveResult {
    const trimmedToken = token.trim()
    const trimmedAccountId = accountId.trim()
    const shapeCode = validateClefCredentialShapes(trimmedToken, trimmedAccountId)
    if (shapeCode !== null) {
      return { ok: false, code: shapeCode }
    }
    if (!sealingAvailable()) {
      return { ok: false, code: 'sealing_unavailable' }
    }
    bumpGeneration()
    try {
      tokenStore.save(trimmedToken)
      accountStore.save(trimmedAccountId)
    } catch (error) {
      console.warn('[clef] failed to write sealed credentials; removing both', loggableError(error))
      removeAll(stores)
      // Why: sealing dropped after the check above; the stores refuse before writing any plaintext.
      const code =
        error instanceof ApiKeySealingUnavailableError ? 'sealing_unavailable' : 'write_failed'
      return { ok: false, code }
    }
    // Why: defence in depth behind requireSealing; a plaintext or unreadable envelope is never kept.
    if (stores.some((store) => store.protection() !== 'sealed')) {
      removeAll(stores)
      return { ok: false, code: 'sealing_unavailable' }
    }
    return { ok: true }
  }

  function clear(): ClefCredentialClearResult {
    bumpGeneration()
    return removeAll(stores) ? { ok: true } : { ok: false, code: 'clear_failed' }
  }

  return { status, read, save, clear, generation: () => generation }
}
