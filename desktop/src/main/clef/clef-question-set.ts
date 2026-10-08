import {
  CLEF_CLASSIFIER_QUESTION_IDS,
  type ClefClassifierQuestionId
} from '../../shared/clef/clef-answers'
import {
  ROUTING_TAXONOMY_VERSION,
  type CLASSIFIER_ONLY_TASK_TYPES,
  type RoutingTaskType
} from '../../shared/routing-table/routing-table-taxonomy'
import { clefCanonicalSha256 } from './clef-verified-profile'

/** Question set 2 asks the two D-016 questions; version 1 asked five and offered route options. */
export const CLEF_QUESTION_SET_VERSION = 2
/** The taxonomy of the Routing Table; a table of another taxonomy cannot activate. */
export const CLEF_TAXONOMY_VERSION = ROUTING_TAXONOMY_VERSION

export type ClefChoiceQuestion = {
  readonly type: 'choice'
  readonly instructions: string
  readonly criteria: Readonly<Record<string, string>>
}
export type ClefNoulQuestion = {
  readonly type: 'noul'
  readonly instructions: string
  readonly criteria: { readonly true: string; readonly false: string }
}
export type ClefQuestion = ClefChoiceQuestion | ClefNoulQuestion

export type ClefClassifierQuestions = {
  readonly task_type: ClefChoiceQuestion
  readonly needs_delegation: ClefNoulQuestion
}

export const QUESTION_INSTRUCTIONS: Readonly<Record<ClefClassifierQuestionId, string>> =
  Object.freeze({
    task_type: 'Classify the main kind of work that the task in the state asks for.',
    needs_delegation:
      'Should this task be handed to a separate executor instead of being done by the coordinating session itself?'
  })

type TaskTypeOptionId = RoutingTaskType | (typeof CLASSIFIER_ONLY_TASK_TYPES)[number]

/** One option per taxonomy entry, in taxonomy order; the keys are exactly what the Routing Table covers. */
export const TASK_TYPE_OPTIONS: Readonly<Record<TaskTypeOptionId, string>> = Object.freeze({
  coordinator_reasoning:
    'Reasoning the coordinating session does for itself: interpreting results, deciding next steps, integrating outputs or judging overall progress.',
  complex_planning_reasoning:
    'Difficult planning, design or multi-step reasoning, such as architecture or decomposing a hard problem.',
  software_engineering:
    'Writing, changing, debugging, testing or reviewing code, configuration, builds or terminal automation.',
  scientific_experiment_validation:
    'Designing, running or checking scientific experiments, numerical analyses or research code and their results.',
  complex_pdf_evidence_analysis:
    'Extracting and reconciling evidence from long or complex PDFs or other documents, with citations.',
  general_research_analysis:
    'Investigating a question across sources and producing an analysis or comparison.',
  routine_analysis_batch:
    'Repetitive or high-volume analysis of many similar items with a fixed procedure.',
  high_quality_writing:
    'Polished prose where quality matters most, such as reports, documentation or final deliverables.',
  fast_writing_or_alternative_draft:
    'A quick draft or an alternative version of a text, where speed matters more than polish.',
  configured_project_workflow:
    'Running a workflow that the project already defines and that the task names.',
  needs_clarification: 'The task does not say clearly enough what kind of work it is.'
})

export const NEEDS_DELEGATION_CRITERIA = Object.freeze({
  true: "The task is self-contained, states its inputs and acceptance criteria, and a separate agent can do it without the coordinator's full context.",
  false:
    "The task depends on the coordinator's own context or judgment, or is too small to be worth handing off."
})

export type ClefDecisionThresholds = {
  /** needs_delegation counts as true at this probability or more. */
  readonly delegationTrueMin: number
  /** needs_delegation counts as false at this probability or less; between the two is ambiguous. */
  readonly delegationFalseMax: number
  /** The task_type leader must beat the runner-up by at least this much. */
  readonly taskTypeMarginMin: number
}

/**
 * Changing a default changes the bundle hash, so the pinned
 * verification reads as absent and Verify must run again.
 */
export const CLEF_DECISION_THRESHOLDS: ClefDecisionThresholds = Object.freeze({
  delegationTrueMin: 0.6,
  delegationFalseMax: 0.4,
  taskTypeMarginMin: 0.1
})

/** The two questions in pinned send order (question_set_version 2). */
export function buildClassifierQuestions(): ClefClassifierQuestions {
  return {
    task_type: {
      type: 'choice',
      instructions: QUESTION_INSTRUCTIONS.task_type,
      criteria: TASK_TYPE_OPTIONS
    },
    needs_delegation: {
      type: 'noul',
      instructions: QUESTION_INSTRUCTIONS.needs_delegation,
      criteria: NEEDS_DELEGATION_CRITERIA
    }
  }
}

export type ClefQuestionBundle = {
  readonly question_set_version: number
  readonly taxonomy_version: number
  readonly question_order: readonly string[]
  readonly instructions: Readonly<Record<string, string>>
  readonly task_type_options: Readonly<Record<string, string>>
  readonly needs_delegation_criteria: { readonly true: string; readonly false: string }
  readonly thresholds: ClefDecisionThresholds
}

/**
 * Every bundle-controlled control text and threshold. Targets, models and efforts never appear:
 * Routing Table edits therefore never touch the Clef pin, and taxonomy edits always do.
 */
export const CLEF_QUESTION_BUNDLE: ClefQuestionBundle = Object.freeze({
  question_set_version: CLEF_QUESTION_SET_VERSION,
  taxonomy_version: CLEF_TAXONOMY_VERSION,
  question_order: CLEF_CLASSIFIER_QUESTION_IDS,
  instructions: QUESTION_INSTRUCTIONS,
  task_type_options: TASK_TYPE_OPTIONS,
  needs_delegation_criteria: NEEDS_DELEGATION_CRITERIA,
  thresholds: CLEF_DECISION_THRESHOLDS
})

export function computeQuestionBundleSha256(bundle: ClefQuestionBundle): string {
  return clefCanonicalSha256(bundle)
}

export const CLEF_QUESTION_BUNDLE_SHA256 = computeQuestionBundleSha256(CLEF_QUESTION_BUNDLE)

export const CLEF_QUESTION_ORDER_SHA256 = clefCanonicalSha256({
  question_order: CLEF_CLASSIFIER_QUESTION_IDS
})
