import { z } from 'zod'
import { DOT_INGRESS_ERROR_MESSAGES } from '../../../shared/dot-ingress/dot-ingress-errors'
import {
  DOT_INGRESS_V1_FALLBACK_CODES,
  isDotIngressV2OnlyErrorCode
} from '../../../shared/dot-ingress/dot-ingress-errors-v2'
import {
  DOT_INGRESS_V3_FALLBACK_CODES,
  isDotIngressV3OnlyErrorCode
} from '../../../shared/dot-ingress/dot-ingress-errors-v3'
import {
  DOT_INGRESS_SERVED_CONTRACT_VERSIONS,
  DOT_UNSUPPORTED_CONTRACT_VERSION_MESSAGE,
  dotMethodNeedsNewerVersionMessage,
  isServedContractVersion,
  type DotContractVersion,
  type DotIngressMethodName
} from '../../../shared/dot-ingress/dot-ingress-versions'
import { OrchestrationError } from '../orchestration/orchestration-error'

// RG2: every call names its contract version. The dispatcher checks only that a version is present;
// the handler then parses the strict schema of that version, so an unknown field is still refused.

export const DotVersionedParamsSchema = z.object({ contractVersion: z.number().int() }).loose()
export type DotVersionedParams = z.infer<typeof DotVersionedParamsSchema>

export type DotVersionedCall<V1, V2, V3> =
  | { readonly version: 1; readonly params: V1 }
  | { readonly version: 2; readonly params: V2 }
  | { readonly version: 3; readonly params: V3 }

function unsupported(message: string): OrchestrationError {
  return new OrchestrationError('dot_unsupported_contract_version', message, {
    supportedContractVersions: [...DOT_INGRESS_SERVED_CONTRACT_VERSIONS]
  })
}

function servedVersion(raw: DotVersionedParams): DotContractVersion {
  const version = raw.contractVersion
  if (!isServedContractVersion(version)) {
    throw unsupported(DOT_UNSUPPORTED_CONTRACT_VERSION_MESSAGE)
  }
  return version
}

/** Parses with the strict schema of the stated version. */
export function parseDotCall<S1 extends z.ZodType, S2 extends z.ZodType, S3 extends z.ZodType>(
  raw: DotVersionedParams,
  schemas: { readonly v1: S1; readonly v2: S2; readonly v3: S3 }
): DotVersionedCall<z.output<S1>, z.output<S2>, z.output<S3>> {
  switch (servedVersion(raw)) {
    case 1:
      return { version: 1, params: schemas.v1.parse(raw) }
    case 2:
      return { version: 2, params: schemas.v2.parse(raw) }
    case 3:
      return { version: 3, params: schemas.v3.parse(raw) }
  }
}

/** For a method that exists from version 2 on: a version 1 call is told which version it needs. */
export function parseDotCallFromV2<S2 extends z.ZodType, S3 extends z.ZodType>(
  method: DotIngressMethodName,
  raw: DotVersionedParams,
  schemas: { readonly v2: S2; readonly v3: S3 }
):
  | { readonly version: 2; readonly params: z.output<S2> }
  | { readonly version: 3; readonly params: z.output<S3> } {
  const version = servedVersion(raw)
  if (version === 1) {
    throw unsupported(dotMethodNeedsNewerVersionMessage(method))
  }
  return version === 2
    ? { version: 2, params: schemas.v2.parse(raw) }
    : { version: 3, params: schemas.v3.parse(raw) }
}

/** For a method that exists from version 3 on: an older call is told which version it needs. */
export function parseDotCallFromV3<S3 extends z.ZodType>(
  method: DotIngressMethodName,
  raw: DotVersionedParams,
  v3: S3
): { readonly version: 3; readonly params: z.output<S3> } {
  if (servedVersion(raw) !== 3) {
    throw unsupported(dotMethodNeedsNewerVersionMessage(method))
  }
  return { version: 3, params: v3.parse(raw) }
}

/** The version 1 code an older caller receives instead of a code its version does not list. */
function fallbackCode(
  contractVersion: number,
  code: string
): keyof typeof DOT_INGRESS_ERROR_MESSAGES | null {
  if (contractVersion < 3 && isDotIngressV3OnlyErrorCode(code)) {
    return DOT_INGRESS_V3_FALLBACK_CODES[code]
  }
  if (contractVersion === 1 && isDotIngressV2OnlyErrorCode(code)) {
    return DOT_INGRESS_V1_FALLBACK_CODES[code]
  }
  return null
}

/** A caller never sees a code a newer version added: it gets the fallback of its version, same data. */
export function dotErrorForVersion(contractVersion: number, error: unknown): unknown {
  if (!(error instanceof OrchestrationError)) {
    return error
  }
  const fallback = fallbackCode(contractVersion, error.code)
  return fallback === null
    ? error
    : new OrchestrationError(fallback, DOT_INGRESS_ERROR_MESSAGES[fallback], error.data)
}

/** Runs one dot call and answers its refusal in the contract version the call named. */
export async function answerInVersion<T>(
  raw: DotVersionedParams,
  run: () => T | Promise<T>
): Promise<T> {
  try {
    return await run()
  } catch (error) {
    throw dotErrorForVersion(raw.contractVersion, error)
  }
}
