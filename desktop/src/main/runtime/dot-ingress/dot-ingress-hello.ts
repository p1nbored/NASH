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
  DOT_VALIDATION_SUMMARY_MAX_CHARS,
  DOT_VALIDATION_TITLE_MAX_CHARS
} from '../../../shared/dot-ingress/dot-ingress-validation'
import { dotMethodsServed } from '../../../shared/dot-ingress/dot-ingress-versions'
import {
  WORKBENCH_LIST_MAX_LIMIT,
  WORKBENCH_OBJECTIVE_MAX_LENGTH
} from '../../../shared/workbench-request'
import type { DotIngressSettings } from '../orchestration/db/dot-ingress-settings-store'

// Hello reports the methods registered on this ingress endpoint.

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

/** Version 3 adds the validation decisions dot may list and decide, with the bounds of their text. */
export function helloResult(
  settings: DotIngressSettings,
  registeredMethods: readonly string[]
): DotHelloResult {
  return DotHelloResultSchema.parse({
    contractVersion: DOT_INGRESS_CONTRACT_VERSION,
    supportedContractVersions: [...DOT_INGRESS_SUPPORTED_CONTRACT_VERSIONS],
    methods: dotMethodsServed(registeredMethods),
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
