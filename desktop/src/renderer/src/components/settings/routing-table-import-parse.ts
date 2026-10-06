import { translate } from '@/i18n/i18n'
import {
  ProposalSubmissionSchema,
  type ProposalSubmission
} from '../../../../shared/routing-table/routing-table-proposal-schema'
import { ROUTING_TABLE_SCHEMA_VERSION } from '../../../../shared/routing-table/routing-table-schema'

export type ActiveVersionRef = { readonly version: number; readonly sha256: string }

export type ImportParse =
  | { readonly ok: true; readonly submission: ProposalSubmission }
  | { readonly ok: false; readonly message: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** "changes 1" for path ['changes', 0]: one-based positions read better than indexes. */
function readablePath(path: readonly PropertyKey[]): string {
  return path.map((part) => (typeof part === 'number' ? String(part + 1) : String(part))).join(' ')
}

/**
 * A pasted change set (or an exported proposal) as the user's own import. The proposer is always
 * `user_import`: whatever produced the file, the desktop user is the one submitting it.
 */
export function parseImportedChangeSet(
  text: string,
  reason: string,
  active: ActiveVersionRef | null
): ImportParse {
  if (active === null) {
    return {
      ok: false,
      message: translate(
        'auto.components.settings.routingTable.import.noActive',
        'There is no active version to base the change on, so nothing can be imported.'
      )
    }
  }
  const pasted = readJson(text.trim())
  if (!isRecord(pasted)) {
    return {
      ok: false,
      message: translate(
        'auto.components.settings.routingTable.import.notJson',
        'The change set is not valid JSON object text.'
      )
    }
  }
  const rationale = reason.trim() || (typeof pasted.rationale === 'string' ? pasted.rationale : '')
  if (rationale === '') {
    return {
      ok: false,
      message: translate(
        'auto.components.settings.routingTable.import.reasonMissing',
        'Enter a short English reason for the change.'
      )
    }
  }
  const parsed = ProposalSubmissionSchema.safeParse({
    evidence: [],
    changes: [],
    ...pasted,
    schema_version: ROUTING_TABLE_SCHEMA_VERSION,
    proposer: 'user_import',
    base: { table_version: active.version, sha256: active.sha256 },
    rationale
  })
  if (!parsed.success) {
    const path = readablePath(parsed.error.issues[0]?.path ?? [])
    return {
      ok: false,
      message: translate(
        'auto.components.settings.routingTable.import.invalidAt',
        'The change set is not valid at "{{path}}". Check target, model and reasoning values.',
        { path }
      )
    }
  }
  return { ok: true, submission: parsed.data }
}
