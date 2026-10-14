/** Everything a managed-orcad operation needs to know about one host (SSH or WSL) before it acts. */
import type { NodeRuntimeTarget } from '../../shared/node-runtime-pin'
import type { SshTarget } from '../../shared/ssh-types'
import type { OrcadActivationRecord } from './orcad-activation-record'
import { readOrcadActivationRecord } from './orcad-activation-record-store'
import { resolveOrcadRuntimeTarget } from './orcad-runtime-target'
import { prepareWindowsOrcadHost } from './orcad-windows-host-preparation'
import { execOrcadRemote } from './orcad-remote-runtime-control'
import {
  isWslOrcadHostTarget,
  type OrcadHostTarget,
  type OrcadHostTransport
} from './orcad-host-transport'
import { readRemoteHomeCommand } from './ssh-remote-commands'
import {
  isWindowsRemoteHost,
  joinRemotePath,
  normalizeRemoteHome,
  validateRemoteHome,
  type RemoteHostPlatform
} from './ssh-remote-platform'
import { detectRemoteHostPlatform } from './ssh-remote-platform-detection'
import { OrcadHostUnsupportedError } from '../orcad/orcad-host-unavailable'
import { rememberSshHostPlatform } from './ssh-host-platform-memo'

/** Defaults to SSH: most lifecycle code still reads SSH-only target fields. */
export type OrcadRemoteContext<Target extends OrcadHostTarget = SshTarget> = {
  activationRecord: OrcadActivationRecord
  /** A compat runtime on hosts below the default runtime's glibc floor (design D6 rung B). */
  serverTarget: NodeRuntimeTarget
  connection: OrcadHostTransport
  host: RemoteHostPlatform
  remoteHome: string
  target: Target
  userDataDir: string
}

export async function resolveOrcadRemoteContext<Target extends OrcadHostTarget = SshTarget>(
  target: Target,
  connection: OrcadHostTransport,
  signal?: AbortSignal,
  detectedHost?: RemoteHostPlatform
): Promise<OrcadRemoteContext<Target>> {
  const host = detectedHost ?? (await detectRemoteHostPlatform(connection, { signal }))
  if (!host) {
    throw new OrcadHostUnsupportedError('This SSH host platform is not supported by managed orcad.')
  }
  const remote = { conn: connection, host, signal }
  const remoteHome = normalizeRemoteHome(
    await execOrcadRemote(remote, readRemoteHomeCommand(host)),
    host
  )
  if (!validateRemoteHome(remoteHome, host)) {
    throw new Error(`Remote home is not a valid path: ${remoteHome.slice(0, 100)}`)
  }
  const serverTarget = await resolveOrcadRuntimeTarget({ conn: connection, host, signal })
  if (!isWslOrcadHostTarget(target)) {
    rememberSshHostPlatform(target.id, host, serverTarget)
  }
  if (isWindowsRemoteHost(host)) {
    // Every Windows host op, the activation record read included, runs on the pinned node.exe.
    await prepareWindowsOrcadHost({ conn: connection, host, remoteHome, serverTarget, signal })
  }
  const activationRecord = await readOrcadActivationRecord({ ...remote, remoteHome })
  return {
    activationRecord,
    serverTarget,
    connection,
    host,
    remoteHome,
    target,
    userDataDir: joinRemotePath(host, remoteHome, '.orca')
  }
}
