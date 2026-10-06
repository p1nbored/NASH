import type { ClaudeRateLimitAccountsState } from './managed-account-types'

/** Wire code for every retired Claude account call: Claude Code runs only on the user's own login. */
export const CLAUDE_ACCOUNTS_REMOVED_CODE = 'claude_accounts_removed'

export const CLAUDE_ACCOUNTS_REMOVED_MESSAGE =
  'Claude account switching was removed. NASH runs Claude Code on your own login: sign in with `claude /login` in your own terminal.'

export class ClaudeAccountsRemovedError extends Error {
  readonly code = CLAUDE_ACCOUNTS_REMOVED_CODE

  constructor() {
    super(CLAUDE_ACCOUNTS_REMOVED_MESSAGE)
    this.name = 'ClaudeAccountsRemovedError'
  }
}

/** The Claude half of every accounts snapshot, kept because older clients require the field. */
export function createEmptyClaudeAccountsState(): ClaudeRateLimitAccountsState {
  return { accounts: [], activeAccountId: null }
}
