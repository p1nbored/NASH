import { z } from 'zod'
import { DotSubmitParams } from './dot-ingress-params'

/** A separate method preserves the existing submit contract for older peers. */
export const DotAttachParams = DotSubmitParams.extend({
  coordinatorRunId: z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/)
})
export type DotAttachInput = z.infer<typeof DotAttachParams>
export const DotRemoteSubmitOrAttachParams = DotSubmitParams.extend({
  coordinatorRunId: DotAttachParams.shape.coordinatorRunId.optional()
})
