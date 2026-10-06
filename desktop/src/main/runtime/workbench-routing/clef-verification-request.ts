import {
  CLEF_CLASSIFIER_QUESTION_IDS,
  type ClefClassifierQuestionId
} from '../../../shared/clef/clef-answers'
import type { ClefQuestion } from '../../clef/clef-question-set'
import { buildClefRequest, type BuiltClefRequest } from '../../clef/clef-request-builder'
import type {
  ClefSentQuestionSummary,
  ClefSentRequestSummary
} from '../../clef/clef-verification-report'

/** Synthetic and non-sensitive on purpose: the verification call is the only one that is not a real TaskSpec. */
export const CLEF_VERIFICATION_OBJECTIVE =
  'Add a retry button to the request list so that a blocked request can be started again.'
export const CLEF_VERIFICATION_EXPECTED_OUTPUTS = [
  'A change to the request list that adds the button.'
] as const
export const CLEF_VERIFICATION_ACCEPTANCE_CRITERIA = [
  'The button starts the blocked request again and the existing tests still pass.'
] as const

export type ClefVerificationRequest = {
  readonly request: BuiltClefRequest
  /** What the report needs to read the answers back: ids, kinds and the option ids that were sent. */
  readonly sent: ClefSentRequestSummary
}

function summarizeQuestion(
  id: ClefClassifierQuestionId,
  question: ClefQuestion
): ClefSentQuestionSummary {
  switch (question.type) {
    case 'choice':
      return { id, kind: 'choice', optionIds: Object.keys(question.criteria) }
    case 'noul':
      return { id, kind: 'noul' }
  }
}

/**
 * The one synthetic English TaskSpec of spec section 14: the production two-question set, built by
 * the production builder so the verification exercises the same bytes a real classification would
 * carry. Throws only if the builder rejects its own fixed input.
 */
export function buildClefVerificationRequest(): ClefVerificationRequest {
  const built = buildClefRequest({
    objective: CLEF_VERIFICATION_OBJECTIVE,
    expectedOutputs: CLEF_VERIFICATION_EXPECTED_OUTPUTS,
    acceptanceCriteria: CLEF_VERIFICATION_ACCEPTANCE_CRITERIA
  })
  if (!built.ok) {
    throw new Error(`The Clef verification request must build: ${built.blocker.detail}`)
  }
  const { request } = built
  return {
    request,
    sent: {
      estimatedInputTokens: request.estimatedInputTokens,
      questions: CLEF_CLASSIFIER_QUESTION_IDS.map((id) =>
        summarizeQuestion(id, request.body.questions[id])
      )
    }
  }
}
