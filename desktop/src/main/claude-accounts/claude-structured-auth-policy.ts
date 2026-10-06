/** The structured mirror of the terminal preflight's `prepareClaudeAuth` result. */
export type ClaudeStructuredAuthPolicy = {
  stripAuthEnv: boolean
}

/**
 * The only supported way to build a structured launch's auth policy.
 *
 * Structured Claude runs only on the user's own login (account switching was removed), so the
 * user's own Anthropic env is their sign-in and must reach the child. The structured runtime
 * refuses to install without a policy resolver, which is why this stays a function.
 */
export function claudeStructuredAuthPolicy(): ClaudeStructuredAuthPolicy {
  return { stripAuthEnv: false }
}
