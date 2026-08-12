// The Submission Forms list, as data: one row per form card, plus the search, tab and
// sort behaviour behind the controls above them.
//
// Pure and separate from the card component because the counts are the part that is
// easy to get subtly wrong and impossible to see: the bubble is PENDING submissions,
// the first stat is TOTAL submissions, and the second is drafts. Three numbers off one
// list, and a card that shows the same number three times looks plausible.

import type { Submission } from '@/types/domain'
import type { Form } from '@/types/forms'
import { type FormPublicState, formPublicState } from '@/types/forms'

export const FORM_SORTS = ['pending', 'name', 'submissions'] as const
export type FormSort = (typeof FORM_SORTS)[number]

/**
 * Verbatim off the sort dropdown, which opens on "Most Pending". A Map rather than a
 * Record so reading one with a variable key is not a dynamic object index.
 */
export const FORM_SORT_LABELS: ReadonlyMap<FormSort, string> = new Map([
  ['pending', 'Most Pending'],
  ['name', 'Name'],
  ['submissions', 'Most Submissions'],
])

export const FORM_TABS = ['all', 'open', 'closed'] as const
export type FormTab = (typeof FORM_TABS)[number]

export type FormCardRow = {
  id: string
  name: string
  publicId: string
  state: FormPublicState
  participantsEnabled: boolean
  entityKind: Form['entityKind']
  /** The count bubble on the left of the card. */
  pending: number
  submissions: number
  drafts: number
  /** Pre-formatted "Closes Sep 15, 2026", absent when the form has no deadline. */
  closesLine?: string
}

export function formCardRows(input: {
  forms: readonly Form[]
  submissions: readonly Pick<Submission, 'formId' | 'status'>[]
  now: Date
  timeZone: string
}): readonly FormCardRow[] {
  return input.forms.map((form) => {
    const own = input.submissions.filter((row) => row.formId === form.id)
    return {
      id: form.id,
      name: form.name,
      publicId: form.publicId,
      state: formPublicState(form, input.now),
      participantsEnabled: form.participantsEnabled,
      entityKind: form.entityKind,
      pending: own.filter((row) => row.status === 'pending').length,
      submissions: own.filter((row) => row.status !== 'draft').length,
      drafts: own.filter((row) => row.status === 'draft').length,
      closesLine:
        form.closeDate === undefined ? undefined : closesLine(form.closeDate, input.timeZone),
    }
  })
}

/**
 * Tab counts, off the same rows the tabs filter. Computed rather than passed, so the
 * number on a tab and the number of cards behind it cannot disagree.
 *
 * A draft form counts as neither Open nor Closed. The product's tabs are the public
 * states and a draft has no public state, which is exactly the conflation the
 * `FormPublicState` comment warns about.
 */
export function formTabCounts(rows: readonly FormCardRow[]): ReadonlyMap<FormTab, number> {
  return new Map([
    ['all', rows.length],
    ['open', rows.filter((row) => row.state === 'open').length],
    ['closed', rows.filter((row) => row.state === 'closed').length],
  ])
}

export function filterForms(
  rows: readonly FormCardRow[],
  input: { search: string; tab: FormTab },
): readonly FormCardRow[] {
  const needle = input.search.trim().toLowerCase()
  return rows.filter((row) => {
    if (input.tab !== 'all' && row.state !== input.tab) return false
    return needle.length === 0 || row.name.toLowerCase().includes(needle)
  })
}

export function sortForms(rows: readonly FormCardRow[], sort: FormSort): readonly FormCardRow[] {
  const byName = (left: FormCardRow, right: FormCardRow): number =>
    left.name.localeCompare(right.name)
  const count = (row: FormCardRow): number => (sort === 'pending' ? row.pending : row.submissions)
  return [...rows].sort((left, right) => {
    if (sort === 'name') return byName(left, right)
    // Name is the tie-break on both count sorts, so the order is stable rather than
    // whatever Airtable happened to return.
    return count(right) - count(left) || byName(left, right)
  })
}

function closesLine(iso: string, timeZone: string): string {
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return ''
  const formatted = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone,
  }).format(parsed)
  return `Closes ${formatted}`
}
