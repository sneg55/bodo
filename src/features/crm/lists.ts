// Dynamic speaker lists, as rules rather than as a screen.
//
// Everything the saved-list control decides is here: whether a name is usable, which lists
// a caller may see, whether a caller may WRITE one, the order they appear in, and what a
// stored filter set narrows to before it is serialized. None of it touches Airtable, React
// or the clock, which is why it is unit tested (tests/crm-lists.test.ts) rather than
// debugged through the dropdown.
//
// Sibling of `features/views/saved-view-model.ts`, deliberately not a generalization of it.
// A saved view stores three things (columns, sort, filters) and is event-scoped with a
// per-surface default; a speaker list stores one thing (filters), is cross-event, and is
// shareable instead of defaultable. Folding them together would be one module with two
// halves that are never both true. The one rule they genuinely share, "a filter's id is
// positional and nothing persists it", is restated below because both codecs already state
// it (`directory-query.ts`, `abstracts-query.ts`) and neither imports the other.

import {
  type DataTableFilter,
  FILTER_OPERATORS,
  type FilterOperator,
} from '@/components/primitives/data-table-types'
import type { RecordId, SpeakerList } from '@/types/domain'

/**
 * The longest name a list may carry.
 *
 * 255 rather than a shorter product limit: it is what an Airtable single-line text cell
 * takes, and the name is rendered in a dropdown that truncates anyway, so a lower ceiling
 * would reject input the store accepts for no gain.
 */
export const SPEAKER_LIST_NAME_MAX = 255

/**
 * How many filters one list may store.
 *
 * A ceiling rather than a guess, and the same one saved views use: the filters cross a
 * Server Action boundary as client input and end up in a long-text cell that a later read
 * parses back with Zod, so an unbounded array is a write anybody can make arbitrarily
 * large. The CRM catalog holds a couple of dozen queryable fields, so fifty filters is
 * already far past anything an organizer composed by hand.
 */
const MAX_FILTERS = 50

function normalized(name: string): string {
  return name.trim().toLocaleLowerCase()
}

/**
 * Why a name cannot be used, or that it can.
 *
 * A result object rather than a boolean, because the same check runs twice: once in the
 * dialog so the organizer is told before pressing Save, and once in the Server Action,
 * because a name validated in the browser only is a name anybody can POST around.
 * `currentId` is the list being renamed, which must be allowed to keep its own name.
 *
 * The duplicate check runs against whatever list the caller passes, which is the VISIBLE
 * set: two organizers may each own a private list called "Keynotes" without either one
 * being told the other exists, and a shared list clashes with everything because everybody
 * can see it.
 */
export function checkListName(
  name: string,
  existing: readonly SpeakerList[],
  currentId?: string,
): { ok: true } | { ok: false; reason: string } {
  const trimmed = name.trim()
  if (trimmed.length === 0) return { ok: false, reason: 'Enter a name for this list.' }
  if (trimmed.length > SPEAKER_LIST_NAME_MAX) return { ok: false, reason: 'That name is too long.' }

  const clash = existing.some(
    (list) => list.id !== currentId && normalized(list.name) === normalized(trimmed),
  )
  return clash ? { ok: false, reason: 'A list called that already exists.' } : { ok: true }
}

/**
 * The lists one caller may READ: their own, plus every shared one.
 *
 * THE one place this rule runs. `listSpeakerLists` (reads-crm.ts) calls it at the read
 * boundary, where it has to, or the cache would hold other organizers' private rows; every
 * caller above that gets an already-filtered list and re-applying it there could not change
 * an outcome. It used to be applied three more times in the feature layer, which meant the
 * copy with the test was the copy that never mattered.
 *
 * Order is preserved rather than sorted. Ordering is a presentation decision and belongs to
 * `sortSpeakerLists`, so a caller that wants the reader's order can have it.
 *
 * A list with no `ownerId` at all is visible only if it is shared. The owner link is
 * `optionalLink` in the mapper, so an ownerless row is reachable (created in Airtable by
 * hand), and treating it as everybody's would make it everybody's private list.
 */
export function visibleLists(
  lists: readonly SpeakerList[],
  userId: RecordId,
): readonly SpeakerList[] {
  return lists.filter((list) => list.isShared || list.ownerId === userId)
}

