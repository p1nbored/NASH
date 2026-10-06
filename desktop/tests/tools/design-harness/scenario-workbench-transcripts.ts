// FIXTURE_ONLY attempt transcripts in the D-024 design section 1.1 format, for the task window
// captures. Every command, path, model and line is synthetic; no CLI ran and nothing is read.

function at(minute: number, second: number): string {
  return new Date(Date.UTC(2026, 9, 3, 10, minute, second)).toISOString()
}

/** Builds one transcript; seq counts from 0 with no gaps, as the writer does. */
function transcript(
  startMinute: number,
  records: readonly (readonly [string, Record<string, unknown>])[]
): string[] {
  return records.map(([kind, fields], seq) =>
    JSON.stringify({ v: 1, seq, at: at(startMinute, seq * 3), kind, ...fields })
  )
}

const READ_ONLY_CODEX = {
  executor: 'codex',
  model: 'gpt-6.1-sol',
  effort: 'high',
  sandbox: 'read-only',
  cwd: 'C:/fixtures/autopilot/feature-evidence-contracts',
  worktree: null
}

const AGY = {
  executor: 'agy',
  model: 'gemini-3.8-flash-high',
  effort: null,
  sandbox: 'read-only',
  cwd: 'C:/fixtures/autopilot/feature-evidence-contracts',
  worktree: null
}

/** Codex, finished and failed: commands with output, messages, a tool, usage and an error. */
export const CODEX_FAILED = transcript(36, [
  ['start', READ_ONLY_CODEX],
  ['turn', { phase: 'started', usage: null, error: null }],
  [
    'command',
    { id: 'cmd_1', status: 'started', command: 'git status --short', exitCode: null, output: null }
  ],
  [
    'command',
    {
      id: 'cmd_1',
      status: 'completed',
      command: 'git status --short',
      exitCode: 0,
      output: ' M contracts/receipt.ts\n?? tests/receipt.fixture.ts\n'
    }
  ],
  ['message', { text: 'I will check how the parser treats a receipt without a signature.' }],
  [
    'command',
    {
      id: 'cmd_2',
      status: 'started',
      command: 'pnpm vitest run contracts/receipt',
      exitCode: null,
      output: null
    }
  ],
  [
    'command',
    {
      id: 'cmd_2',
      status: 'failed',
      command: 'pnpm vitest run contracts/receipt',
      exitCode: 1,
      output:
        'FIXTURE_ONLY\n ✓ accepts a signed receipt (4 ms)\n × rejects a receipt without a signature\n   expected error "missing_signature", got undefined\n Tests  1 failed | 1 passed (2)\n'
    }
  ],
  ['tool', { itemType: 'web_search', status: 'completed' }],
  [
    'message',
    {
      text: 'The parser accepts a receipt without a signature: parseReceipt never checks the field. A guard before the hash check would close it.'
    }
  ],
  [
    'turn',
    {
      phase: 'completed',
      usage: {
        inputTokens: 18240,
        cachedInputTokens: 12000,
        outputTokens: 2310,
        reasoningOutputTokens: 640
      },
      error: null
    }
  ],
  ['error', { text: 'The validation command exited with code 1.' }],
  ['end', { state: 'failed', exitCode: 1, reasonCode: 'nonzero_exit' }]
])

/** Codex, still running: revealed a line per read and never ended. */
export const CODEX_LIVE = transcript(44, [
  ['start', READ_ONLY_CODEX],
  ['turn', { phase: 'started', usage: null, error: null }],
  ['message', { text: 'Retrying with the fixture that carries a signature field.' }],
  [
    'command',
    {
      id: 'cmd_1',
      status: 'started',
      command: 'rg -n "signature" contracts',
      exitCode: null,
      output: null
    }
  ],
  [
    'command',
    {
      id: 'cmd_1',
      status: 'completed',
      command: 'rg -n "signature" contracts',
      exitCode: 0,
      output:
        'contracts/receipt.ts:14:  signature?: string\ncontracts/receipt.ts:52:  const hash = digest(receipt)\n'
    }
  ],
  [
    'message',
    { text: 'Line 14 makes the signature optional, so a receipt without one parses cleanly.' }
  ],
  [
    'command',
    {
      id: 'cmd_2',
      status: 'started',
      command: 'pnpm vitest run contracts/receipt --reporter=dot',
      exitCode: null,
      output: null
    }
  ]
])

/** agy, finished: plain output lines, a blank line and one stderr line. */
export const AGY_COMPLETED = transcript(38, [
  ['start', AGY],
  ['output', { stream: 'stdout', text: 'FIXTURE_ONLY Reading 14 test files under tests/receipt' }],
  ['output', { stream: 'stdout', text: '' }],
  ['output', { stream: 'stdout', text: '2 failing tests:' }],
  [
    'output',
    { stream: 'stdout', text: '  - rejects a receipt without a signature (contracts/receipt)' }
  ],
  [
    'output',
    { stream: 'stdout', text: '  - keeps the original bytes after a re-parse (contracts/receipt)' }
  ],
  ['output', { stream: 'stderr', text: 'warning: tests/receipt.fixture.ts is untracked' }],
  ['output', { stream: 'stdout', text: 'Both failures come from the missing signature check.' }],
  ['end', { state: 'completed', exitCode: 0, reasonCode: null }]
])

/** Codex in its own worktree, cut at the size limit before its end record. */
export const CODEX_TRUNCATED = transcript(30, [
  [
    'start',
    {
      ...READ_ONLY_CODEX,
      sandbox: 'write',
      cwd: 'C:/fixtures/autopilot/fix-receipt-parser',
      worktree: {
        branch: 'fix/receipt-parser',
        path: 'C:/fixtures/autopilot/fix-receipt-parser',
        baseCommit: '4f1c2a9d0b7e6c5a4f3e2d1c0b9a8f7e6d5c4b3a'
      }
    }
  ],
  [
    'command',
    {
      id: 'cmd_1',
      status: 'completed',
      command: 'pnpm vitest run --reporter=verbose',
      exitCode: 0,
      output: 'FIXTURE_ONLY 412 tests passed\n'
    }
  ],
  [
    'file_change',
    { status: 'completed', paths: ['contracts/receipt.ts', 'tests/receipt.fixture.ts'] }
  ],
  ['note', { code: 'records_dropped', count: 37 }],
  ['output', { stream: 'stderr', text: 'FIXTURE_ONLY verbose reporter output continues…' }],
  ['note', { code: 'truncated' }],
  ['end', { state: 'completed', exitCode: 0, reasonCode: null }]
])

/** Codex with a record kind this build does not know and a line the writer never finished. */
export const CODEX_MALFORMED = [
  ...transcript(33, [
    ['start', READ_ONLY_CODEX],
    ['message', { text: 'Mapping the receipt schema fields.' }],
    ['plan_update', { steps: 3 }]
  ]),
  '{"v":1,"seq":3,"at":"2026-10-03T10:33:09.000Z","kind":"message","text":"The schema has',
  JSON.stringify({
    v: 1,
    seq: 4,
    at: at(33, 41),
    kind: 'end',
    state: 'completed',
    exitCode: 0,
    reasonCode: null
  })
]
