// The portal invitation, as outbox rows. SPK-06.
//
// Pure, and separate from the action for the reason `decision-outbox.ts` is separate from
// `decisions.ts`: the rules worth testing here are which body was used, what the key is,
// and who gets skipped, and none of those should need a base to assert.
//
// Nothing sends inline. This builds rows and returns; `features/comms/drain.ts` is still
// the only thing that talks to the provider. BUILD_SPEC 5.3.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { emailHtmlFromMarkdown } from '@/features/comms/markdown-email'
import { type CodeTemplate, resolveTemplate } from '@/features/comms/resolve-template'
import { SPEAKER_TEMPLATES, TEMPLATE_KEYS } from '@/features/comms/template-keys'
import { idempotencyKeys, type OutboxDraft } from '@/features/comms/triggers'
import type { EmailTemplate, RecordId } from '@/types/domain'

/**
 * The built-in body, converted once at module scope.
 *
 * Read out of `SPEAKER_TEMPLATES` rather than written here, which is what makes the
 * template editable: Settings > Email Templates prefills its box with the same string, so
 * an organizer is editing the email their speakers actually receive. A second copy would
 * drift and nothing would report it.
 */
const INVITE = builtIn()

function builtIn(): CodeTemplate {
  const meta = SPEAKER_TEMPLATES.find((entry) => entry.key === TEMPLATE_KEYS.speakerInvite)
  if (meta === undefined) {
    throw new AppError(ErrorIds.MAIL_TEMPLATE_MISSING, 'no built-in portal invitation body', {
      key: TEMPLATE_KEYS.speakerInvite,
    })
  }
  return {
    subject: meta.defaultSubject,
    html: emailHtmlFromMarkdown(meta.defaultBody),
    attachIcs: false,
  }
}

export type InviteRecipient = {
  readonly speakerId: RecordId
  readonly email: string
  readonly firstName: string
  readonly lastName: string
  /**
   * What is currently stored on the row, or `undefined` for somebody never invited. This,
   * not the instant being written, discriminates the key: see `idempotencyKeys.speakerInvite`.
   */
  readonly invitedAt?: string
}

export type InviteEnqueueInput = {
  readonly eventId: RecordId
  readonly eventName: string
  readonly eventSlug: string
  readonly recipients: readonly InviteRecipient[]
  /** The instant this press will stamp. Used for `sendAt`, never for the key. */
  readonly invitedAt: string
  readonly portalUrl: string
  /** The event's `custom-speaker-invite` row, when it has one. */
  readonly template?: EmailTemplate
}

/**
 * What to call the recipient, never an empty string.
 *
 * The same degradation `decision-outbox.ts` applies, and for the same defect: a speaker
 * with no first name would otherwise fail the render with MAIL_MERGE_FIELD_UNKNOWN and take
 * the whole batch down. It matters more here than there, because a roster imported from a
 * spreadsheet of addresses is the ordinary case for an invitation and half of it may have
 * no name at all.
 */
function greetingName(recipient: InviteRecipient): string {
  const first = recipient.firstName.trim()
  if (first !== '') return first
  const last = recipient.lastName.trim()
  if (last !== '') return last
  return 'there'
}

/**
 * One row per speaker with an address.
 *
 * Someone with no email is SKIPPED rather than failing the batch. A roster carries people
 * an organizer added by name alone, and refusing to invite the other thirty-nine because of
 * one of them is not the behaviour an organizer wants from a bulk control. The action
 * reports the count, so the skip is visible rather than silent.
 */
export function inviteOutboxRows(input: InviteEnqueueInput): readonly OutboxDraft[] {
  const seen = new Set<string>()

  return input.recipients.flatMap((recipient) => {
    const email = recipient.email.trim().toLowerCase()
    if (email === '' || seen.has(email)) return []
    seen.add(email)

    const resolved = resolveTemplate({
      stored: input.template,
      fallback: INVITE,
      context: {
        speaker: {
          firstName: greetingName(recipient),
          lastName: recipient.lastName,
          email: recipient.email,
        },
        event: { name: input.eventName, slug: input.eventSlug },
        // Deliberately no `submission`: an invitation goes to the roster, and half of it may
        // never have submitted anything. A body naming one would throw for those people.
        portalUrl: input.portalUrl,
      },
    })

    return [
      {
        eventId: input.eventId,
        kind: 'speaker.invite' as const,
        toEmail: recipient.email,
        idempotencyKey: idempotencyKeys.speakerInvite(
          recipient.speakerId,
          recipient.invitedAt ?? 'first',
        ),
        templateSource: resolved.templateSource,
        ...(resolved.templateId === undefined ? {} : { templateId: resolved.templateId }),
        speakerId: recipient.speakerId,
        sendAt: input.invitedAt,
        payload: resolved.payload,
      },
    ]
  })
}
