import { ipcMain } from 'electron'
import type {
  OrcadManagedConversionResult,
  OrcadManagedPendingMigrationRow
} from '../../shared/orcad-managed-runtime'
import { listPendingManagedOrcadMigrations } from '../ssh/orcad-managed-migration-status'
import { convertSshTargetToManagedOrcad } from '../ssh/orcad-runtime-conversion'
import { conversionCollaborators } from '../ssh/orcad-runtime-conversion-wiring'
import { requiredString } from './orcad-runtime-lifecycle-handlers'

export function registerOrcadRuntimeConversionHandlers(getUserDataPath: () => string): void {
  ipcMain.handle(
    'runtimeEnvironments:convertSshHostToManagedOrcad',
    (
      _event,
      args: { sshTargetId: string; name: string }
    ): Promise<OrcadManagedConversionResult> => {
      return convertSshTargetToManagedOrcad(getUserDataPath(), {
        sshTargetId: requiredString(args?.sshTargetId, 'SSH target'),
        name: requiredString(args?.name, 'Server name'),
        ...conversionCollaborators()
      })
    }
  )
  ipcMain.handle(
    'runtimeEnvironments:listPendingOrcadMigrations',
    (): OrcadManagedPendingMigrationRow[] => listPendingManagedOrcadMigrations(getUserDataPath())
  )
}