/**
 * A LIST IS A FILTER SET, so a list that stores no filters is not a list.
 *
 * This is the rule the rest of the module is written against, and it is stated here because
 * leaving it implicit produced a real defect. `showingList` compared lengths and then ran
 * `every`, both of which say yes for two empty arrays, so an empty stored set matched the
 * unfiltered directory: on a plain `/admin/crm` the first zero-filter list was silently
 * selected, which armed `Delete list`, `Rename list...` and `Update with current filters`
 * against a list the organizer had never picked, on the first screen they land on. Picking
 * `All speakers` could not escape it either, because that applies the empty set, which
 * matched again.
 *
 * Where the rule is enforced, and what each one actually does:
 *   - `checkListFilters` refuses to CREATE one, in the dialog and again in the action. This
 *     is the one that stops new rows existing.
 *   - `usableLists` keeps one out of the apply path: the picker's radio group and the
 *     sidebar's list section. This is the one that makes an existing row harmless.
 *   - `showingList` never reports one as applied. At the only production call site this is
 *     REDUNDANT with `usableLists`, which the picker runs first, and it is kept anyway: the
 *     definition of "the table is showing this list" should be right on its own rather than
 *     because of the order two functions happen to be called in, and it is what the
 *     regression test pins. It is a correct definition, not an independent door.
 *
 * A stored row can reach zero filters two ways, and the second one matters more than it
 * first appeared. `speakerListFilters` (mapping-crm.ts) degrades an unparseable
 * `definitionJson` cell to `[]` rather than failing the read, and `sanitizeListFilters`
 * drops entries whose key is blank or whose operator left `FILTER_OPERATORS`. But the build
 * BEFORE this rule created such rows straight from `Save current filters...` on an
 * unfiltered table, which was the reported defect, so any base that build wrote against can
 * already hold them without anyone having hand-edited anything.
 *
 * That is why they are not hidden outright. `SpeakerListPicker` lists an owner's empty rows
 * under `Empty lists` for the one operation that needs no filters, deleting them, and
 * `SaveSpeakerListDialog` is handed the FULL visible set so an invisible row cannot reserve
 * a name the organizer is then refused.
 */
export function hasFilters(list: SpeakerList): boolean {
  return checkListFilters(list.filters).ok
}

/** The lists a picker may APPLY: the visible ones that actually store something. */
export function usableLists(lists: readonly SpeakerList[]): readonly SpeakerList[] {
  return lists.filter(hasFilters)
}

/**
 * Why this filter set cannot be saved as a list, or that it can.
 *
 * Runs in the dialog so the organizer is told before pressing Save, and again in the Server
 * Action, because a check that lives only in the browser is a check anybody can POST past.
 * The message names the fix rather than the fault: an organizer looking at an unfiltered
 * table does not know that Save is refusing them for want of a filter.
 *
 * The single spelling of "stores something", which `hasFilters` defers to rather than
 * repeating. Two copies of `sanitizeListFilters(x).length > 0` in one file is the
 * `visibleLists` problem in miniature: they agree until one of them is edited.
 */
export function checkListFilters(
  filters: readonly DataTableFilter[],
): { ok: true } | { ok: false; reason: string } {
  if (sanitizeListFilters(filters).length > 0) return { ok: true }
  return { ok: false, reason: 'Add at least one filter before saving this as a list.' }
}

/**
 * The list `listId` names, but only if `userId` OWNS it. Otherwise `undefined`.
 *
 * This is the authorization rule for every WRITE, and it is deliberately stricter than
 * `visibleLists`. A shared list is a gift from the organizer who made it: if any member of
 * the CRM could rename or delete it, sharing a list would mean giving it away, and the one
 * thing an organizer will do with a shared list is stop trusting it. So sharing grants READ
 * and nothing else, and the owner stays the only writer.
 *
 * It also keeps invalidation honest. `deleteSpeakerList` and `saveSpeakerList` both expire
 * `userSpeakerListsTag(ownerId)`, so a write performed by somebody other than the owner
 * would have to name a tag the writer cannot know is right; the owner's own cached view
 * would keep showing a row that no longer exists. Passing the CALLER's id to make the types
 * line up is exactly the bug `deleteSpeakerList`'s doc comment warns about.
 *
 * An ownerless row is owned by nobody and therefore writable by nobody. That is a
 * deliberately safe answer rather than a complete one; see the task report.
 *
 * The return type NARROWS `ownerId` to present, and that is load-bearing rather than tidy.
 * `deleteSpeakerList(origin, listId, ownerId)` takes the owner's id to name the cache tag to
 * expire, and its own doc warns that passing the caller's id instead is a bug. With
 * `SpeakerList` returned whole, the delete action needed `list.ownerId ?? scope.userId` to
 * compile: the caller's id, sitting two lines under the comment explaining why the caller's
 * id must never go there. Narrowing here deletes the fallback and the temptation with it.
 */
