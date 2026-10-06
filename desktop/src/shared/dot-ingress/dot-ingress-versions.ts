import { DOT_INGRESS_CONTRACT_VERSION } from './dot-ingress-limits'

// RG2: contract version 2 adds the follow-up message (D-019), the dot-side `closed` decision outcome
// and the access ceiling views. Version 3 (G7) adds the validation decisions dot may list and decide.
// Versions 1 and 2 stay frozen and are still served unchanged.

export const DOT_INGRESS_CONTRACT_VERSION_TWO = 2 as const
export const DOT_INGRESS_CONTRACT_VERSION_THREE = 3 as const
export const DOT_INGRESS_SERVED_CONTRACT_VERSIONS = [
  DOT_INGRESS_CONTRACT_VERSION,
  DOT_INGRESS_CONTRACT_VERSION_TWO,
  DOT_INGRESS_CONTRACT_VERSION_THREE
] as const
export type DotContractVersion = (typeof DOT_INGRESS_SERVED_CONTRACT_VERSIONS)[number]

/** The surface of version 2, frozen: its golden enumerates exactly these names. */
export const DOT_INGRESS_V2_METHOD_NAMES = [
  'dotIngress.hello',
  'dotIngress.workspaces.list',
  'dotIngress.requests.submit',
  'dotIngress.requests.status',
  'dotIngress.requests.list',
  'dotIngress.requests.cancel',
  'dotIngress.requests.message',
  'dotIngress.decisions.list',
  'dotIngress.decisions.answer'
] as const

/** The closed dot surface; every name is served on the ingress endpoint only. */
export const DOT_INGRESS_METHOD_NAMES = [
  ...DOT_INGRESS_V2_METHOD_NAMES,
  'dotIngress.validations.list',
  'dotIngress.validations.decide'
] as const
export type DotIngressMethodName = (typeof DOT_INGRESS_METHOD_NAMES)[number]

/** The first contract version that serves each method. */
export const DOT_INGRESS_METHOD_VERSIONS = {
  'dotIngress.hello': 1,
  'dotIngress.workspaces.list': 1,
  'dotIngress.requests.submit': 1,
  'dotIngress.requests.status': 1,
  'dotIngress.requests.list': 1,
  'dotIngress.requests.cancel': 1,
  'dotIngress.requests.message': 2,
  'dotIngress.decisions.list': 1,
  'dotIngress.decisions.answer': 1,
  'dotIngress.validations.list': 3,
  'dotIngress.validations.decide': 3
} as const satisfies Record<DotIngressMethodName, DotContractVersion>

export function isServedContractVersion(value: unknown): value is DotContractVersion {
  return DOT_INGRESS_SERVED_CONTRACT_VERSIONS.some((version) => version === value)
}

function isDotIngressMethodName(name: string): name is DotIngressMethodName {
  return DOT_INGRESS_METHOD_NAMES.some((known) => known === name)
}

/** The registered names a caller of `version` may see, in registry order: never a newer method. */
export function dotMethodsServedIn(
  version: DotContractVersion,
  registered: readonly string[]
): DotIngressMethodName[] {
  return registered.filter(
    (name): name is DotIngressMethodName =>
      isDotIngressMethodName(name) && DOT_INGRESS_METHOD_VERSIONS[name] <= version
  )
}

// Why its own text: the version 1 catalog message is frozen with version 1 alone in it.
export const DOT_UNSUPPORTED_CONTRACT_VERSION_MESSAGE = `Unsupported contract version. Supported versions: ${DOT_INGRESS_SERVED_CONTRACT_VERSIONS.join(', ')}.`

export function dotMethodNeedsNewerVersionMessage(method: DotIngressMethodName): string {
  return `This method needs contract version ${DOT_INGRESS_METHOD_VERSIONS[method]} or later.`
}
