// The admin File Requests list, flattened for the client.
//
// Ref 30 captured this list EMPTY, so the tab strip and the empty state are transcribed and
// the card is not: `All Requests 0 / Contact Requests 0 / Group Requests 0 / Submission
// Requests 0` and `No file requests yet` / `Create a file request to collect documents from
// participants` are verbatim, while the card layout is taken from its captured sibling, the
// task card on ref 25 (title, a chip, a metadata row with the type icon and label). The
// parity doc's own note says the three portal collection primitives are one pattern, and
// BUILD_SPEC 5.6 says the same, so borrowing the sibling's card is a smaller invention than
// designing a second one.
//
// The type label on a card is `Session` and the tab is `Submission Requests`, for one and the
// same `entityType`. That is not an inconsistency, it is what ref 25 shows for tasks, and
// TASK_TYPE_LABELS is reused rather than a second copy declared here.
//
// Flattened rather than sending `FileRequest` across the boundary: the list is interactive
// (search, tabs, an Assign action) so it is a client component, and BUILD_SPEC 6.3 scores
// payload discipline.
//
// Pure, and tested in tests/file-requests-cards.test.ts.

import type { TaskEntityType } from '@/constants/status'
import { dedupeRequestAssignments } from '@/features/file-requests/plan'
import { formatDue } from '@/features/portal/task-view'
import { TASK_TYPE_LABELS } from '@/features/tasks/cards'
import type { FileRequestItem } from '@/services/airtable/reads-requests'
import type { RecordId } from '@/types/domain'
import type { FileRequest } from '@/types/file-requests'

export type RequestTab = 'all' | 'contact' | 'group' | 'submission'

/** Tab id, label and predicate together, so nothing looks a label up by a computed key. */
const TABS: readonly { id: RequestTab; label: string; keep: (card: RequestCardView) => boolean }[] =
  [
    { id: 'all', label: 'All Requests', keep: () => true },
    { id: 'contact', label: 'Contact Requests', keep: (card) => card.entityType === 'contact' },
    { id: 'group', label: 'Group Requests', keep: (card) => card.entityType === 'group' },
    {
      id: 'submission',
      label: 'Submission Requests',
      keep: (card) => card.entityType === 'submission',
    },
  ]

export type RequestTabView = { id: RequestTab; label: string; count: number }

export type RequestCardView = {
  id: RecordId
  title: string
  entityType: TaskEntityType
  /** `Contact` or `Session`, per ref 25's metadata row. */
  typeLabel: string
  required: boolean
  dueLabel?: string
  /** Instructions as plain text, for the one-line snippet under the title. */
  instructions?: string
  /** How far the fan-out got: distinct assignments, and how many delivered. */
  assigned: number
  received: number
}

export function toRequestCards(input: {
  requests: readonly FileRequest[]
  items: readonly FileRequestItem[]
  /** The event's timezone, so a due date reads the same here and in the portal. */
  timeZone: string
}): readonly RequestCardView[] {
  const counts = countByRequest(input.items)

  return input.requests.map((request) => {
    const tally = counts.get(request.id)
    return {
      id: request.id,
      title: request.title,
      entityType: request.entityType,
      typeLabel: TASK_TYPE_LABELS[request.entityType],
      required: request.required,
      dueLabel: formatDue(request.dueAt, input.timeZone),
      instructions: plainText(request.instructionsHtml),
      assigned: tally?.assigned ?? 0,
      received: tally?.received ?? 0,
    }
  })
}

/**
 * The instructions body as text.
 *
 * The stored value is HTML, because ref 31's Instructions control is a rich text editor. A
 * card shows a one-line snippet, and putting markup through a snippet would render tag names
 * on the card, so the tags are stripped here rather than at the component. Not a sanitizer
 * and not pretending to be one: the portal renders the real HTML, and that decision is
 * documented where it happens.
 */
function plainText(html: string | undefined): string | undefined {
  if (html === undefined) return undefined
  const text = html
    // Block ends become a space, so two paragraphs do not run into one word. Every other
    // tag goes to nothing, so `<strong>PDF</strong>.` does not become `PDF .`.
    .replace(/<\/(?:p|div|li|h[1-6]|blockquote)>|<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length === 0 ? undefined : text
}

/**
 * Assignments per request, deduplicated on the uniqueness tuple the way `deliveryRows` does,
 * so a card and the delivery table cannot disagree about how many documents one request
 * asked for.
 */
function countByRequest(
  items: readonly FileRequestItem[],
): ReadonlyMap<RecordId, { assigned: number; received: number }> {
  const counts = new Map<RecordId, { assigned: number; received: number }>()

  // Through the SHARED dedup, so the card, the delivery table and the speaker's own list
  // cannot disagree. This kept whichever row Airtable returned first, which meant the card
  // read 0/1 or 1/1 for identical data depending on row order.
  for (const item of dedupeRequestAssignments(items)) {
    const tally = counts.get(item.request.id) ?? { assigned: 0, received: 0 }
    tally.assigned += 1
    if (item.assignment.status === 'received') tally.received += 1
    counts.set(item.request.id, tally)
  }

  return counts
}

/** The tab strip with its live counts, e.g. `All Requests 3`, `Contact Requests 1`. */
export function requestTabs(cards: readonly RequestCardView[]): readonly RequestTabView[] {
  return TABS.map((tab) => ({
    id: tab.id,
    label: tab.label,
    count: cards.filter(tab.keep).length,
  }))
}

/** The search box and the tab strip, applied together. */
export function filterRequestCards(
  cards: readonly RequestCardView[],
  tab: RequestTab,
  search: string,
): readonly RequestCardView[] {
  const keep = TABS.find((candidate) => candidate.id === tab)?.keep ?? (() => true)
  const needle = search.trim().toLowerCase()

  return cards.filter((card) => {
    if (!keep(card)) return false
    if (needle.length === 0) return true
    // Title and instructions both, because the snippet is text the organizer can see on the
    // card and would therefore expect to search.
    return `${card.title} ${card.instructions ?? ''}`.toLowerCase().includes(needle)
  })
}
