import {
  connectRegisteredSshTarget,
  getRegisteredSshState,
  getRegisteredSshTargetMutations,
  getSshConnectionManager,
  listRegisteredRemovedSshTargetLabels,
  listRegisteredSshTargets
} from '../../../ssh/ssh-target-registry'
import { isManagedOrcadSshTarget } from '../../../ssh/ssh-connection-store'
import { browseSshDirectory } from '../../../ssh/ssh-remote-directory-browse'
import { defineMethod } from '../core'
import { getPublicSshError, getPublicSshState } from '../../public-ssh-state'
import type { SshTarget as SshTargetRecord, SshTargetSummary } from '../../../../shared/ssh-types'
import type {
  SshEditableTarget,
  SshEditableTargetField,
  SshEditableTargetInput
} from '../../../../shared/ssh-target-management'
import {
  SshBrowseDir,
  SshTarget,
  SshTargetAdd,
  SshTargetUpdate
} from '../../../../shared/rpc-contract/ssh-params'

// Why: `generation` stays optional on the wire — an old server simply omits it and its rows key on target id alone.
function toSshTargetSummary({ id, label, generation }: SshTargetRecord): SshTargetSummary {
  const state = getRegisteredSshState(id)
  const remotePlatform = state?.remotePlatform
  return {
    id,
    label,
    ...(generation === undefined ? {} : { generation }),
    connected: state?.status === 'connected',
    ...(state?.status === undefined ? {} : { connectionStatus: state.status }),
    ...(remotePlatform === undefined ? {} : { remotePlatform })
  }
}

function listRegisteredSshTargetSummaries(): SshTargetSummary[] {
  return listRegisteredSshTargets().map(toSshTargetSummary)
}

// Why an allowlist: a field added to SshTarget later (or a stray key in an old profile) must not
// reach paired clients by default. `satisfies` keeps it in step with SSH_EDITABLE_TARGET_FIELDS.
function pickSshEditableFields(source: SshEditableTargetInput): SshEditableTargetInput {
  return {
    label: source.label,
    configHost: source.configHost,
    host: source.host,
    port: source.port,
    username: source.username,
    identityFile: source.identityFile,
    identityAgent: source.identityAgent,
    identitiesOnly: source.identitiesOnly,
    gssapiAuthentication: source.gssapiAuthentication,
    proxyCommand: source.proxyCommand,
    jumpHost: source.jumpHost,
    relayGracePeriodSeconds: source.relayGracePeriodSeconds,
    systemSshConnectionReuse: source.systemSshConnectionReuse,
    remoteRuntime: source.remoteRuntime,
    allowRemoteCliControl: source.allowRemoteCliControl
  } satisfies Record<SshEditableTargetField, unknown>
}

function toSshEditableTarget(target: SshTargetRecord): SshEditableTarget {
  return {
    ...pickSshEditableFields(target),
    ...toSshTargetSummary(target),
    ...(target.source === undefined ? {} : { source: target.source }),
    ...(isManagedOrcadSshTarget(target) ? { managedServer: true as const } : {})
  }
}

export const SSH_METHODS = [
  defineMethod({
    name: 'ssh.getState',
    permission: 'workspace',
    params: SshTarget,
    handler: (params) => ({
      state: getPublicSshState(getRegisteredSshState(params.targetId) ?? null)
    })
  }),
  defineMethod({
    name: 'ssh.connect',
    permission: 'host-admin',
    params: SshTarget,
    handler: async (params) => {
      try {
        return { state: getPublicSshState(await connectRegisteredSshTarget(params.targetId)) }
      } catch {
        const state = getRegisteredSshState(params.targetId)
        throw new Error(getPublicSshError(state?.status ?? 'error'))
      }
    }
  }),
  defineMethod({
    name: 'ssh.listTargets',
    permission: 'workspace',
    params: null,
    // Why: legacy clients can call this method directly, so it must preserve the same HUB-private secret boundary.
    handler: () => ({ targets: listRegisteredSshTargetSummaries() })
  }),
  defineMethod({
    name: 'ssh.listTargetSummaries',
    permission: 'workspace',
    params: null,
    // Why: paired clients need display identity only; SSH addresses, jump chains, and credentials remain HUB-private.
    handler: () => ({ targets: listRegisteredSshTargetSummaries() })
  }),
  defineMethod({
    name: 'ssh.listRemovedTargetLabels',
    permission: 'workspace',
    params: null,
    handler: () => ({ labels: listRegisteredRemovedSshTargetLabels() })
  }),
  // Why `workspace`: a paired client that can open terminals here can already edit ~/.ssh/config,
  // so managing this host's SSH targets is the same power (rpc-method-permission.ts).
  defineMethod({
    name: 'ssh.listEditableTargets',
    permission: 'workspace',
    params: null,
    handler: () => ({ targets: listRegisteredSshTargets().map(toSshEditableTarget) })
  }),
  defineMethod({
    name: 'ssh.addTarget',
    permission: 'workspace',
    params: SshTargetAdd,
    handler: (params) => {
      const result = getRegisteredSshTargetMutations().add({ ...params.target, source: 'manual' })
      return {
        target: toSshEditableTarget(result.target),
        repoReadoptions: result.repoReadoptions
      }
    }
  }),
  defineMethod({
    name: 'ssh.updateTarget',
    permission: 'workspace',
    params: SshTargetUpdate,
    handler: (params) => {
      // Why: replace semantics, so an omitted optional field is cleared, as SSH settings do.
      const updated = getRegisteredSshTargetMutations().update(params.targetId, {
        ...pickSshEditableFields(params.target),
        source: 'manual'
      })
      if (!updated) {
        throw new Error(`SSH target not found: ${params.targetId}`)
      }
      return { target: toSshEditableTarget(updated) }
    }
  }),
  defineMethod({
    name: 'ssh.removeTarget',
    permission: 'workspace',
    params: SshTarget,
    handler: async (params) => {
      await getRegisteredSshTargetMutations().remove(params.targetId)
      return { removed: true }
    }
  }),
  defineMethod({
    name: 'ssh.browseDir',
    permission: 'workspace',
    params: SshBrowseDir,
    handler: (params) =>
      browseSshDirectory(getSshConnectionManager(), params.targetId, params.dirPath)
  })
]
