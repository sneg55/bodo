'use server'

// The R8 writes, and every one of them authorizes for itself.
//
// The order below is the security property, not a style, and it is the same order the
// portal's own actions use (@/features/portal/actions):
//
//   1. `requireEventRole(eventId, 'admin')`. Capability comes from EventMemberships on
//      every call, never from the session cookie, so removing somebody from the event
//      takes effect on their next request rather than when a 30 day token expires.
//   2. Load the record and check it belongs to THAT event. An admin of event A must not be
//      able to edit event B's page by posting B's record id to A's action.
//   3. Validate the posted values (./form).
//   4. Write, and let the DAL expire `event:{id}:resources`.
//
// Step 1 is here and not only in `(admin)/admin/[eventId]/layout.tsx` because a Server
// Action is reachable by POST without any layout ever rendering (BUILD_SPEC 4). Step 2
// matters more than usual for this feature: `embedHtml` is unsanitized markup that gets
// rendered to speakers, so "who may write it" is the only thing between an organizer's
// embed and a stranger's.
//
// A reviewer is refused. `EVENT_ROLES` is `admin | reviewer`, and publishing a page to
// every speaker at the conference is not a review capability.

import { AppError, ErrorIds, isAppError } from '@/constants/errorIds'
import { requireEventRole } from '@/features/auth/wiring'
import { parseResourceForm, resolveSlug } from '@/features/resources/form'
import {
  createResource,
  deleteResource,
  setResourcePublication,
  updateResource,
} from '@/services/airtable/mutations-resources'
import { getResource, listResourceSlugs } from '@/services/airtable/reads-resources'
import type { ResourceEdit } from '@/services/airtable/to-fields-resources'
import type { Resource } from '@/types/resources'

/** What a form action hands back to the client component that called it. */
export type ResourceActionResult =
  | { ok: true; message: string; resourceId: string; slug: string }
  | { ok: false; message: string }

const SAVED = 'Your changes have been saved.'

export async function saveResourceAction(
  eventId: string,
  resourceId: string | undefined,
  formData: FormData,
): Promise<ResourceActionResult> {
  try {
    await requireEventRole(eventId, 'admin')

    // The existing row is read FIRST, so its event link is checked before anything is
    // written and before its own slug is excluded from the collision set.
    const existing = resourceId === undefined ? undefined : await ownedResource(eventId, resourceId)

    const parsed = parseResourceForm({
      title: field(formData, 'title'),
      slug: field(formData, 'slug'),
      bodyMarkdown: field(formData, 'bodyMarkdown'),
      embedHtml: field(formData, 'embedHtml'),
      visibility: field(formData, 'visibility'),
      order: field(formData, 'order'),
      enabled: field(formData, 'enabled'),
    })
    if (!parsed.ok) {
      return { ok: false, message: parsed.problems.map((problem) => problem.message).join(' ') }
    }
    const { values } = parsed

    const edit: ResourceEdit = {
      title: values.title,
      slug: resolveSlug({
        desired: values.slug,
        taken: await listResourceSlugs(eventId),
        currentSlug: existing?.slug,
      }),
      bodyMarkdown: values.bodyMarkdown,
      embedHtml: values.embedHtml,
      visibility: values.visibility,
      order: values.order,
    }
    const publication = { enabled: values.enabled, order: values.order }

    if (existing === undefined) {
      const created = await createResource({ draft: { eventId, ...edit }, publication })
      return { ok: true, message: SAVED, resourceId: created.id, slug: created.slug }
    }

    await updateResource({ resourceId: existing.id, eventId, edit, publication })
    return { ok: true, message: SAVED, resourceId: existing.id, slug: edit.slug }
  } catch (error) {
    return failure(error)
  }
}

/**
 * Publish or unpublish from the list page, without opening the editor.
 *
 * A publication-only write. It used to go through `updateResource` and re-send every content
 * field it had just read, which is a lost update rather than the no-op the old comment
 * claimed: an organizer editing the page between that read and this write had their edit
 * silently reverted by somebody else pressing Publish, and embed HTML they had deliberately
 * removed came back. Found by Codex review. `setResourcePublication` still upserts a missing
 * PortalItems row, which was the only real reason to go through the content path.
 */
export async function setResourcePublishedAction(
  eventId: string,
  resourceId: string,
  enabled: boolean,
): Promise<ResourceActionResult> {
  try {
    await requireEventRole(eventId, 'admin')
    const existing = await ownedResource(eventId, resourceId)

    await setResourcePublication({
      resourceId: existing.id,
      eventId,
      publication: { enabled, order: existing.order },
    })

    return {
      ok: true,
      message: enabled ? 'The page is visible in the portal.' : 'The page is hidden from speakers.',
      resourceId: existing.id,
      slug: existing.slug,
    }
  } catch (error) {
    return failure(error)
  }
}

export async function deleteResourceAction(
  eventId: string,
  resourceId: string,
): Promise<ResourceActionResult> {
  try {
    await requireEventRole(eventId, 'admin')
    const existing = await ownedResource(eventId, resourceId)
    await deleteResource({ resourceId: existing.id, eventId })
    return {
      ok: true,
      message: 'The resource page has been deleted.',
      resourceId: existing.id,
      slug: existing.slug,
    }
  } catch (error) {
    return failure(error)
  }
}

/**
 * The record, or a refusal. Uncached read, because this is what decides the write.
 *
 * A mismatch raises `AUTH_FORBIDDEN_ROLE` rather than "not found", because that is what it
 * is: a caller who holds admin on this event and posted another event's record id.
 */
async function ownedResource(eventId: string, resourceId: string): Promise<Resource> {
  const resource = await getResource(resourceId)
  if (resource.eventId !== eventId) {
    throw new AppError(ErrorIds.AUTH_FORBIDDEN_ROLE, 'resource does not belong to event', {
      eventId,
      resourceId,
    })
  }
  return resource
}

/** A posted string, or `undefined` for absent. A file part is treated as absent. */
function field(formData: FormData, key: string): string | undefined {
  const value = formData.get(key)
  return typeof value === 'string' ? value : undefined
}

/**
 * An `AppError` carries a message written for a human, so it is shown. Anything else is a
 * genuine fault and is re-thrown, so it reaches the error boundary and the logs rather than
 * being reported to an organizer as if their input were at fault.
 */
function failure(error: unknown): ResourceActionResult {
  if (isAppError(error)) return { ok: false, message: error.message }
  throw error
}
