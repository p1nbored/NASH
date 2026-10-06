export const CLAUDE_AUTH_ENV_VARS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'AWS_BEARER_TOKEN_BEDROCK'
] as const

export type ClaudeEnvPatch = {
  CLAUDE_CONFIG_DIR?: string
  ANTHROPIC_CUSTOM_HEADERS?: string
}

export function applyClaudeEnvPatch(
  baseEnv: Record<string, string>,
  patch: ClaudeEnvPatch,
  options?: { stripAuthEnv?: boolean; platform?: NodeJS.Platform }
): Record<string, string> {
  if (options?.stripAuthEnv) {
    for (const key of CLAUDE_AUTH_ENV_VARS) {
      delete baseEnv[key]
    }
    const platform = options.platform ?? process.platform
    for (const key of Object.keys(baseEnv)) {
      const normalized = platform === 'win32' ? key.toUpperCase() : key
      if (
        (platform === 'win32' && CLAUDE_AUTH_ENV_VARS.some((authKey) => authKey === normalized)) ||
        (normalized === 'ANTHROPIC_CUSTOM_HEADERS' && isAuthLikeCustomHeaders(baseEnv[key]))
      ) {
        delete baseEnv[key]
      }
    }
  }

  if (patch.CLAUDE_CONFIG_DIR) {
    baseEnv.CLAUDE_CONFIG_DIR = patch.CLAUDE_CONFIG_DIR
  }
  if (patch.ANTHROPIC_CUSTOM_HEADERS !== undefined) {
    baseEnv.ANTHROPIC_CUSTOM_HEADERS = patch.ANTHROPIC_CUSTOM_HEADERS
  }

  return baseEnv
}

/** One string for every transport, so a terminal launch and a structured launch
 *  cannot drift into telling the user two different things about one refusal. */
export const CLAUDE_AUTH_ENV_CONFLICT_MESSAGE =
  'This Claude launch defines explicit Anthropic auth environment variables, but it runs on the Claude login of its own runtime. Remove those overrides.'

/**
 * Whether a launch's explicit env carries Anthropic auth that a stripping launch (the WSL lane) refuses.
 *
 * The key comparison mirrors applyClaudeEnvPatch's strip exactly: case-insensitive on
 * win32, where the OS folds env names so `anthropic_api_key` is an effective
 * `ANTHROPIC_API_KEY`, and case-sensitive elsewhere. A refusal narrower than the strip
 * lets an override through that the strip would have removed.
 *
 * A non-empty value is what makes it a conflict. `ANTHROPIC_API_KEY=` in the agent env
 * box is how a user blanks a variable — the settings pipeline preserves that empty value
 * (normalizeTuiAgentEnvRecord drops empty KEYS only) — and an empty override can neither
 * authenticate nor beat the pinned account, while the strip removes the name regardless.
 * Refusing it would break a terminal launch that works today for no security gain.
 */
export function hasClaudeAuthEnvConflict(
  env: Record<string, string> | undefined,
  platform: NodeJS.Platform = process.platform
): boolean {
  if (!env) {
    return false
  }
  for (const [key, value] of Object.entries(env)) {
    const normalized = platform === 'win32' ? key.toUpperCase() : key
    if (value && CLAUDE_AUTH_ENV_VARS.some((authKey) => authKey === normalized)) {
      return true
    }
    if (normalized === 'ANTHROPIC_CUSTOM_HEADERS' && isAuthLikeCustomHeaders(value)) {
      return true
    }
  }
  return false
}

function isAuthLikeCustomHeaders(value: string | undefined): boolean {
  if (!value) {
    return false
  }
  return /authorization|x-api-key|api-key|bearer/i.test(value)
}
