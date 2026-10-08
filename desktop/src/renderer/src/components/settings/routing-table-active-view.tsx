import { useId, useState } from 'react'
import { translate } from '@/i18n/i18n'
import type { RoutingTableChanges } from '../../../../shared/routing-table/routing-table-edit-schema'
import type {
  RoutingTable,
  ValidationReviewer
} from '../../../../shared/routing-table/routing-table-schema'
import { COORDINATOR_TASK_TYPE } from '../../../../shared/routing-table/routing-table-taxonomy'
import type {
  RouteAvailabilityView,
  RoutingTableAvailabilityView
} from '../../../../shared/workbench-route-availability-view'
import { Button } from '../ui/button'
import { RouteAvailabilityStatus } from './routing-table-availability'
import { routeAvailabilityLabel } from './routing-table-availability-messages'
import {
  changesFromDraft,
  draftFromTable,
  withRouteEdit,
  type DraftError,
  type EditorDraft
} from './routing-table-editor-model'
import type { InlineEditKey } from './routing-table-inline-edit'
import {
  CoordinatorChoiceEditor,
  RouteChoiceEditor,
  type EditorCallbacks
} from './routing-table-inline-editor'
import {
  executionTargetLabel,
  inheritsCoordinator,
  primaryAgentLabel,
  reasoningLevelLabel,
  reviewerLabel,
  reviewerTargetLabel,
  routeEffortLabel,
  sameAsCoordinatorLabel,
  taskTypeLabel
} from './routing-table-labels'
import { ReviewerChoiceEditor } from './routing-table-reviewer-editor'

type Editing = { key: InlineEditKey; draft: EditorDraft; errors: readonly DraftError[] }

/** "Codex CLI · gpt-6-astra · Max"; the model is an ID, so it reads as literal text. */
function ChoiceSummary(props: {
  agent: string
  model: string | null
  effort: string
}): React.JSX.Element {
  return (
    <>
      {props.agent}
      {props.model === null ? null : (
        <>
          {' · '}
          <span className="font-mono">{props.model}</span>
        </>
      )}
      {` · ${props.effort}`}
    </>
  )
}

