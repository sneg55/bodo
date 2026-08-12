// The drain's attachment building and its reaping of rows that outlived their lease.
//
// Split from comms-drain.test.ts when that file crossed the size limit; the harness both
// halves use is tests/helpers/drain-mocks.ts. Claiming and failure handling stayed there.

import { describe, expect, it } from 'vitest'
import { AppError, ErrorIds } from '@/constants/errorIds'
import { drainOutbox, MAX_ATTEMPTS } from '@/features/comms/drain'
import { deps, row } from './helpers/drain-mocks'

describe('drainOutbox attachments', () => {
  it('attaches an invite when the row asks for one', async () => {
    const { fns, args } = deps({
      buildAttachments: () =>
        Promise.resolve([
          {
            filename: 'invite.ics',
            content: 'BEGIN:VCALENDAR',
            contentType: 'text/calendar; method=REQUEST',
          },
        ]),
    })

    await drainOutbox(args)

    expect(fns.send.mock.calls.at(0)?.[0]?.attachments?.at(0)?.contentType).toBe(
      'text/calendar; method=REQUEST',
    )
  })

  it('treats a failure to build the invite as a row failure, not a silent plain email', async () => {
    // Sending an acceptance with the calendar invite quietly missing is worse than
    // not sending it: the speaker has no reason to look for a second message.
    const { fns, args } = deps({
      buildAttachments: () =>
        Promise.reject(new AppError(ErrorIds.MAIL_ICS_INVALID, 'no start time', {})),
    })

    const result = await drainOutbox(args)

    expect(result).toMatchObject({ dead: 1, sent: 0 })
    expect(fns.send).not.toHaveBeenCalled()
  })

  it('does nothing when nothing is due', async () => {
    const { fns, args } = deps({ listDue: () => Promise.resolve([]) })

    expect(await drainOutbox(args)).toMatchObject({ claimed: 0, sent: 0 })
    expect(fns.claim).not.toHaveBeenCalled()
  })
})

describe('drainOutbox reaping', () => {
  it('kills a row that already burned the cap instead of sending it again', async () => {
    // Only a CAUGHT failure writes `dead`, so a row whose sender dies every time never
    // reached that branch: it recorded `sending`, vanished, came back once its lease
    // lapsed, and cycled forever with attempts climbing past the cap. Nothing reaped it.
    const { fns, args } = deps({
      listDue: () =>
        Promise.resolve([row({ id: 'rec1', status: 'sending', attempts: MAX_ATTEMPTS })]),
    })

    const result = await drainOutbox(args)

    expect(result).toMatchObject({ dead: 1, sent: 0 })
    expect(fns.send).not.toHaveBeenCalled()
    expect(fns.markFailed.mock.calls.at(0)?.[0]?.dead).toBe(true)
  })

  it('still sends a row one attempt below the cap', async () => {
    // The boundary matters: reaping at the wrong side of it throws away a legitimate
    // final attempt.
    const { fns, args } = deps({
      listDue: () =>
        Promise.resolve([row({ id: 'rec1', status: 'sending', attempts: MAX_ATTEMPTS - 1 })]),
    })

    const result = await drainOutbox(args)

    expect(result).toMatchObject({ sent: 1, dead: 0 })
    expect(fns.send).toHaveBeenCalled()
  })

  it('claims before reaping, so two sweeps cannot both kill the same row', async () => {
    const { fns, args } = deps({
      listDue: () =>
        Promise.resolve([row({ id: 'rec1', status: 'sending', attempts: MAX_ATTEMPTS })]),
    })
    fns.claim.mockResolvedValue({ granted: false })

    const result = await drainOutbox(args)

    expect(result).toMatchObject({ skipped: 1, dead: 0 })
    expect(fns.markFailed).not.toHaveBeenCalled()
  })
})
