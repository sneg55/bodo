'use server'

// Adding, muting and deleting webhook subscriptions.
//
// All three authorize for themselves with `requireEventRole(eventId, 'admin')`. A Server
// Action is reachable by POST without any layout ever rendering, so the settings page's guard
// is not the boundary (BUILD_SPEC 4). `admin` and not a lower role, for the same reason
// minting an API token needs it: a webhook is a standing instruction to send this event's data
// to an address of the creator's choosing, which is the same reach through a different door.
//
// Two things every action here does BEFORE it writes, both explained in full on the helpers
// below and both of them silent when they are missing: it resolves the `[eventId]` ref to a
// record id (`eventRecordId`), because the raw param may be a slug and a slug builds a cache
// tag no read subscribes to; and, for the two that name a webhook, it checks the webhook is on
// THAT event (`authorizeWebhook`), because the role check authorizes the event and the DAL
// then writes by record id.
//
// **The secret is shown once, at creation, and never again.** It is stored in the clear (the
// HMAC needs the key itself, unlike an API token, which only ever needs a digest) but it is
// not returned by any read that reaches the browser: `WebhookListRow` drops it by type. So the
// created-secret dialog is the only sighting, and re-creating the subscription is the only way
// back, which is exactly what `setWebhookEnabled` exists to spare an organizer who only wants
// to mute a noisy endpoint.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { mintToken } from '@/features/api/token-rules'
import { requireEventRole } from '@/features/auth/wiring'
import { resolveEventRef } from '@/features/events/resolve-ref'
import { type ActionResult, actionFailure, actionOk } from '@/features/review/action-result'
import { WEBHOOK_EVENT_TYPES, type WebhookEventType } from '@/features/webhooks/dispatch'
import {
  createWebhook,
  deleteWebhook,
  setWebhookEnabled,
} from '@/services/airtable/mutations-webhooks'
import { getWebhookForAuthz } from '@/services/airtable/reads-webhooks'
import type { WebhookFormInput } from '@/types/webhook'

/**
 * The record id behind an `[eventId]` segment, which since the ref change may be a SLUG.
 *
 * **Resolve here, and never let the raw param reach a cache tag.** `requireEventRole` resolves
 * a slug internally for its own membership check and returns nothing, so a caller that keeps
 * the value it was handed authorizes correctly and then expires `event:<slug>:webhooks`, which
 * no read subscribes to: `listWebhooks` tags by RECORD ID (reads-webhooks.ts). The write
 * lands, the settings page keeps serving the rows from before it, and nothing throws and
 * nothing logs. This is a trap worth naming because every one of these actions takes the
 * segment straight off a client component that also uses it to build hrefs.
 *
 * A record id resolves to itself with NO read (event-ref.ts), so this is free on the common
 * path. An unresolvable ref passes through unchanged, exactly as `wiring.ts` does with one: no
 * event holds it, so no membership names it, and the role check below refuses it with the same
 * `AUTH_FORBIDDEN_ROLE` a real event the caller has no role on gets. A second failure mode
 * here would let a prober tell "no such event" apart from "not your event".
 */
async function eventRecordId(ref: string): Promise<string> {
  return (await resolveEventRef(ref)) ?? ref
}

/**
 * Authorize `admin` on the event AND confirm the webhook is one of THAT event's webhooks.
 *
 * The role check alone left a cross-event hole, because `setWebhookEnabled` and
 * `deleteWebhook` address the subscription by record id: an admin of event A who knew or
 * guessed a record id belonging to event B could mute or delete B's endpoint by POSTing A's
 * ref alongside it. A Server Action is reachable by POST without any page rendering, so the
 * settings screen only ever listing this event's rows is not a defence.
 *
 * The ownership read is UNCACHED (`getWebhookForAuthz`), because it decides whether a mutation
 * is allowed and a cached answer authorizes against an ownership that may have moved.
 *
 * "Belongs to another event" and "does not exist" refuse IDENTICALLY, same id and same
 * message, so the action cannot be used to probe the base for live record ids.
 */