function ChoiceRow(props: {
  label: string
  summary: React.ReactNode
  status: RouteAvailabilityView | null
  editor?: React.ReactNode
  edit?: { label: string; disabled: boolean; onClick: () => void }
}): React.JSX.Element {
  const labelId = useId()
  const detail = props.status ? routeAvailabilityLabel(props.status).detail : ''
  const editing = props.editor !== undefined && props.editor !== null
  return (
    <li aria-labelledby={labelId} className="py-row">
      <div className="flex flex-wrap items-start gap-x-group gap-y-1">
        <div className="min-w-0 flex-1 basis-64">
          <p id={labelId} className="text-body text-foreground">
            {props.label}
          </p>
          {editing ? null : <p className="text-meta text-muted-foreground">{props.summary}</p>}
          {editing || detail === '' ? null : (
            <p className="text-meta text-muted-foreground">{detail}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-row">
          {props.status ? <RouteAvailabilityStatus availability={props.status} /> : null}
          {props.edit === undefined || editing ? null : (
            <Button
              variant="ghost"
              size="xs"
              aria-label={props.edit.label}
              disabled={props.edit.disabled}
              onClick={props.edit.onClick}
            >
              {translate('auto.components.settings.routingTable.inline.edit', 'Edit')}
            </Button>
          )}
        </div>
      </div>
      {props.editor}
    </li>
  )
}

function Reviewers({
  table,
  availability,
  editFor,
  editing,
  editorProps,
  onChange
}: {
  table: RoutingTable
  availability: RoutingTableAvailabilityView | null
  editFor: (
    key: InlineEditKey,
    label: string
  ) => { label: string; disabled: boolean; onClick: () => void }
  editing: Editing | null
  editorProps: (index: number) => EditorCallbacks
  onChange: (index: number, reviewer: ValidationReviewer) => void
}): React.JSX.Element {
  const headingId = useId()
  const { reviewers } = table.validation
  return (
    <div className="space-y-1">
      <p id={headingId} className="text-meta font-medium text-foreground">
        {translate('auto.components.settings.routingTable.inline.reviewersTitle', 'Reviewers')}
      </p>
      <p className="text-meta text-muted-foreground">
        {translate(
          'auto.components.settings.routingTable.inline.reviewersHelp',
          'Review finished work that has no automatic check.'
        )}
      </p>
      {reviewers.length === 0 ? (
        <p className="text-meta text-muted-foreground">
          {translate(
            'auto.components.settings.routingTable.inline.noReviewers',
            'No reviewers, so work without an automatic check cannot be reviewed.'
          )}
        </p>
      ) : (
        <ul aria-labelledby={headingId} className="divide-y divide-border/50">
          {reviewers.map((reviewer, index) => (
            <ChoiceRow
              key={`${reviewer.target}:${reviewer.model}:${reviewer.reasoning_level}`}
              label={reviewerLabel(index)}
              summary={
                <ChoiceSummary
                  agent={reviewerTargetLabel(reviewer.target)}
                  model={reviewer.model}
                  effort={reasoningLevelLabel(reviewer.reasoning_level)}
                />
              }
              status={availability?.reviewers[index] ?? null}
              edit={editFor(index, reviewerLabel(index))}
              editor={
                editing?.key === index && editing.draft.validation.reviewers[index] ? (
                  <ReviewerChoiceEditor
                    {...editorProps(index)}
                    reviewer={editing.draft.validation.reviewers[index]}
                    label={reviewerLabel(index)}
                    onChange={(updated) => onChange(index, updated)}
                  />
                ) : null
              }
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function messagesFor(editing: Editing, key: InlineEditKey): string | null {
  const messages = editing.errors
    .filter((error) => error.field === key)
    .map((error) => error.message)
  return messages.length === 0 ? null : messages.join(' ')
}

/**
 * Each kind of task with its agent, model and effort, edited in place; then the coordinator and the
 * reviewers in the same words. Saving one row activates it as the user's own change (D-016).
 */
type RoutingTableTaskListProps = {
  table: RoutingTable
  availability: RoutingTableAvailabilityView | null
  busy: boolean
  onSave: (changes: RoutingTableChanges) => Promise<boolean>
}

export function RoutingTableTaskList(props: RoutingTableTaskListProps): React.JSX.Element {
  return <RoutingTableTaskListEditor key={props.table.table_version} {...props} />
}

function RoutingTableTaskListEditor({
  table,
  availability,
  busy,
  onSave
}: RoutingTableTaskListProps): React.JSX.Element {
  const [editing, setEditing] = useState<Editing | null>(null)
  const byTaskType = new Map(
    (availability?.routes ?? []).map((row) => [row.taskType, row.availability])
  )
  const start = (key: InlineEditKey): void =>
    setEditing({ key, draft: draftFromTable(table), errors: [] })
  const cancel = (): void => setEditing(null)
  const editFor = (key: InlineEditKey, label: string) => ({
    label: translate('auto.components.settings.routingTable.inline.editFor', 'Edit {{task}}', {
      task: label
    }),
    disabled: busy || editing !== null,
    onClick: () => start(key)
  })

  const save = async (): Promise<void> => {
    if (editing === null) {
      return
    }
    const result = changesFromDraft(table, editing.draft)
    if (!result.ok) {
      // Why: the only table-wide error is "nothing changed", which needs no message here.
      const rowErrors = result.errors.filter((error) => error.field !== 'table')
      setEditing(rowErrors.length === 0 ? null : { ...editing, errors: rowErrors })
      return
    }
    if (await onSave(result.changes)) {
      setEditing(null)
    }
  }
  const editorProps = (key: InlineEditKey) => ({
    busy,
    error: editing === null ? null : messagesFor(editing, key),
    onSave: () => void save(),
    onCancel: cancel
  })

  const coordinatorLabel = translate(
    'auto.components.settings.routingTable.inline.coordinator',
    'Coordinator'
  )
  return (
    <div className="space-y-group">
      <ul
        aria-label={translate(
          'auto.components.settings.routingTable.inline.listLabel',
          'Agent for each task'
        )}
        className="divide-y divide-border/50"
      >
        <ChoiceRow
          label={coordinatorLabel}
          summary={
            <ChoiceSummary
              agent={primaryAgentLabel(table.coordinator.agent)}
              model={table.coordinator.model}
              effort={reasoningLevelLabel(table.coordinator.reasoning_level)}
            />
          }
          status={availability?.coordinator ?? null}
          edit={editFor('coordinator', coordinatorLabel)}
          editor={
            editing?.key === 'coordinator' ? (
              <CoordinatorChoiceEditor
                {...editorProps('coordinator')}
                coordinator={editing.draft.coordinator}
                onChange={(coordinator) =>
                  setEditing({ ...editing, draft: { ...editing.draft, coordinator } })
                }
              />
            ) : null
          }
        />
        {table.routes
          .filter((route) => route.task_type !== COORDINATOR_TASK_TYPE)
          .map((route) => {
            const label = taskTypeLabel(route.task_type)
            const row =
              editing?.key === route.task_type
                ? editing.draft.routes.find((entry) => entry.taskType === route.task_type)
                : undefined
            return (
              <ChoiceRow
                key={route.task_type}
                label={label}
                summary={
                  inheritsCoordinator(route) ? (
                    `${executionTargetLabel(route.execution_target)} · ${sameAsCoordinatorLabel()}`
                  ) : (
                    <ChoiceSummary
                      agent={executionTargetLabel(route.execution_target)}
                      model={route.model}
                      effort={routeEffortLabel(route)}
                    />
                  )
                }
                status={byTaskType.get(route.task_type) ?? null}
                edit={editFor(route.task_type, label)}
                editor={
                  editing !== null && row !== undefined ? (
                    <RouteChoiceEditor
                      {...editorProps(route.task_type)}
                      row={row}
                      taskLabel={label}
                      coordinator={editing.draft.coordinator}
                      onEdit={(edit) =>
                        setEditing({
                          ...editing,
                          draft: withRouteEdit(editing.draft, route.task_type, edit)
                        })
                      }
                    />
                  ) : null
                }
              />
            )
          })}
      </ul>
      <Reviewers
        table={table}
        availability={availability}
        editFor={editFor}
        editing={editing}
        editorProps={editorProps}
        onChange={(index, updated) => {
          if (editing === null) {
            return
          }
          setEditing({
            ...editing,
            draft: {
              ...editing.draft,
              validation: {
                ...editing.draft.validation,
                reviewers: editing.draft.validation.reviewers.map((entry, position) =>
                  position === index ? updated : entry
                )
              }
            }
          })
        }}
      />
    </div>
  )
}
