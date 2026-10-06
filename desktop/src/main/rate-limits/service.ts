import { RateLimitServiceCliUsageGate } from './service/service-cli-usage-gate'

export type { InactiveCodexAccountInfo } from './service/service-types'

/**
 * Coordinates provider quota polling and publishes a stable rate-limit snapshot.
 * The implementation is layered by lifecycle, account selection, and fetch policy
 * so each module stays small while this path remains the public integration seam.
 * In NASH the top two layers read usage only through each CLI (usage-meters-policy.ts).
 */
export class RateLimitService extends RateLimitServiceCliUsageGate {}
