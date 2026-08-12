// Step five: three tasks with their assignments, the email templates, two resources.
//
// The task fan-out is unique on (task, speaker, submission), which is what makes
// re-running it a no-op rather than a second copy of the same to-do. That tuple is
// also why the submission link is not decoration: a speaker with two accepted
// submissions needs one row per submission for a per-submission task, or completing it
// for one would mark it complete for both.
//
// Email templates carry markdown and merge fields, not rendered HTML. Rendering
// happens at enqueue and is snapshotted into `EmailOutbox.payloadJson`, so a template
// edited later cannot change mail that was already promised. No outbox rows are seeded
// for that reason: a queued row is a message about to be sent to whoever the row
// names, and a seed has no business promising one.

import { COL, TABLES } from '@/services/airtable/tables'
import { link } from '@/services/airtable/to-fields'
import { EMPTY_PORTAL_FILTERS } from '@/types/portals'
import type { Ensure, Ensured, SeedContext } from './ensure'
import { idFor } from './ensure'
import { RESOURCES, TASKS } from './scenario'
import type { Content } from './steps-content'
import type { Foundation } from './steps-foundation'
import { ACCEPTED } from './submissions-data'

/** title, entityType, origin, kind, dueAt. */
const TASK_ROWS: readonly (readonly [string, string, string, string, string | undefined])[] = [
  [TASKS.headshot, 'contact', 'automated', 'upload', '2026-09-20T23:59:00.000Z'],
  [TASKS.travel, 'contact', 'manual', 'confirm', '2026-09-25T23:59:00.000Z'],
  [TASKS.slides, 'submission', 'automated', 'upload', '2026-10-05T23:59:00.000Z'],
]

const TEMPLATES: readonly (readonly [string, string, string, boolean])[] = [
  [
    'accepted',
    'Your session was accepted for {{event.name}}',
    'Hi {{speaker.firstName}},\n\nYour session has been accepted for {{event.name}}. Everything you need is in your speaker portal: {{portalUrl}}\n',
    true,
  ],
  [
    'rejected',
    'An update on your {{event.name}} submission',
    'Hi {{speaker.firstName}},\n\nWe had far more submissions than slots this year, and yours did not make the programme. Thank you for taking the time.\n',
    false,
  ],
  [
    'reminder',
    'A task is waiting in your {{event.name}} portal',
    'Hi {{speaker.firstName}},\n\nOne of your speaker tasks is still open: {{portalUrl}}\n',
    false,
  ],
]

const RESOURCE_ROWS: readonly (readonly [string, string, string])[] = [
  [
    RESOURCES.handbook,
    'Speaker handbook',
    '## Before you arrive\n\nCheck in at the speaker desk one hour before your session. Bring your own adapter.\n\n## On stage\n\nRooms are miked. The clock on the confidence monitor is the one that counts.\n',
  ],
  [
    RESOURCES.travel,
    'Venue and travel',
    '## Getting here\n\nThe venue is a fifteen minute walk from the Montgomery BART station.\n\n## Hotels\n\nWe hold a block two streets away. Ask the speaker desk for the code.\n',
  ],
]

async function seedTasks(ensure: Ensure, foundation: Foundation): Promise<Ensured> {
  return await ensure(
    TABLES.tasks,
    [COL.event, COL.title],
    TASK_ROWS.map(([title, entityType, origin, kind, dueAt]) => ({
      [COL.title]: title,
      [COL.event]: link(foundation.eventId),
      [COL.entityType]: entityType,
      [COL.origin]: origin,
      [COL.kind]: kind,
      ...(dueAt === undefined ? {} : { [COL.dueAt]: dueAt }),
      // Automated tasks fan out on accept; the manual one an organizer assigns.
      ...(origin === 'automated' ? { [COL.appliesTo]: 'all_accepted' } : {}),
    })),
  )
}

