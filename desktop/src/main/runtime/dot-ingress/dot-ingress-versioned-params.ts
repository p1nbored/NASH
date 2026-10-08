import { z } from 'zod'
import { DOT_INGRESS_SUPPORTED_CONTRACT_VERSIONS } from '../../../shared/dot-ingress/dot-ingress-limits'
import {
  DOT_UNSUPPORTED_CONTRACT_VERSION_MESSAGE,
  isServedContractVersion
} from '../../../shared/dot-ingress/dot-ingress-versions'
import { OrchestrationError } from '../orchestration/orchestration-error'

export const DotVersionedParamsSchema = z.object({ contractVersion: z.number().int() }).loose()
export type DotVersionedParams = z.infer<typeof DotVersionedParamsSchema>

/** Validate the supported version before parsing the strict method schema. */
export function parseDotCall<S extends z.ZodType>(raw: DotVersionedParams, schema: S): z.output<S> {
  if (!isServedContractVersion(raw.contractVersion)) {
    throw new OrchestrationError(
      'dot_unsupported_contract_version',
      DOT_UNSUPPORTED_CONTRACT_VERSION_MESSAGE,
      {
        supportedContractVersions: [...DOT_INGRESS_SUPPORTED_CONTRACT_VERSIONS]
      }
    )
  }
  return schema.parse(raw)
}
