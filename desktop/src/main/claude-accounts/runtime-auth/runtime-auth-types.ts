import type { ClaudeEnvPatch } from '../environment'

export type ClaudeRuntimeAuthPreparation = {
  configDir: string
  runtime?: 'host' | 'wsl'
  wslDistro?: string | null
  wslLinuxConfigDir?: string | null
  envPatch: ClaudeEnvPatch
  stripAuthEnv: boolean
  /** Never set since Claude account switching was removed; read only by Orca's inherited meters. */
  managedRefreshDeferredByLivePty?: boolean
  provenance: string
}
