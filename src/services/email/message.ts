// What a message is, independent of who sends it.
//
// These types were declared in `send.ts`, which was fine while Resend was the only
// adapter. Once a second adapter existed, importing them from `send.ts` meant every
// adapter importing the module that dispatches to it. Nothing here has behaviour, so the
// arrows point one way: adapters and callers both depend on this, and only `send.ts`
// depends on the adapters. `send.ts` re-exports all three, so existing imports still work.

export type EmailAttachment = {
  filename: string
  /**
   * RAW text, not base64. Callers hand over `.ics` output as-is and the adapter
   * encodes it, because base64 is a detail of a provider's JSON API rather than
   * something every caller should have to know. Getting this backwards is silent
   * and total: the REST APIs interpret a string `content` as base64, so raw
   * calendar text arrives decoded into binary garbage and the invite that the R3
   * acceptance criterion depends on never renders.
   */
  content: string
  /**
   * Full MIME type including parameters, for example
   * `text/calendar; method=REQUEST`. The parameters are the reason Gmail, Outlook,
   * and Apple render an .ics as an invite rather than an attachment, so this is
   * deliberately a free string and not an enum of bare types.
   */
  contentType: string
}

export type EmailMessage = {
  to: string | readonly string[]
  subject: string
  html: string
  attachments?: readonly EmailAttachment[]
  /**
   * Deterministic key, for example `accepted:<submissionId>:<notifiedAt>`. The
   * provider collapses repeats, so a retry cannot double-deliver.
   */
  idempotencyKey?: string
  replyTo?: string
}

export type SendResult = {
  /** False when no provider was configured and the message was only logged. */
  delivered: boolean
  /** Provider message id, or a `logged:` sentinel in the unconfigured case. */
  messageId: string
}
