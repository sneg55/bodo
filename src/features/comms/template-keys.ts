// The `EmailTemplates.key` vocabulary, and the two admin templates the builder edits.
//
// BUILD_SPEC 3 declares the column as text rather than a select, because "`accepted`,
// `rejected`, `reminder`, or `custom-*`" has an open half. The three fixed keys belong to
// triggers that already exist; the two admin alerts are `custom-*` because they are not in
// that fixed list, and inventing a fourth bare word would put this file at odds with the
// migration's own comment (src/migrations/tables-comms.ts).
//
// The key is the JOIN between an editor and a sender, and it is spelled once here for the
// same reason `COL` exists in the DAL: a key typed at two call sites is an editor that
// silently writes a row nothing reads. That failure is invisible in the UI, because saving
// succeeds and the mail simply keeps using the built-in body.
//
// Copy note. `Admin notifications` and `2 templates` come from parity ref 15 verbatim. The
// two ROW titles do not: that panel is collapsed in the screenshot, so nothing was captured
// inside it. They are worded off the two recipient questions on the same step, which are
// captured, and they are recorded here as invented rather than passed off as parity.

/** Every key this codebase reads or writes. */
export const TEMPLATE_KEYS = {
  /** `decision.accepted`, sent by Notify from the Accept Queue. */
  accepted: 'accepted',
  /** `decision.declined`. Named `rejected` because that is the key section 3 declares. */
  rejected: 'rejected',
  /** `submission.draft_reminder`, sent by the cron sweep before a form's close date. */
  reminder: 'reminder',
  /** `submission.admin_new`: a submission arrived, to `Forms.adminAlertOnNew`. */
  adminNew: 'custom-admin-new',
  /** `submission.admin_update`: a speaker edited one, to `Forms.adminAlertOnUpdate`. */
  adminUpdate: 'custom-admin-update',
  /**
   * `speaker.invite`: the portal invitation an organizer sends from the roster.
   *
   * `custom-*` for the reason the header gives. Section 3's fixed vocabulary is
   * `accepted`, `rejected`, `reminder`; this is not one of those and inventing a fourth
   * bare word would put this file at odds with the migration's own comment.
   */
  speakerInvite: 'custom-speaker-invite',
} as const

export type TemplateKey = (typeof TEMPLATE_KEYS)[keyof typeof TEMPLATE_KEYS]

/** One editable template: a row in a panel or on the Email Templates page. */
export type AdminTemplateMeta = {
  key: TemplateKey
  /** Invented; see the copy note in the header. */
  title: string
  description: string
  /** Defaults, as markdown and as a subject template. The single source: see below. */
  defaultSubject: string
  defaultBody: string
}

/**
 * The built-in body for the new-submission alert.
 *
 * Defined HERE and not in the sender, which is the point of this file rather than a
 * detail of it: the panel prefills its editor with this text so an organizer can see what
 * is being sent before overriding it, and the sender falls back to this same string when no
 * row exists. Two copies would drift, and the symptom would be an organizer editing a body
 * that does not match the one their speakers received.
 */
const ADMIN_NEW_BODY = [
  '{{speaker.firstName}} submitted **{{submission.title}}** ({{submission.code}}) to {{event.name}}.',
  '',
  'Open the admin app to review it.',
  '',
  '[{{portalUrl}}]({{portalUrl}})',
].join('\n')

const ADMIN_UPDATE_BODY = [
  '{{speaker.firstName}} updated a submission you have already seen.',
  '',
  '**{{submission.title}}** ({{submission.code}}) for {{event.name}}.',
  '',
  '[{{portalUrl}}]({{portalUrl}})',
].join('\n')

/**
 * The panel's two rows, in the order they render.
 *
 * `{{portalUrl}}` is the one link slot the merge context has (@/features/comms/templates),
 * and for an admin alert the sender fills it with the admin app rather than the speaker
 * portal. The name is section 5.3's, not a mistake here.
 */
export const ADMIN_TEMPLATES: readonly AdminTemplateMeta[] = [
  {
    key: TEMPLATE_KEYS.adminNew,
    title: 'New Submission Alert',
    description: 'Email sent to admin recipients when a new submission is received',
    defaultSubject: '{{submission.code}} was submitted to {{event.name}}',
    defaultBody: ADMIN_NEW_BODY,
  },
  {
    key: TEMPLATE_KEYS.adminUpdate,
    title: 'Submission Updated Alert',
    description: 'Email sent to admin recipients when an existing submission is updated',
    defaultSubject: '{{submission.code}} was updated by the speaker',
    defaultBody: ADMIN_UPDATE_BODY,
  },
]

