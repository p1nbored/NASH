import type { HandlerGroup } from './handler-group-manifest'

// Why split out: the D-016 commands (the primary session's task API, its hidden permission hook and
// the hidden local dot client) change as a unit and keep handler-group-manifest.ts under its limit.
export const AUTOPILOT_HANDLER_GROUPS: readonly HandlerGroup[] = [
  {
    name: 'orchestration-autopilot',
    keys: [
      'orchestration task-propose',
      'orchestration task-start',
      'orchestration task-show',
      'orchestration task-report',
      'orchestration run-complete'
    ],
    load: async () =>
      (await import('./handlers/orchestration/autopilot-handlers.js'))
        .ORCHESTRATION_AUTOPILOT_HANDLERS
  },
  {
    name: 'orchestration-permission',
    keys: [
      'orchestration permission-request',
      'orchestration permission-list',
      'orchestration permission-answer'
    ],
    load: async () =>
      (await import('./handlers/orchestration/permission-request-handler.js'))
        .ORCHESTRATION_PERMISSION_HANDLERS
  },
  {
    // Talks to the dot interface endpoint of this machine, never to the main runtime endpoint.
    name: 'dot',
    keys: [
      'dot hello',
      'dot workspaces',
      'dot submit',
      'dot attach',
      'dot status',
      'dot list',
      'dot cancel',
      'dot message',
      'dot decisions',
      'dot decide',
      'dot validations',
      'dot validation-decide'
    ],
    load: async () => (await import('./handlers/dot.js')).DOT_HANDLERS
  }
]
