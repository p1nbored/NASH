import { dotIngressErrorMessage } from '../../../shared/dot-ingress/dot-ingress-errors'
import {
  DOT_INGRESS_PRINCIPAL_ID,
  DOT_INGRESS_SOURCE
} from '../../../shared/dot-ingress/dot-ingress-limits'
import { OrchestrationError } from '../orchestration/orchestration-error'

/** A different brand from the desktop WorkbenchCaller, so neither gate accepts the other. */
export type DotIngressCaller = Readonly<{
  principalId: typeof DOT_INGRESS_PRINCIPAL_ID
  source: typeof DOT_INGRESS_SOURCE
}>
const issuedCallers = new WeakSet<DotIngressCaller>()

/** Issued only by the admission step, after the ingress token was proven. */
export function issueDotIngressCaller(): DotIngressCaller {
  const caller: DotIngressCaller = Object.freeze({
    principalId: DOT_INGRESS_PRINCIPAL_ID,
    source: DOT_INGRESS_SOURCE
  })
  issuedCallers.add(caller)
  return caller
}

export function requireDotIngressCaller(caller: DotIngressCaller | undefined): DotIngressCaller {
  if (!caller || !issuedCallers.has(caller)) {
    throw new OrchestrationError(
      'dot_ingress_forbidden',
      dotIngressErrorMessage('dot_ingress_forbidden')
    )
  }
  return caller
}
