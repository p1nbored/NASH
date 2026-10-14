import type { TuiAgent } from './tui-agent'
import { isRoutingAgent } from './routing-table/routing-cli-registry'

export class TaskAgentAccessUnsupportedError extends Error {
  readonly code = 'autopilot_session_posture_invalid'
  constructor(agent: TuiAgent) {
    super(
      `NASH cannot enforce read-only access for ${agent} on this host. Choose a supported CLI or request workspace-write access.`
    )
  }
}

export function supportsTaskReadOnly(agent: TuiAgent, platform: NodeJS.Platform): boolean {
  return (
    ['claude', 'codex', 'antigravity', 'gemini', 'cursor', 'codebuddy'].includes(agent) ||
    (agent === 'grok' && platform !== 'win32')
  )
}

/** Per-task launch posture replaces configured arguments, including permission bypasses. */
export function taskAgentLaunchArgs(
  agent: TuiAgent,
  access: 'read_only' | 'workspace_write',
  platform: NodeJS.Platform
): string {
  if (access === 'read_only' && !supportsTaskReadOnly(agent, platform)) {
    throw new TaskAgentAccessUnsupportedError(agent)
  }
  if (!isRoutingAgent(agent)) {
    return ''
  }
  switch (agent) {
    case 'claude':
      return `--permission-mode ${access === 'read_only' ? 'plan' : 'acceptEdits'}`
    case 'codex':
      return `--sandbox ${access === 'read_only' ? 'read-only' : 'workspace-write'} --ask-for-approval on-request`
    case 'antigravity':
      return access === 'read_only' ? '--sandbox' : ''
    case 'gemini':
      return `--approval-mode ${access === 'read_only' ? 'plan' : 'default'}`
    case 'cursor':
      return access === 'read_only' ? '--mode ask' : ''
    case 'codebuddy':
      return `--permission-mode ${access === 'read_only' ? 'plan' : 'default'}`
    case 'grok':
      return access === 'read_only'
        ? '--permission-mode default --sandbox read-only'
        : '--permission-mode default'
    case 'omp':
      return '--approval-mode write'
    case 'muse':
      return '--approval-mode on-request --approval-judge off'
    case 'opencode':
      return ''
  }
}
