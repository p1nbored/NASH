import { translate } from '@/i18n/i18n'
import type {
  ExecutionTarget,
  RoutingTaskType,
  ValidationReviewerTarget
} from '../../../../shared/routing-table/routing-table-taxonomy'
import type {
  ProposalDecision,
  RoutingTableProposal
} from '../../../../shared/routing-table/routing-table-proposal-schema'
import type { Route } from '../../../../shared/routing-table/routing-table-schema'

type ReasoningLevel = Route['reasoning_level']

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
        'Claude primary session'
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

export function proposerLabel(proposer: RoutingTableProposal['proposer']): string {
  switch (proposer) {
    case 'bundled_update':
      return translate('auto.components.settings.routingTable.labels.bundledUpdate', 'App update')
    case 'benchmark_review':
      return translate(
        'auto.components.settings.routingTable.labels.benchmarkReview',
        'Benchmark review'
      )
    case 'agent':
      return translate('auto.components.settings.routingTable.labels.agent', 'Agent')
    case 'user_import':
      return translate('auto.components.settings.routingTable.labels.userImport', 'Your change')
  }
}

export function proposalDecisionLabel(decision: ProposalDecision['decision']): string {
  switch (decision) {
    case 'accepted':
      return translate('auto.components.settings.routingTable.labels.accepted', 'Accepted')
    case 'accepted_modified':
      return translate(
        'auto.components.settings.routingTable.labels.acceptedModified',
        'Accepted with changes'
      )
    case 'rejected':
      return translate('auto.components.settings.routingTable.labels.rejected', 'Rejected')
    case 'superseded':
      return translate('auto.components.settings.routingTable.labels.superseded', 'Superseded')
  }
}

export function tableSourceLabel(source: 'bundled' | 'user'): string {
  return source === 'bundled'
    ? translate('auto.components.settings.routingTable.labels.sourceBundled', 'App default')
    : translate('auto.components.settings.routingTable.labels.sourceUser', 'Your table')
}

/** One line per route policy, for example "Codex CLI · gpt-6-astra · Max". */
export function routeSummary(route: Route): string {
  if (route.model === 'inherit' && route.reasoning_level === 'inherit') {
    return `${executionTargetLabel(route.execution_target)} · ${translate(
      'auto.components.settings.routingTable.labels.inheritsCoordinator',
      'Inherits coordinator'
    )}`
  }
  const level = reasoningLevelLabel(route.reasoning_level)
  const requirement =
    route.reasoning_requirement === 'if_supported'
      ? ` ${translate('auto.components.settings.routingTable.labels.whenSupported', '(when supported)')}`
      : ''
  return `${executionTargetLabel(route.execution_target)} · ${route.model} · ${level}${requirement}`
}
