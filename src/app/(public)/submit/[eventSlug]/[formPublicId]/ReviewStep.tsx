'use client'

// Step 5: the recap, then submit.
//
// It shows the answers to the questions that are VISIBLE right now, which is the same
// set the server will keep: `sanitizeAnswers` strips hidden answers before anything is
// stored, so recapping a stale conditional answer would promise to store something the
// submit then discards.

import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { PARTICIPANT_ROLE_LABELS, type ParticipantRole } from '@/constants/status'
import { answerLabels, visibleFields } from '@/features/forms/logic'
import type { PublicForm } from '@/features/submissions/public-form'
import { answeredSummary, participantAnswers } from '@/features/submissions/wizard-gating'
import type { WizardParticipant, WizardState } from '@/features/submissions/wizard-state'
import { htmlToText } from '@/utils/html-text'

const ROLE_LABELS: ReadonlyMap<ParticipantRole, string> = new Map(
  Object.entries(PARTICIPANT_ROLE_LABELS).map(([role, label]) => [role as ParticipantRole, label]),
)

type OptionCarrier = { readonly options?: readonly { readonly value: string; label: string }[] }

/**
 * Field id to the field's own option list, so the recap can print the label a speaker
 * picked rather than the value that gets stored.
 *
 * `answeredSummary` deliberately narrows a field to `{ id, label }`, so the options have
 * to be carried alongside rather than threaded through it. Without this the recap read
 * `Format: workshop` and `Tags: recAj3y7ITWrXBvUD` back at the person who had just chosen
 * "Workshop (90 min)" and two named tags.
 */
function optionIndex(fields: readonly ({ id: string } & OptionCarrier)[]) {
  return new Map(fields.map((field) => [field.id, { options: field.options }]))
}

/**
 * Which fields store MARKUP, so the recap can flatten them instead of printing their tags.
 *
 * A `wysiwyg` answer is HTML, and this step printed it verbatim: the submitter's last look
 * at their own proposal before sending it read `<p>Our monorepo CI took 40 minutes...</p>`.
 *
 * FLATTENED rather than rendered, unlike the public embeds, and the difference is not an
 * inconsistency. This is a recap, so text is the right register, and it is the same
 * treatment the organizer and reviewer surfaces give the same answer. The stronger reason
 * is that it could not be rendered safely here even if it should be: this is a client
 * component holding a value the speaker is still typing, so it has never been through
 * `safeRichHtml`, and calling that here would ship the parser into the public wizard's
 * chunk. The container already sets `whitespace-pre-wrap`, so the paragraph breaks
 * `htmlToText` leaves behind survive.
 */
function markupFieldIds(fields: readonly { id: string; type: string }[]): ReadonlySet<string> {
  return new Set(fields.filter((field) => field.type === 'wysiwyg').map((field) => field.id))
}

function recapValue(text: string, isMarkup: boolean): string {
  return isMarkup ? htmlToText(text) : text
}

export function ReviewStep({ form, state }: { form: PublicForm; state: WizardState }) {
  const visible = visibleFields(form.fields, state.answers)
  const answers = answeredSummary(
    form.fields.map((field) => ({ id: field.id, label: field.label })),
    state.answers,
    visible,
  )
  const optionsById = optionIndex(form.fields)
  const markup = markupFieldIds(form.fields)

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold">Review</h2>
        <p className="text-sm text-muted-foreground">
          {form.entityKind === 'sessions'
            ? 'Check everything over. Your session is confirmed as soon as you submit.'
            : 'Check everything over. You can follow the status of your submission in your speaker portal.'}
        </p>
      </div>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Submitted by</h3>
        <p className="text-sm">
          {`${state.firstName} ${state.lastName}`.trim()}
          {state.email.length === 0 ? '' : ` (${state.email})`}
        </p>
      </section>

      <Separator />

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">Submission</h3>
        {answers.length === 0 ? (
          <p className="text-sm text-muted-foreground">No answers yet.</p>
        ) : null}
        {answers.map((answer) => (
          <div key={answer.id} className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">{answer.label}</span>
            <span className="text-sm break-words whitespace-pre-wrap">
              {recapValue(
                answerLabels(optionsById.get(answer.id) ?? {}, answer.value).join(', '),
                markup.has(answer.id),
              )}
            </span>
          </div>
        ))}
      </section>

      {form.participantsEnabled ? (
        <>
          <Separator />
          <section className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold">
              {`Participants (${state.participants.length})`}
            </h3>
            {state.participants.map((participant) => (
              <ParticipantRecap key={participant.key} form={form} participant={participant} />
            ))}
          </section>
        </>
      ) : null}
    </div>
  )
}

function ParticipantRecap({
  form,
  participant,
}: {
  form: PublicForm
  participant: WizardParticipant
}) {
  const answers = participantAnswers(form, participant)
  const visible = visibleFields(form.participantFields, answers)
  const summary = answeredSummary(
    form.participantFields.map((field) => ({ id: field.id, label: field.label })),
    answers,
    visible,
  )
  const name = `${participant.firstName} ${participant.lastName}`.trim()
  const optionsById = optionIndex(form.participantFields)
  // A participant's Biography is a `wysiwyg` question too, so the recap of it had the same
  // defect as the abstract above.
  const markup = markupFieldIds(form.participantFields)

  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{name.length === 0 ? participant.email : name}</span>
        <Badge variant="secondary">{ROLE_LABELS.get(participant.role) ?? participant.role}</Badge>
        {participant.isPrimary ? <Badge>Primary</Badge> : null}
      </div>
      <span className="text-xs text-muted-foreground">{participant.email}</span>
      {summary.map((entry) => (
        <div key={entry.id} className="mt-1 flex flex-col gap-0.5">
          <span className="text-xs text-muted-foreground">{entry.label}</span>
          <span className="text-sm break-words whitespace-pre-wrap">
            {recapValue(
              answerLabels(optionsById.get(entry.id) ?? {}, entry.value).join(', '),
              markup.has(entry.id),
            )}
          </span>
        </div>
      ))}
    </div>
  )
}