export type OwnedSpeakerList = SpeakerList & { ownerId: RecordId }

export function ownedList(
  lists: readonly SpeakerList[],
  listId: string,
  userId: RecordId,
): OwnedSpeakerList | undefined {
  return lists.find(
    (list): list is OwnedSpeakerList =>
      list.id === listId && list.ownerId !== undefined && list.ownerId === userId,
  )
}

/** By name, case insensitively, so the picker's order does not depend on Airtable's. */
export function sortSpeakerLists(lists: readonly SpeakerList[]): readonly SpeakerList[] {
  return [...lists].sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }),
  )
}

function isOperator(operator: string): operator is FilterOperator {
  return FILTER_OPERATORS.some((candidate) => candidate === operator)
}

/**
 * Structural sanitation for a filter set arriving from the browser.
 *
 * A Server Action is a POST endpoint anybody can call, so the array is narrowed before it
 * is serialized into a cell. Ids are renumbered rather than trusted: they are positional
 * and nothing persists them, so accepting the client's would store noise that the read
 * boundary (`speakerListFilters` in mapping-crm.ts) parses back and the URL codec throws
 * away again.
 *
 * The KEYS are not checked against the CRM catalog, on purpose and for the reason
 * `sanitizeSavedViewState` gives: `parseCrmQuery` already drops a filter on a key the
 * catalog does not offer, and the query engine already ignores a filter it cannot evaluate
 * rather than hiding every row (`table-query.ts`). Checking here would only add a second
 * place for the two to disagree.
 */
export function sanitizeListFilters(
  filters: readonly DataTableFilter[],
): readonly DataTableFilter[] {
  return filters
    .filter((filter) => filter.key.length > 0 && isOperator(filter.operator))
    .slice(0, MAX_FILTERS)
    .map((filter, index) => ({
      id: `f${String(index)}`,
      key: filter.key,
      operator: filter.operator,
      value: filter.value,
    }))
}

/**
 * The filters applying a list puts into the URL.
 *
 * The same renumbering, run on the way OUT as well as on the way in, because a row written
 * before this module existed (or edited in Airtable) can still carry any ids at all. `f{n}`
 * is the id shape `parseCrmQuery` hands back for a filter it parsed out of the address bar,
 * so a list that has just been applied compares equal to the query state it produced, which
 * is what lets the picker show which list the table is currently showing.
 */
export function applySpeakerList(list: SpeakerList): readonly DataTableFilter[] {
  return sanitizeListFilters(list.filters)
}

/**
 * Whether the table is currently showing exactly what `list` stores.
 *
 * Ignores filter ids, for the reason above, and compares in order: filters are evaluated as
 * a list and a reader reads them top to bottom, so two sets in different orders are two
 * different lists as far as the person looking at them is concerned.
 *
 * AN EMPTY STORED SET IS NEVER "SHOWING", and that early return is the fix, not a
 * micro-optimisation. Without it `0 !== 0` is false and `[].every(...)` is vacuously true,
 * so a zero-filter list matched the unfiltered directory and captured the default view. See
 * `hasFilters` for the whole story.
 */
export function showingList(list: SpeakerList, filters: readonly DataTableFilter[]): boolean {
  const stored = applySpeakerList(list)
  if (stored.length === 0) return false
  if (stored.length !== filters.length) return false
  return stored.every((filter, index) => {
    const other = filters.at(index)
    return (
      other !== undefined &&
      other.key === filter.key &&
      other.operator === filter.operator &&
      other.value === filter.value
    )
  })
}
