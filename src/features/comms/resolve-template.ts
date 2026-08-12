// Which body a trigger sends: the organizer's stored template, or the one in the code.
//
// This is the function BUILD_SPEC 5.3 assumed existed. Until now `EmailTemplates` had no
// DAL reader, so every system email body was a template in code and every outbox row was
// stamped `templateSource: 'system'` (the comment saying so is still at the top of
// decision-outbox.ts and reminders.ts). This is the other half.
//
// Three rules, and the third is the one that makes a template editor trustworthy:
//
//   1. A stored row WINS. That is the entire point of the editor: what an organizer typed
//      is what goes out, and the code default is a fallback rather than a floor.
//   2. A stored row with an EMPTY body does not win. Airtable's `+` makes blank rows, an
//      organizer clears an editor to go back to the built-in text, and a half-written row
//      is a normal state of an authoring surface. None of those should mail a blank page,
//      so a blank body reads as "no template" and the code default sends.
//   3. `templateSource` says which of the two actually happened, per row, and it is stamped
//      from the same decision that chose the body rather than passed in alongside it. A
//      label a caller sets by hand is a label that disagrees with the mail: the Comms log
//      would claim a template was used for a row whose body came from the code, and the
//      first thing an organizer does when an email reads wrong is check which body it was.
//
// Pure, and dependency-free apart from the two renderers, so every one of those rules is
// tested directly (tests/comms-template-resolution.test.ts) rather than through a sweep.

import { emailHtmlFromMarkdown } from '@/features/comms/markdown-email'
import { type MergeContext, renderSubject, renderTemplate } from '@/features/comms/templates'
import type { EmailTemplate, OutboxPayload, RecordId } from '@/types/domain'

/**
 * The body a trigger ships with, already HTML.
 *
 * HTML rather than markdown because that is what the existing defaults are, and they stay
 * that way: `reminders.ts` builds its default around an interpolated offset label, and
 * round-tripping those strings through a markdown parser to get back the HTML they already
 * are would be a conversion with no reader.
 *
 * `subject` may carry merge fields, like a stored one. Both go through `renderSubject`, so
 * there is one subject code path rather than "the stored one interpolates and the built-in
 * one does not", which is the kind of asymmetry that makes a default and its override read
 * differently for no reason a user could predict.
 */
export type CodeTemplate = {
  subject: string
  html: string
  attachIcs: boolean
}

export type ResolvedTemplate = {
  payload: OutboxPayload
  /**
   * `template` when the organizer's row supplied the body, `form_inline` when it came off a
   * `Forms` column, `system` when it came from the code. The three values the column already
   * declares (src/migrations/tables-comms.ts), used for what they say.
   */
  templateSource: 'template' | 'form_inline' | 'system'
  /** Set only alongside `templateSource: 'template'`: provenance for the Comms log. */
  templateId?: RecordId
}

export type ResolveInput = {
  /** The event's row for this key, or `undefined` when it has none. Absence is normal. */
  stored: EmailTemplate | undefined
  fallback: CodeTemplate
  context: MergeContext
  /**
   * What to call the fallback when it is used. `system` for a body written in this
   * codebase, `form_inline` for one an organizer authored on the form itself
   * (`Forms.confirmationEmailHtml`), which is a different provenance and a different answer
   * to "where do I go to change this".
   */
  fallbackSource?: 'system' | 'form_inline'
}

/**
 * Render one message.
 *
 * Raises `MAIL_MERGE_FIELD_UNKNOWN` from `renderTemplate` when a body names a merge field
 * the context cannot supply, and that is deliberately not caught here. The drain treats
 * that id as permanent (drain.ts `isPermanent`), so a template with a typo in a merge field
 * fails once and loudly instead of burning five provider calls per recipient. Falling back
 * to the code body on a bad merge field would be worse than either: the organizer would
 * never learn their template was broken.
 */
export function resolveTemplate(input: ResolveInput): ResolvedTemplate {
  const stored = usable(input.stored)

  if (stored === undefined) {
    return {
      payload: {
        subject: renderSubject(input.fallback.subject, input.context),
        html: renderTemplate(input.fallback.html, input.context),
        attachIcs: input.fallback.attachIcs,
      },
      templateSource: input.fallbackSource ?? 'system',
    }
  }

  return {
    payload: {
      // A stored subject may carry merge fields too, and it is rendered WITHOUT HTML
      // escaping: a subject is a mail header, so "AI & ML Summit" must not arrive as
      // "AI &amp; ML Summit". `renderSubject` exists for this one value.
      //
      // A blank subject falls back on its own, independently of the body. The two are
      // separate columns and an organizer who wrote a body and left the subject empty
      // wanted a body, not a message with no subject line.
      subject: renderSubject(
        stored.subject.trim() === '' ? input.fallback.subject : stored.subject,
        input.context,
      ),
      // Markdown first, then the merge fields. See the ORDER note in markdown-email.ts:
      // substituting first would let a speaker's own text be read as markdown.
      html: renderTemplate(emailHtmlFromMarkdown(stored.bodyMarkdown), input.context),
      // The stored `attachIcs` is deliberately NOT honoured by the triggers wired to this
      // function, so the fallback's value stands. A row whose payload asks for an invite and
      // whose submission has no scheduled time raises MAIL_ICS_INVALID, which the drain
      // treats as permanent (invite-attachment.ts), so an organizer ticking the box on an
      // `accepted` template would silently kill their own acceptance mail. Only
      // `session.invite`, which has no stored-template path, may set it.
      attachIcs: input.fallback.attachIcs,
    },
    templateSource: 'template',
    templateId: stored.id,
  }
}

/**
 * The stored row, or `undefined` when it cannot supply a body.
 *
 * A blank `bodyMarkdown` is the case rule 2 is about. It is checked here rather than at the
 * mapper because "empty" is a legitimate stored value that means something (go back to the
 * built-in text), so the DAL's job is to report it faithfully and this is the layer that
 * decides what it means.
 */
function usable(stored: EmailTemplate | undefined): EmailTemplate | undefined {
  if (stored === undefined) return undefined
  return stored.bodyMarkdown.trim() === '' ? undefined : stored
}
