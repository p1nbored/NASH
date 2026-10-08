import { translate } from '@/i18n/i18n'
import type {
  ExecutionTarget,
  RoutingTaskType,
  ValidationReviewerTarget
} from '../../../../shared/routing-table/routing-table-taxonomy'
import type { Coordinator, Route } from '../../../../shared/routing-table/routing-table-schema'

type ReasoningLevel = Route['reasoning_level']

export function primaryAgentLabel(agent: Coordinator['agent']): string {
  return agent === 'codex' ? 'Codex' : 'Claude Code'
}

export function taskTypeLabel(taskType: RoutingTaskType): string {
  switch (taskType) {
    case 'coordinator_reasoning':
      return translate(
        'auto.components.settings.routingTable.labels.coordinatorReasoning',
        'Coordinator reasoning'
      )
    case 'complex_planning_reasoning':
      return translate(
        'auto.components.settings.routingTable.labels.complexPlanningReasoning',
        'Complex planning and reasoning'
      )
    case 'software_engineering':
      return translate(
        'auto.components.settings.routingTable.labels.softwareEngineering',
        'Software engineering'
      )
    case 'scientific_experiment_validation':
      return translate(
        'auto.components.settings.routingTable.labels.scientificExperimentValidation',
        'Scientific experiment validation'
      )
    case 'complex_pdf_evidence_analysis':
      return translate(
        'auto.components.settings.routingTable.labels.complexPdfEvidenceAnalysis',
        'Complex PDF and evidence analysis'
      )
    case 'general_research_analysis':
      return translate(
        'auto.components.settings.routingTable.labels.generalResearchAnalysis',
        'General research and analysis'
      )
    case 'routine_analysis_batch':
      return translate(
        'auto.components.settings.routingTable.labels.routineAnalysisBatch',
        'Routine analysis batch'
      )
    case 'high_quality_writing':
      return translate(
        'auto.components.settings.routingTable.labels.highQualityWriting',
        'High-quality writing'
      )
    case 'fast_writing_or_alternative_draft':
      return translate(
        'auto.components.settings.routingTable.labels.fastWritingOrAlternativeDraft',
        'Fast writing or alternative draft'
      )
    case 'configured_project_workflow':
      return translate(
        'auto.components.settings.routingTable.labels.configuredProjectWorkflow',
        'Configured project workflow'
      )
  }
}

export function executionTargetLabel(target: ExecutionTarget): string {
  switch (target) {
    case 'claude_primary':
      return translate(
        'auto.components.settings.routingTable.labels.claudePrimary',
        'Coordinator session'
      )
    case 'claude_subagent':
      return translate(
        'auto.components.settings.routingTable.labels.claudeSubagent',
        'Claude subagent'
      )
    case 'claude_workflow':
      return translate(
        'auto.components.settings.routingTable.labels.claudeWorkflow',
        'Claude workflow'
      )
    case 'codex_cli':
      return translate('auto.components.settings.routingTable.labels.codexCli', 'Codex CLI')
    case 'agy_cli':
      return translate('auto.components.settings.routingTable.labels.agyCli', 'agy CLI')
  }
}

export function reviewerLabel(index: number): string {
  return translate('auto.components.settings.routingTable.inline.reviewer', 'Reviewer {{number}}', {
    number: index + 1
  })
}

export function reviewerTargetLabel(target: ValidationReviewerTarget): string {
  return target === 'claude_headless'
    ? translate(
        'auto.components.settings.routingTable.labels.claudeHeadless',
        'Claude headless review'
      )
    : executionTargetLabel(target)
}

export function reasoningLevelLabel(level: ReasoningLevel): string {
  switch (level) {
    case 'none':
      return translate('auto.components.settings.routingTable.labels.none', 'None')
    case 'minimal':
      return translate('auto.components.settings.routingTable.labels.minimal', 'Minimal')
    case 'low':
      return translate('auto.components.settings.routingTable.labels.low', 'Low')
    case 'medium':
      return translate('auto.components.settings.routingTable.labels.medium', 'Medium')
    case 'high':
      return translate('auto.components.settings.routingTable.labels.high', 'High')
    case 'xhigh':
      return translate('auto.components.settings.routingTable.labels.xhigh', 'Extra high')
    case 'max':
      return translate('auto.components.settings.routingTable.labels.max', 'Max')
    case 'ultra':
      return translate('auto.components.settings.routingTable.labels.ultra', 'Ultra')
    case 'inherit':
      return translate('auto.components.settings.routingTable.labels.inherit', 'Inherit')
  }
}

export function sameAsCoordinatorLabel(): string {
  return translate(
    'auto.components.settings.routingTable.labels.sameAsCoordinator',
    'Same as coordinator'
  )
}

/** A route that runs with the coordinator's own model and effort. */
export function inheritsCoordinator(route: Pick<Route, 'model' | 'reasoning_level'>): boolean {
  return route.model === 'inherit' && route.reasoning_level === 'inherit'
}

/** The effort a route asks for, for example "Max (when supported)". */
export function routeEffortLabel(
  route: Pick<Route, 'reasoning_level' | 'reasoning_requirement'>
): string {
  const level = reasoningLevelLabel(route.reasoning_level)
  return route.reasoning_requirement === 'if_supported'
    ? `${level} ${translate('auto.components.settings.routingTable.labels.whenSupported', '(when supported)')}`
    : level
}
