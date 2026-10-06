import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'
import { CLEF_CREDENTIAL_CHANNELS } from '../../shared/clef/clef-credential-contract'

export const clefCredentialsApi = {
  status: () => ipcRenderer.invoke(CLEF_CREDENTIAL_CHANNELS.status),
  // Why copy the two fields: nothing else the renderer attached to the object crosses IPC.
  save: (input) =>
    ipcRenderer.invoke(CLEF_CREDENTIAL_CHANNELS.save, {
      token: input.token,
      accountId: input.accountId
    }),
  clear: () => ipcRenderer.invoke(CLEF_CREDENTIAL_CHANNELS.clear)
} satisfies PreloadApi['clefCredentials']
