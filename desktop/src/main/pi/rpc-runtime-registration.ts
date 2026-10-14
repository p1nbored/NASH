import { homedir } from 'node:os'
import { join } from 'node:path'
import { agentSessionAccountHome } from '../../shared/agent-session-account-home'
import { supportsSupervisedProviderChildLocation } from '../provider-process/supervised-provider-child-location'
import type {
  StructuredAgentAdapterContext,
  StructuredAgentRuntimeAdapter,
  StructuredAgentRuntimeRegistration
} from '../runtime/structured-agent-runtime-registrations'
import {
  composeStructuredLaunch,
  structuredAgentLaunchSources
} from '../runtime/structured-agent-launch-composition'
import { PI_RPC_AGENT } from './rpc-agent-definition'
import {
  piRpcLaunchPart,
  piRpcVersionSupported,
  resolvePiRpcCommand
} from './rpc-launch-resolution'
import { PiRpcSessionAdapter } from './rpc-session-adapter'
import { createPiModelCatalogProbe } from './rpc-model-catalog-probe'
import { PI_SESSION_HISTORY } from './pi-session-history'

function createPiRpcAdapter(context: StructuredAgentAdapterContext): StructuredAgentRuntimeAdapter {
  const { deps } = context
  return new PiRpcSessionAdapter({
    resolveLaunch: composeStructuredLaunch(
      PI_RPC_AGENT,
      structuredAgentLaunchSources(context),
      piRpcLaunchPart({})
    ),
    ...(deps.openPiConnection ? { openConnection: deps.openPiConnection } : {}),
    ...(deps.readProcessStartTime ? { readProcessStartTime: deps.readProcessStartTime } : {}),
    onLifecycle: context.deliverLifecycle,
    onSettled: ({ sessionId, clientMessageId, outcome }) => {
      if (outcome.state === 'admitted') {
        return
      }
      context.followUps.onDispatchSettledLate({
        sessionId,
        clientMessageId,
        ...(outcome.state === 'accepted' ? { providerIdentity: outcome.providerIdentity } : outcome)
      })
    },
    onIdle: context.followUps.releaseUnansweredDispatches,
    logger: deps.logger
  })
}

export const PI_RPC_RUNTIME_REGISTRATION: StructuredAgentRuntimeRegistration = {
  definition: PI_RPC_AGENT,
  createAdapter: createPiRpcAdapter,
  modelCatalog: (context) => ({
    kind: 'probe',
    // `--list-models` marks no model as the one Pi runs by default.
    listingNamesConfiguredModel: false,
    probe: createPiModelCatalogProbe({
      // The environment a chat's launch starts from too.
      resolveEnvironment: () => context.environment.resolveAgentEnvironment('pi'),
      refreshEnvironmentAfterMiss: context.environment.refreshAfterMissingProgram,
      ...(context.deps.resolveAgentCommandSettings
        ? { resolveCommandSettings: context.deps.resolveAgentCommandSettings }
        : {})
    })
  }),
  transcriptImport: null,
  sessionHistory: PI_SESSION_HISTORY,
  supportsLocation: supportsSupervisedProviderChildLocation,
  launchCheck: {
    resolveLaunch: (env, commandSettings) => ({
      command: resolvePiRpcCommand(env, commandSettings),
      env
    }),
    supportsVersion: (launch) => piRpcVersionSupported(launch)
  },
  resolveAccountHome: async ({ launchEnv }) =>
    agentSessionAccountHome(
      PI_RPC_AGENT,
      launchEnv.PI_CODING_AGENT_DIR?.trim() || join(homedir(), '.pi', 'agent')
    )
}
