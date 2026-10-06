/** Clef price math (spec section 8). All amounts are integers: micro-dollars and whole neurons. */

/** Price basis S5, versioned in every ledger row. Output price is unpublished, so output is never costed. */
export const CLEF_PRICE_BASIS = Object.freeze({
  version: 1,
  inputMicroUsdPerMillionTokens: 240_000,
  inputNeuronsPerMillionTokens: 21_818,
  outputCost: 'cost_unknown'
} as const)

const TOKENS_PER_MILLION = 1_000_000
export const CLEF_RESERVATION_MARGIN_MICRO_USD = 1_000
/** US$0.001 expressed in neurons at the pinned input rate, rounded up. */
export const CLEF_RESERVATION_MARGIN_NEURONS = ceilDiv(
  CLEF_RESERVATION_MARGIN_MICRO_USD * CLEF_PRICE_BASIS.inputNeuronsPerMillionTokens,
  CLEF_PRICE_BASIS.inputMicroUsdPerMillionTokens
)
/** Keeps token x rate products far inside Number.MAX_SAFE_INTEGER. */
const MAX_RESERVABLE_INPUT_TOKENS = 1_000_000
export const CLEF_MAX_SETTLEABLE_INPUT_TOKENS = 1_000_000_000

export type ClefReservationEstimate = {
  reservedTokens: number
  reservedMicroUsd: number
  reservedNeurons: number
}

function ceilDiv(numerator: number, denominator: number): number {
  return Math.floor((numerator + denominator - 1) / denominator)
}

export function isClefTokenCount(value: number, max: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= max
}

export function clefInputCostMicroUsd(inputTokens: number): number {
  return ceilDiv(inputTokens * CLEF_PRICE_BASIS.inputMicroUsdPerMillionTokens, TOKENS_PER_MILLION)
}

export function clefInputNeurons(inputTokens: number): number {
  return ceilDiv(inputTokens * CLEF_PRICE_BASIS.inputNeuronsPerMillionTokens, TOKENS_PER_MILLION)
}

/** Upper bound for one billed attempt: 1.5x the estimate at the input rate, plus US$0.001. */
export function estimateClefReservation(
  estimatedInputTokens: number
): ClefReservationEstimate | null {
  if (
    !isClefTokenCount(estimatedInputTokens, MAX_RESERVABLE_INPUT_TOKENS) ||
    estimatedInputTokens < 1
  ) {
    return null
  }
  const reservedTokens = ceilDiv(estimatedInputTokens * 3, 2)
  return {
    reservedTokens,
    reservedMicroUsd: clefInputCostMicroUsd(reservedTokens) + CLEF_RESERVATION_MARGIN_MICRO_USD,
    reservedNeurons: clefInputNeurons(reservedTokens) + CLEF_RESERVATION_MARGIN_NEURONS
  }
}
