// The "your file is ready" mail, built as markdown and rendered like every other body.
//
// The subject is VERBATIM from the reference (docs/parity/external-references.md, "Bulk file
// download"): `[Sessionboard] Your file is ready`. It keeps the vendor's own bracket prefix
// because that is what the reference records and familiarity is what the parity docs are
// for; the body copy underneath it is authored, since no public source quotes it.
//
// Pure, so the subject and the link are asserted directly (tests/bundle-email.test.ts)
// rather than by queueing a row and reading it back. The one thing that must never drift is
// that subject line.

import { bundleSizeLabel, countLabel } from '@/features/bundle/format'
import { emailHtmlFromMarkdown } from '@/features/comms/markdown-email'

export const BUNDLE_EMAIL_SUBJECT = '[Sessionboard] Your file is ready'

export type BundleEmailInput = {
  readonly eventName: string
  /** Absolute, because a mail client has no origin to resolve against. */
  readonly downloadUrl: string
  readonly fileCount: number
  readonly totalBytes: number
  readonly sessionCount: number
}

export function bundleReadyEmail(input: BundleEmailInput): {
  readonly subject: string
  readonly html: string
} {
  // A markdown body run through the same renderer every other template uses, so the mail
  // looks like the rest of the event's mail rather than like a one-off.
  const body = [
    `Your file bundle for **${input.eventName}** is ready.`,
    '',
    `It covers ${countLabel(input.sessionCount, 'session')} and contains ${countLabel(
      input.fileCount,
      'file',
    )}, about ${bundleSizeLabel(input.totalBytes)}.`,
    '',
    `[Download the files](${input.downloadUrl})`,
    '',
    'Only the latest version of each file is included. Previous versions must be downloaded',
    'directly from the session content tab.',
    '',
    'The link is only usable while you are signed in to bodo, so it is safe to keep in your',
    'inbox and useless to anybody else.',
  ].join('\n')

  return { subject: BUNDLE_EMAIL_SUBJECT, html: emailHtmlFromMarkdown(body) }
}
