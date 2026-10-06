import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import {
  CLEF_CREDENTIAL_CHANNELS,
  type ClefCredentialStatus,
  type ClefCredentialsMutationResult
} from '../../shared/clef/clef-credential-contract'
import type { ClefSealedCredentialStore } from '../clef/clef-sealed-credential-store'
import { getTrustedUIRendererWebContents } from './ui'

export {
  CLEF_CREDENTIAL_CHANNELS,
  type ClefCredentialsMutationResult
} from '../../shared/clef/clef-credential-contract'

export type ClefCredentialsHandlerOptions = {
  /** Runs after a successful save or any clear, e.g. to lift the auth_failed latch. */
  onCredentialsChanged?: () => void
}

function assertTrustedClefCaller(event: IpcMainInvokeEvent): void {
  if (event.senderFrame !== event.sender.mainFrame) {
    throw new Error('Clef credential requests must originate from the current main frame')
  }
  if (getTrustedUIRendererWebContents() !== event.sender) {
    throw new Error('Clef credential requests must originate from the trusted application renderer')
  }
}

// Why: IPC arguments arrive untyped; a non-string becomes '' so the store reports it as missing.
function readCredentialField(payload: unknown, key: 'token' | 'accountId'): string {
  if (typeof payload !== 'object' || payload === null) {
    return ''
  }
  const value: unknown = Reflect.get(payload, key)
  return typeof value === 'string' ? value : ''
}

function notifyCredentialsChanged(options: ClefCredentialsHandlerOptions): void {
  try {
    options.onCredentialsChanged?.()
  } catch (error) {
    console.error('[clef] credential change listener failed:', error)
  }
}

export function registerClefCredentialsHandlers(
  store: ClefSealedCredentialStore,
  options: ClefCredentialsHandlerOptions = {}
): void {
  ipcMain.handle(CLEF_CREDENTIAL_CHANNELS.status, (event): ClefCredentialStatus => {
    assertTrustedClefCaller(event)
    return store.status()
  })

  ipcMain.handle(
    CLEF_CREDENTIAL_CHANNELS.save,
    (event, payload: unknown): ClefCredentialsMutationResult => {
      assertTrustedClefCaller(event)
      const result = store.save(
        readCredentialField(payload, 'token'),
        readCredentialField(payload, 'accountId')
      )
      if (!result.ok) {
        return { ok: false, code: result.code, status: store.status() }
      }
      notifyCredentialsChanged(options)
      return { ok: true, status: store.status() }
    }
  )

  ipcMain.handle(CLEF_CREDENTIAL_CHANNELS.clear, (event): ClefCredentialsMutationResult => {
    assertTrustedClefCaller(event)
    const result = store.clear()
    // Why: a partial clear still changed what is stored, so latches keyed on credentials must reset.
    notifyCredentialsChanged(options)
    return result.ok
      ? { ok: true, status: store.status() }
      : { ok: false, code: result.code, status: store.status() }
  })
}