async function authorizeWebhook(eventRef: string, webhookId: string): Promise<string> {
  const eventId = await eventRecordId(eventRef)
  await requireEventRole(eventId, 'admin')

  const webhook = await getWebhookForAuthz(webhookId)
  if (webhook === undefined || webhook.eventId !== eventId) {
    throw new AppError(ErrorIds.AUTH_FORBIDDEN_ROLE, 'that webhook is not on this event', {
      eventId,
    })
  }
  return eventId
}

/**
 * Add an endpoint, minting its signing secret.
 *
 * `mintToken` rather than a second CSPRNG helper next door: it is 32 bytes of
 * `crypto.getRandomValues` in URL-safe base64, which is what this needs, and its `bodo_`
 * prefix is if anything more useful here, because a webhook secret is a value an organizer
 * pastes into somebody else's config file where a secret scanner may see it.
 */
export async function createWebhookAction(
  eventRef: string,
  input: WebhookFormInput,
): Promise<ActionResult<{ secret: string }>> {
  try {
    // Resolved before anything else uses it: it is the value the `event` LINK column is
    // written with as well as the value `eventWebhooksTag` is built from, and a slug is
    // wrong for both. See `eventRecordId`.
    const eventId = await eventRecordId(eventRef)
    await requireEventRole(eventId, 'admin')

    const url = requireHttpUrl(input.url)
    const events = input.events.filter(isWebhookEventType)
    if (events.length === 0) {
      // Refused rather than defaulted to all four. A subscription with no event types is
      // silent forever, and an organizer who forgot to tick a box would find that out weeks
      // later; guessing "they meant everything" is the answer that spams a channel instead.
      throw new AppError(
        ErrorIds.DATA_WRITE_FAIL,
        'choose at least one event to send to this endpoint',
        { eventId },
      )
    }

    const secret = mintToken()
    const name = input.name.trim()
    await createWebhook({
      eventId,
      // Falls back to the host rather than to "Untitled": the primary field is what every
      // linked-record chip in the base renders, and a table of five Untitled rows names
      // nothing. The host is the part of the URL an organizer recognises, and it is also the
      // part that is not secret, which the full Discord URL very much is.
      name: name === '' ? new URL(url).hostname : name,
      url,
      secret,
      events,
      enabled: input.enabled,
    })

    return actionOk({ secret })
  } catch (error) {
    return actionFailure(error)
  }
}

export async function setWebhookEnabledAction(
  eventRef: string,
  webhookId: string,
  enabled: boolean,
): Promise<ActionResult<{ enabled: boolean }>> {
  try {
    // The RESOLVED id, both for the ownership comparison inside and for the tag the mutation
    // builds from it. Passing `eventRef` on would expire a tag nothing reads.
    const eventId = await authorizeWebhook(eventRef, webhookId)
    await setWebhookEnabled({ webhookId, eventId, enabled })
    return actionOk({ enabled })
  } catch (error) {
    return actionFailure(error)
  }
}

export async function deleteWebhookAction(
  eventRef: string,
  webhookId: string,
): Promise<ActionResult<{ deleted: true }>> {
  try {
    const eventId = await authorizeWebhook(eventRef, webhookId)
    await deleteWebhook({ webhookId, eventId })
    return actionOk({ deleted: true as const })
  } catch (error) {
    return actionFailure(error)
  }
}

const isWebhookEventType = (value: string): value is WebhookEventType =>
  WEBHOOK_EVENT_TYPES.some((type) => type === value)

/**
 * The URL, normalised, or a refusal.
 *
 * `http:` and `https:` only. Without the scheme check `URL.canParse` happily accepts
 * `javascript:`, `data:` and `file:`, and the delivery row that resulted would sit in the
 * queue burning five attempts against something `fetch` was never going to send.
 *
 * `DATA_WRITE_FAIL` because the registry has no general-purpose validation id and the SUB_*
 * family means something specific about submissions. It reads correctly at the call site: the
 * write did not happen, and the message says why.
 */
function requireHttpUrl(raw: string): string {
  const trimmed = raw.trim()
  if (!URL.canParse(trimmed)) {
    throw new AppError(ErrorIds.DATA_WRITE_FAIL, 'that is not a URL bodo can send to', {
      url: trimmed,
    })
  }
  const parsed = new URL(trimmed)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new AppError(ErrorIds.DATA_WRITE_FAIL, 'a webhook URL must start with http or https', {
      protocol: parsed.protocol,
    })
  }
  return parsed.toString()
}
