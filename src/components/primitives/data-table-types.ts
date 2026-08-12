// DataTable's contract. Kept separate from the component so the types can be
// imported by a server component that only shapes props, without pulling the
// client bundle in behind them.
//
// The table is generic over the row type and knows nothing about Airtable: column
// identity comes from the field registry (src/constants/fields.ts) and the cell
// renderer comes from the caller. That is what lets Abstracts, Sessions, Agenda
// List, and the portal admin lists share one implementation.

import type { ReactNode } from 'react'

import {
  ALL_REGISTRY_FIELDS,
  DEFAULT_COLUMN_KEYS,
  type RegistryField,
  SESSION_FIELDS,
} from '@/constants/fields'

/**
 * Which slice of the field registry one surface is built over.
 *
 * The drawer used to read `src/constants/fields.ts` directly, which was right while every
 * table on top of this primitive was a table of submissions. The speaker CRM is not: its
 * rows are people, and a Columns picker offering Room, or a Filter pane offering Track,
 * would be a control that silently does nothing, because the row model has no accessor
 * behind either. So the catalog is a prop with the old behaviour as its default.
 */
export type DataTableCatalog = {
  /** Offered in the Columns picker, and the source of every header label and tooltip. */
  fields: readonly RegistryField[]
  /**
   * Offered in the Sort and Filter panes. Separate from `fields` because a surface that
   * queries in memory (the CRM) can order by a derived column, while one that queries
   * through Airtable (Abstracts) can only order by a real one.
   */
  queryableFields: readonly RegistryField[]
  /** What the drawer's "Reset to Default" restores. */
  defaultColumnKeys: readonly string[]
}

/** The submission catalog: what every table on this primitive used before it was a prop. */
export const SESSION_CATALOG: DataTableCatalog = {
  fields: SESSION_FIELDS,
  queryableFields: ALL_REGISTRY_FIELDS.filter((field) => field.column),
  defaultColumnKeys: DEFAULT_COLUMN_KEYS,
}

export type DataTableColumn<TRow> = {
  /** A key from src/constants/fields.ts, which supplies the label, type, and help. */
  key: string
  cell: (row: TRow) => ReactNode
  /**
   * Only for a column the registry cannot name, such as the per-plan
   * "Ratings: <plan name>" column the audit found. Otherwise leave it unset so
   * the registry stays the single source of the label.
   */
  label?: string
  /**
   * Info tooltip copy for a column the registry cannot name, alongside `label`.
   *
   * The registry's own `help` is the source for every registry column, and a surface may
   * not override it. This exists so the columns the registry has no entry for (Session
   * Submitter and Speaker, which describe a submission's cast rather than one field) can
   * still carry the tooltip icon the audit requires on EVERY header.
   */
  help?: string
  headerClassName?: string
  cellClassName?: string
}

/** Status tabs with live counts, e.g. `All Abstracts 2`, `Pending 2`. */
export type DataTableTab = { id: string; label: string; count: number }

export const DATA_TABLE_DENSITIES = ['compact', 'default', 'relaxed'] as const
export type DataTableDensity = (typeof DATA_TABLE_DENSITIES)[number]

export const DATA_TABLE_DENSITY_LABELS: readonly { density: DataTableDensity; label: string }[] = [
  { density: 'compact', label: 'Compact' },
  { density: 'default', label: 'Default' },
  { density: 'relaxed', label: 'Relaxed' },
]

/** The product's default, and the value the footer's "Show:" control starts on. */
export const DEFAULT_PAGE_SIZE = 25
export const PAGE_SIZE_OPTIONS: readonly number[] = [25, 50, 100]

export type DataTableSort = { key: string; direction: 'asc' | 'desc' }

export const FILTER_OPERATORS = ['is', 'is_not', 'contains', 'is_empty', 'is_not_empty'] as const
export type FilterOperator = (typeof FILTER_OPERATORS)[number]

export const FILTER_OPERATOR_LABELS: readonly { operator: FilterOperator; label: string }[] = [
  { operator: 'is', label: 'is' },
  { operator: 'is_not', label: 'is not' },
  { operator: 'contains', label: 'contains' },
  { operator: 'is_empty', label: 'is empty' },
  { operator: 'is_not_empty', label: 'is not empty' },
]

/** Operators that take no operand, so the value input is hidden for them. */
export const UNARY_FILTER_OPERATORS: readonly FilterOperator[] = ['is_empty', 'is_not_empty']

export type DataTableFilter = {
  id: string
  key: string
  operator: FilterOperator
  value: string
}

/** The Fields / Reporting Fields toggle pills in the preferences drawer. */
export type FieldPill = 'fields' | 'reporting'

/**
 * Everything the Preferences drawer edits, committed as one object when Apply
 * Changes is pressed. Nothing takes effect before that, which is the behaviour the
 * audit inferred from the presence of an explicit commit button.
 */
export type DataTablePreferences = {
  columnKeys: readonly string[]
  sort: DataTableSort | null
  filters: readonly DataTableFilter[]
}

export const PREFERENCE_TABS = ['columns', 'sort', 'filter'] as const
export type PreferenceTab = (typeof PREFERENCE_TABS)[number]
