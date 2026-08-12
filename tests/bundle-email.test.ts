// The one string in this feature that has to match the reference character for character.
//
// docs/parity/external-references.md, "Bulk file download", records the subject line verbatim
// as `[Sessionboard] Your file is ready`. Familiarity is scored (bodo-conventions, "UI"), and
// a subject line is the part of an email a recipient filters and searches on, so it is pinned
// by a literal here rather than by a snapshot that a careless update would rewrite.

import { describe, expect, it } from 'vitest'

import { BUNDLE_EMAIL_SUBJECT, bundleReadyEmail } from '@/features/bundle/email'
import { bundleSizeLabel, countLabel } from '@/features/bundle/format'

const READY = {
  eventName: 'AI.Engineer Sandbox',
  downloadUrl: 'https://bodo.test/api/files/bundle?eventId=rec-event-1&sessions=sub-1',
  fileCount: 12,
  totalBytes: 88_000_000,
  sessionCount: 4,
}

describe('BUNDLE_EMAIL_SUBJECT', () => {
  it('is the reference subject line, verbatim', () => {
    expect(BUNDLE_EMAIL_SUBJECT).toBe('[Sessionboard] Your file is ready')
  })

  it('is what the built email carries', () => {
    expect(bundleReadyEmail(READY).subject).toBe(BUNDLE_EMAIL_SUBJECT)
  })
})

describe('bundleReadyEmail', () => {
  it('carries the download link as a real anchor', () => {
    expect(bundleReadyEmail(READY).html).toContain(`href="${READY.downloadUrl}"`)
  })

  it('names the event, so a recipient with two conferences can tell them apart', () => {
    expect(bundleReadyEmail(READY).html).toContain('AI.Engineer Sandbox')
  })

  it('states the counts and the size', () => {
    const html = bundleReadyEmail(READY).html

    expect(html).toContain('4 sessions')
    expect(html).toContain('12 files')
    expect(html).toContain('84 MB')
  })

  it('repeats the latest-version rule the reference states', () => {
    expect(bundleReadyEmail(READY).html).toContain('Only the latest version of each file')
  })

  it('renders markdown to HTML rather than mailing the source', () => {
    const html = bundleReadyEmail(READY).html

    expect(html).toContain('<p>')
    expect(html).not.toContain('[Download the files](')
  })

  it('reads correctly for a single file on a single session', () => {
    const html = bundleReadyEmail({ ...READY, fileCount: 1, sessionCount: 1 }).html

    expect(html).toContain('1 session and contains 1 file,')
  })
})

describe('bundleSizeLabel', () => {
  it('rounds to whole megabytes above a megabyte', () => {
    expect(bundleSizeLabel(5 * 1024 * 1024)).toBe('5 MB')
    expect(bundleSizeLabel(Math.round(2.6 * 1024 * 1024))).toBe('3 MB')
  })

  it('falls back to kilobytes below a megabyte', () => {
    expect(bundleSizeLabel(400 * 1024)).toBe('400 KB')
  })

  it('never reports zero, which would look like a broken bundle', () => {
    expect(bundleSizeLabel(0)).toBe('1 KB')
    expect(bundleSizeLabel(12)).toBe('1 KB')
  })
})

describe('countLabel', () => {
  it('pluralises only when it should', () => {
    expect(countLabel(1, 'file')).toBe('1 file')
    expect(countLabel(0, 'file')).toBe('0 files')
    expect(countLabel(2, 'session')).toBe('2 sessions')
  })
})