/** Whether a key is one this panel owns, so an unknown key from a client is refused. */
export function adminTemplateFor(key: string): AdminTemplateMeta | undefined {
  return ADMIN_TEMPLATES.find((entry) => entry.key === key)
}

/**
 * The two SPEAKER emails an organizer can rewrite, on Settings > Email Templates.
 *
 * Their bodies live here for the reason the whole file exists: `renderDecision` sends the
 * same text as its fallback, converting this markdown at send time, so the box an organizer
 * edits is prefilled with the email their speakers are actually receiving. A second copy in
 * the sender would drift, and the symptom is an organizer editing a body nobody was sent.
 *
 * The subjects carry `{{event.name}}` rather than being interpolated in the sender. That is
 * safe here specifically: `renderSubject` substitutes WITHOUT escaping (templates.ts), so
 * "AI & ML Summit" arrives intact, which is what the sender's old template literal was
 * protecting.
 *
 * The draft reminder is deliberately NOT here. Its built-in body names the deadline that is
 * left ("in 24 hours"), which is per reminder and not per event, so there is no static text
 * that could be shown as its default without misrepresenting what goes out. A stored
 * `reminder` row is still honoured by the sender for anyone who writes one directly.
 */
const ACCEPTED_BODY_MD = [
  'Hi {{speaker.firstName}},',
  '',
  'Good news: your submission **{{submission.title}}** ({{submission.code}}) has been accepted for {{event.name}}.',
  '',
  'Open your speaker portal to confirm your details and see what we need next.',
  '',
  '[{{portalUrl}}]({{portalUrl}})',
].join('\n')

const DECLINED_BODY_MD = [
  'Hi {{speaker.firstName}},',
  '',
  'Thank you for submitting **{{submission.title}}** ({{submission.code}}) to {{event.name}}. After review, we are not able to include it in this year’s program.',
  '',
  'We had far more strong submissions than slots, and we hope you will consider submitting again.',
].join('\n')

/**
 * The portal invitation. SPK-06.
 *
 * Names no submission, and that is the constraint that shapes it: an organizer invites a
 * ROSTER, and half of it may be people imported from a spreadsheet who have never submitted
 * anything. `renderTemplate` throws on a merge field the context cannot supply, so a body
 * carrying `{{submission.title}}` would fail for exactly those people.
 *
 * It points at the portal rather than carrying a sign-in link. A magic link expires in
 * fifteen minutes (features/auth/magic-link.ts), which is fine for a link somebody just
 * asked for and useless in an invitation that may be opened the next morning. The portal
 * asks for their address and sends them a fresh one.
 */
const INVITE_BODY_MD = [
  'Hi {{speaker.firstName}},',
  '',
  'You have a speaker portal for **{{event.name}}**. It is where you complete your profile, upload what we need from you, and keep track of your sessions.',
  '',
  'Open it here and sign in with this email address:',
  '',
  '[{{portalUrl}}]({{portalUrl}})',
].join('\n')

export const SPEAKER_TEMPLATES: readonly AdminTemplateMeta[] = [
  {
    key: TEMPLATE_KEYS.speakerInvite,
    title: 'Portal Invitation',
    description: 'Sent when an organizer invites a speaker to the portal from the roster',
    defaultSubject: 'Your {{event.name}} speaker portal',
    defaultBody: INVITE_BODY_MD,
  },
  {
    key: TEMPLATE_KEYS.accepted,
    title: 'Acceptance',
    description: 'Sent to every participant when a decision is committed from the Accept Queue',
    defaultSubject: 'Your {{event.name}} submission was accepted',
    defaultBody: ACCEPTED_BODY_MD,
  },
  {
    key: TEMPLATE_KEYS.rejected,
    title: 'Decline',
    description: 'Sent to the submitter when a decision is committed from the Decline Queue',
    defaultSubject: 'An update on your {{event.name}} submission',
    defaultBody: DECLINED_BODY_MD,
  },
]

/**
 * Everything an organizer may edit, which is the closed list the write layer checks a key
 * against. Speaker emails first: they are the ones a speaker receives.
 */
export const EDITABLE_TEMPLATES: readonly AdminTemplateMeta[] = [
  ...SPEAKER_TEMPLATES,
  ...ADMIN_TEMPLATES,
]

/** The meta for an editable key, or nothing. The guard behind every template write. */
export function editableTemplateFor(key: string): AdminTemplateMeta | undefined {
  return EDITABLE_TEMPLATES.find((entry) => entry.key === key)
}