export async function seedPortal(
  ctx: SeedContext,
  foundation: Foundation,
  content: Content,
): Promise<void> {
  const tasks = await seedTasks(ctx.ensure, foundation)
  const taskId = (title: string): string => idFor(tasks, [link(foundation.eventId), title], 'task')

  // One row per accepted submission's primary speaker. The two contact tasks are per
  // person and the slides task is per submission, which is the distinction the tuple
  // in section 3 exists to keep.
  const speakerEmails = [...new Set(ACCEPTED.map((row) => row.submitter))]
  const contactRows = speakerEmails.flatMap((email) =>
    [TASKS.headshot, TASKS.travel].map((title) => ({
      [COL.task]: link(taskId(title)),
      [COL.speaker]: link(idFor(foundation.speakers, [email], 'speaker')),
      [COL.status]: 'pending',
    })),
  )
  const submissionRows = ACCEPTED.map((row) => ({
    [COL.task]: link(taskId(TASKS.slides)),
    [COL.speaker]: link(idFor(foundation.speakers, [row.submitter], 'speaker')),
    [COL.submission]: link(
      idFor(content.submissions, [link(foundation.eventId), row.title], 'submission'),
    ),
    [COL.status]: 'pending',
  }))

  await ctx.ensure(
    TABLES.taskAssignments,
    [COL.task, COL.speaker, COL.submission],
    [...contactRows, ...submissionRows],
  )

  await ctx.ensure(
    TABLES.emailTemplates,
    [COL.event, COL.key],
    TEMPLATES.map(([key, subject, bodyMarkdown, attachIcs]) => ({
      [COL.key]: key,
      [COL.event]: link(foundation.eventId),
      [COL.subject]: subject,
      [COL.bodyMarkdown]: bodyMarkdown,
      [COL.attachIcs]: attachIcs,
    })),
  )

  const resources = await ctx.ensure(
    TABLES.resources,
    [COL.event, COL.slug],
    RESOURCE_ROWS.map(([slug, title, bodyMarkdown], index) => ({
      [COL.title]: title,
      [COL.event]: link(foundation.eventId),
      [COL.slug]: slug,
      [COL.bodyMarkdown]: bodyMarkdown,
      [COL.visibility]: 'portal',
      [COL.order]: index + 1,
    })),
  )

  const portalId = await seedDefaultPortal(ctx.ensure, foundation)
  await publishResources(ctx.ensure, foundation, portalId, resources)
}

/**
 * The PortalItems rows that make the two seeded pages VISIBLE to a speaker.
 *
 * Without these the seed writes two resources nobody can open. That is not a matter of
 * taste: a resource with no publishing row, or a disabled one, is a DRAFT
 * (`features/resources/pages.ts`), because both `visibility` values are portal-readable so
 * the row is the only "not visible yet" state the schema can express. BUILD_SPEC section 9
 * seeds "2 resource pages" so that judges "land on a system that looks alive", and two
 * pages that render nowhere are the opposite of that.
 *
 * `enabled` is written explicitly rather than left to the column default, because an
 * Airtable checkbox reads as `false` when blank and blank is exactly what "draft" means
 * here. Relying on the default would seed the bug this function exists to fix.
 *
 * Keyed on (portal, resource), which is the uniqueness BUILD_SPEC section 3 states for this
 * table since 5.0c: a page may sit on more than one portal, so the pair is the key and the
 * resource alone is not.
 */
async function publishResources(
  ensure: Ensure,
  foundation: Foundation,
  portalId: string,
  resources: Ensured,
): Promise<void> {
  await ensure(
    TABLES.portalItems,
    [COL.portal, COL.resource],
    RESOURCE_ROWS.map(([slug], index) => ({
      [COL.order]: index + 1,
      [COL.event]: link(foundation.eventId),
      [COL.portal]: link(portalId),
      [COL.itemType]: 'resource',
      [COL.resource]: link(idFor(resources, [link(foundation.eventId), slug], 'resource')),
      [COL.enabled]: true,
    })),
  )
}

/**
 * The event's default portal, without which the whole Portals feature is unusable.
 *
 * Seeded here because the seed writes its event row directly (`steps-foundation.ts`)
 * rather than through `createEventAction`, which is the only other place one is created.
 * BUILD_SPEC 5.0c requires exactly one default portal per event and says it is created
 * WITH the event, so an event that has none is not a degraded state, it is a broken one:
 * `matchPortal` returns `undefined` so every speaker has no portal, `savePortalAction`
 * refuses every save because `requireOneDefault` fails, and the organizer cannot even
 * create the portal that would fix it. On a seeded base, which is the base anybody
 * evaluating this project will use, that is the entire feature missing.
 *
 * The values match `createDefaultPortal` in `features/events/actions.ts` exactly, name
 * included, so a seeded event and a created one are indistinguishable to every read below
 * them. `filterJson` is written out rather than left blank: a blank cell means the same
 * thing through `portalFiltersSchema`'s fallback, and the default is never matched on its
 * filters anyway (`match.ts` falls back to it rather than testing it), but writing the
 * shape keeps the column readable for anyone opening the base directly.
 *
 * Keyed on (event, isDefault), so a re-run is a no-op rather than a second default. That
 * is the one outcome that would break the invariant this exists to satisfy.
 */
async function seedDefaultPortal(ensure: Ensure, foundation: Foundation): Promise<string> {
  const portals = await ensure(
    TABLES.portals,
    [COL.event, COL.isDefault],
    [
      {
        [COL.name]: 'Speaker Portal',
        [COL.event]: link(foundation.eventId),
        [COL.kind]: 'contacts',
        [COL.isDefault]: true,
        [COL.order]: 0,
        [COL.filterJson]: JSON.stringify(EMPTY_PORTAL_FILTERS),
        [COL.alwaysShowTasks]: false,
        [COL.manageProfile]: false,
      },
    ],
  )
  // `true` and not `'true'`: `keyOn` stringifies whatever the row carries, and the checkbox
  // was written as a boolean above, so the lookup has to ask with the same value it wrote.
  return idFor(portals, [link(foundation.eventId), true], 'portal')
}
