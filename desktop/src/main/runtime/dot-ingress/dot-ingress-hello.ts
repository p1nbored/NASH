import {
  DOT_DECISION_SUMMARY_MAX_CHARS,
  DOT_INGRESS_CONTRACT_VERSION,
  DOT_INGRESS_PROSE_MAX_CHARS,
  DOT_INGRESS_SUPPORTED_CONTRACT_VERSIONS
} from '../../../shared/dot-ingress/dot-ingress-limits'
import { DOT_MESSAGE_TEXT_MAX_CHARS } from '../../../shared/dot-ingress/dot-ingress-message'
import {
  DotHelloResultSchema,
  type DotHelloResult
} from '../../../shared/dot-ingress/dot-ingress-request'
import {
  DotHelloResultV2Schema,
  type DotHelloResultV2
} from '../../../shared/dot-ingress/dot-ingress-v2'
import {
  DotHelloResultV3Schema,
  type DotHelloResultV3
} from '../../../shared/dot-ingress/dot-ingress-v3'
import {
  DOT_VALIDATION_SUMMARY_MAX_CHARS,
  DOT_VALIDATION_TITLE_MAX_CHARS
} from '../../../shared/dot-ingress/dot-ingress-validation'
import {
  DOT_INGRESS_CONTRACT_VERSION_THREE,
  DOT_INGRESS_CONTRACT_VERSION_TWO,
  DOT_INGRESS_SERVED_CONTRACT_VERSIONS,
  dotMethodsServedIn
} from '../../../shared/dot-ingress/dot-ingress-versions'
import {
  WORKBENCH_LIST_MAX_LIMIT,
  WORKBENCH_OBJECTIVE_MAX_LENGTH
} from '../../../shared/workbench-request'
import type { DotIngressSettings } from '../orchestration/db/dot-ingress-settings-store'

// Hello never claims a connection, an approval or a result. Version 1 keeps its frozen shape, whose
// capability flags hold only while every version 1 method is registered (tested with the registry).

function limitsOf(settings: DotIngressSettings) {
  return {
    maxObjectiveChars: WORKBENCH_OBJECTIVE_MAX_LENGTH,
    maxProseChars: DOT_INGRESS_PROSE_MAX_CHARS,
    listMaxLimit: WORKBENCH_LIST_MAX_LIMIT,
    // The user's current caps, which the user can change.
    maxSubmissionsPerMinute: settings.ratePerMinute,
    maxSubmissionsPerUtcDay: settings.ratePerUtcDay,
    maxDecisionSummaryChars: DOT_DECISION_SUMMARY_MAX_CHARS
  }
}

export function helloResultV1(settings: DotIngressSettings): DotHelloResult {
  return DotHelloResultSchema.parse({
    contractVersion: DOT_INGRESS_CONTRACT_VERSION,
    supportedContractVersions: [...DOT_INGRESS_SUPPORTED_CONTRACT_VERSIONS],
    limits: limitsOf(settings),
    capabilities: {
      submit: true,
      status: true,
      list: true,
      cancel: true,
      decisions: true,
      startsWithoutConfirmation: true,
      results: false,
      artifacts: false
    }
  })
}

/**
 * `methods` is read from the endpoint's own registry, so hello cannot advertise a missing method.
 * Version 2 lists the versions and methods a version 2 client knows; version 3 is found by asking it.
 */
export function helloResultV2(
  settings: DotIngressSettings,
  registeredMethods: readonly string[]
): DotHelloResultV2 {
  return DotHelloResultV2Schema.parse({
    contractVersion: DOT_INGRESS_CONTRACT_VERSION_TWO,
    supportedContractVersions: DOT_INGRESS_SERVED_CONTRACT_VERSIONS.filter(
      (version) => version <= DOT_INGRESS_CONTRACT_VERSION_TWO
    ),
    methods: dotMethodsServedIn(DOT_INGRESS_CONTRACT_VERSION_TWO, registeredMethods),
    limits: { ...limitsOf(settings), maxMessageChars: DOT_MESSAGE_TEXT_MAX_CHARS },
    capabilities: { startsWithoutConfirmation: true, results: false, artifacts: false }
  })
}

/** Version 3 adds the validation decisions dot may list and decide, with the bounds of their text. */
export function helloResultV3(
  settings: DotIngressSettings,
  registeredMethods: readonly string[]
): DotHelloResultV3 {
  return DotHelloResultV3Schema.parse({
    contractVersion: DOT_INGRESS_CONTRACT_VERSION_THREE,
    supportedContractVersions: [...DOT_INGRESS_SERVED_CONTRACT_VERSIONS],
    methods: dotMethodsServedIn(DOT_INGRESS_CONTRACT_VERSION_THREE, registeredMethods),
    limits: {
      ...limitsOf(settings),
      maxMessageChars: DOT_MESSAGE_TEXT_MAX_CHARS,
      maxValidationTitleChars: DOT_VALIDATION_TITLE_MAX_CHARS,
      maxValidationSummaryChars: DOT_VALIDATION_SUMMARY_MAX_CHARS
    },
    capabilities: {
      startsWithoutConfirmation: true,
      results: false,
      artifacts: false,
      validationDecisions: true
    }
  })
}
