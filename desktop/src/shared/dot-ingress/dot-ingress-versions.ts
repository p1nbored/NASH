import {
  DOT_INGRESS_CONTRACT_VERSION,
  DOT_INGRESS_SUPPORTED_CONTRACT_VERSIONS
} from './dot-ingress-limits'

export const DOT_INGRESS_METHOD_NAMES = [
  'dotIngress.hello',
  'dotIngress.workspaces.list',
  'dotIngress.requests.submit',
  'dotIngress.requests.status',
  'dotIngress.requests.list',
  'dotIngress.requests.cancel',
  'dotIngress.requests.message',
  'dotIngress.decisions.list',
  'dotIngress.decisions.answer',
  'dotIngress.validations.list',
  'dotIngress.validations.decide'
] as const
export type DotIngressMethodName = (typeof DOT_INGRESS_METHOD_NAMES)[number]
export type DotContractVersion = typeof DOT_INGRESS_CONTRACT_VERSION

export function isServedContractVersion(value: unknown): value is DotContractVersion {
  return value === DOT_INGRESS_CONTRACT_VERSION
}

export function dotMethodsServed(registered: readonly string[]): DotIngressMethodName[] {
  return registered.filter((name): name is DotIngressMethodName =>
    DOT_INGRESS_METHOD_NAMES.some((known) => known === name)
  )
}

export const DOT_UNSUPPORTED_CONTRACT_VERSION_MESSAGE = `Unsupported contract version. Supported versions: ${DOT_INGRESS_SUPPORTED_CONTRACT_VERSIONS.join(', ')}.`
