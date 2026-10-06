import type {
  Coordinator,
  Route,
  RoutingTable,
  TableVersionRef,
  ValidationPolicy
} from '../../shared/routing-table/routing-table-schema'

export type DerivationInput = {
  readonly tableVersion: number
  readonly source: 'bundled' | 'user'
  readonly basedOn: TableVersionRef | null
  readonly createdAt: string
  /** Whole replacement rows, matched to the base rows by task type. */
  readonly changes?: readonly Route[]
  readonly coordinator?: Coordinator
  readonly validation?: ValidationPolicy
}

/**
 * The candidate for the next version: the base policy with replacements applied. It copies the policy
 * fields only, so version-level provenance text never leaks from one version into the next.
 * The caller validates the result; nothing here accepts or writes it.
 */
export function deriveRoutingTable(base: RoutingTable, input: DerivationInput): RoutingTable {
  const replacements = new Map((input.changes ?? []).map((route) => [route.task_type, route]))
  return {
    schema_version: base.schema_version,
    table_version: input.tableVersion,
    taxonomy_version: base.taxonomy_version,
    source: input.source,
    based_on: input.basedOn,
    created_at: input.createdAt,
    coordinator: input.coordinator ?? base.coordinator,
    routes: base.routes.map((route) => replacements.get(route.task_type) ?? route),
    validation: input.validation ?? base.validation
  }
}
