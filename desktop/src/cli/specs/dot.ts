import { GLOBAL_FLAGS, type CommandSpec } from '../args'

// The local dot client over the dedicated ingress endpoint (contract version 3). Hidden, so agents
// are not steered to it; requirement and message text come from a file or stdin, never argv.
// Not registered here: package E1 adds these specs to COMMAND_SPECS.

const NOTES = [
  'Talks to the dot interface endpoint with the token from the discovery file; it is off unless the user turned it on in the app.',
  'Text is read from a UTF-8 file or stdin (-), never from the command line.'
]

export const DOT_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['dot', 'hello'],
    hidden: true,
    summary: 'Show the dot interface contract versions, methods and caps',
    usage: 'orca dot hello [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: NOTES
  },
  {
    path: ['dot', 'workspaces'],
    hidden: true,
    summary: 'List the workspaces the user enabled for dot, with their access ceiling',
    usage: 'orca dot workspaces [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: NOTES
  },
  {
    path: ['dot', 'submit'],
    hidden: true,
    summary: 'Submit an English requirement; it starts a run without a confirmation step',
    usage:
      'orca dot submit --workspace <ref> --objective-file <path|-> [--idempotency-key <uuid>] [--access read_only|workspace_write] [--language <tag>] [--json]',
    allowedFlags: [
      ...GLOBAL_FLAGS,
      'workspace',
      'objective-file',
      'idempotency-key',
      'access',
      'language'
    ],
    notes: [...NOTES, 'Reuse the printed idempotency key to retry without submitting twice.']
  },
  {
    path: ['dot', 'status'],
    hidden: true,
    summary: 'Show the coarse state of one dot request',
    usage: 'orca dot status --request <id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'request'],
    notes: NOTES
  },
  {
    path: ['dot', 'list'],
    hidden: true,
    summary: 'List dot requests, newest first',
    usage: 'orca dot list [--limit <n>] [--before <sequence>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'limit', 'before'],
    notes: NOTES
  },
  {
    path: ['dot', 'cancel'],
    hidden: true,
    destructive: true,
    summary: 'Stop the run of a dot request and cancel it',
    usage: 'orca dot cancel --request <id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'request'],
    notes: NOTES
  },
  {
    path: ['dot', 'message'],
    hidden: true,
    summary: 'Send a follow-up message to the run of a dot request',
    usage: 'orca dot message --request <id> --text-file <path|-> [--message-id <uuid>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'request', 'text-file', 'message-id'],
    notes: [...NOTES, 'Reuse the printed message id to retry without sending twice.']
  },
  {
    path: ['dot', 'decisions'],
    hidden: true,
    summary: 'List pending permission prompts of the runs dot started',
    usage: 'orca dot decisions [--request <id>] [--limit <n>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'request', 'limit'],
    notes: NOTES
  },
  {
    path: ['dot', 'decide'],
    hidden: true,
    summary: 'Answer a permission prompt of a dot run with allow or deny',
    usage: 'orca dot decide --decision <id> --answer allow|deny [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'decision', 'answer'],
    notes: [...NOTES, 'On a read-only run dot may deny a command or edit prompt but not allow it.']
  },
  {
    path: ['dot', 'validations'],
    hidden: true,
    summary: 'List inconclusive results of dot runs that wait for a waive or reject decision',
    usage: 'orca dot validations [--request <id>] [--limit <n>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'request', 'limit'],
    notes: [...NOTES, 'Each shows the title, a fixed reason code and a masked summary only.']
  },
  {
    path: ['dot', 'validation-decide'],
    hidden: true,
    destructive: true,
    summary: 'Waive or reject an inconclusive result of a dot run',
    usage:
      'orca dot validation-decide --validation <id> --answer waive|reject [--decision-id <uuid>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'validation', 'answer', 'decision-id'],
    notes: [
      ...NOTES,
      'Waive completes the task; reject fails it. Reuse the printed decision id to retry without deciding twice.'
    ]
  }
]
