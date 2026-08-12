// The outbox drain's claiming and failure handling, tested for the interleavings it exists
// to survive.
//
// Airtable has no transaction and no compare-and-swap, so every one of these cases is
// a real thing that happens rather than a hypothetical: two cron invocations overlap,
// an isolate dies between the provider call and the status write, a template is broken
// for every retry. Asserting the happy path here would prove nothing at all.
//
// Attachments and reaping are in comms-drain-delivery.test.ts; the harness both halves
// share is tests/helpers/drain-mocks.ts.

import { describe, expect, it } from 'vitest'
import { AppError, ErrorIds } from '@/constants/errorIds'
import { drainOutbox, LEASE_MS, MAX_ATTEMPTS } from '@/features/comms/drain'
import { deps, NOW, row } from './helpers/drain-mocks'

describe('drainOutbox claiming', () => {
  it('sends a claimed row and records the provider message id', async () => {
    const { fns, args } = deps()

    const result = await drainOutbox(args)

    expect(result).toMatchObject({ claimed: 1, sent: 1, skipped: 0 })
    expect(fns.markSent).toHaveBeenCalledWith(
      'rec1',
      'msg_1',
      new Date(NOW).toISOString(),
      undefined,
    )
  })

  it('passes the row speaker id through, for the CRM comms tag', async () => {
    // Without this the CRM timeline (tagged speakerCommsTag, not eventOutboxTag) keeps
    // serving a stale view after the send it exists to show.
    const { fns, args } = deps({
      listDue: () => Promise.resolve([row({ id: 'rec1', speakerId: 'recSpk1' })]),
    })

    await drainOutbox(args)

    expect(fns.markSent).toHaveBeenCalledWith(
      'rec1',
      'msg_1',
      new Date(NOW).toISOString(),
      'recSpk1',
    )
  })

  it('does not send a row another sender already holds', async () => {
    // The overlapping-cron case. Without this the same speaker is emailed twice.
    const { fns, args } = deps()
    fns.claim.mockResolvedValue({ granted: false })

    const result = await drainOutbox(args)

    expect(result).toMatchObject({ claimed: 0, sent: 0, skipped: 1 })
    expect(fns.send).not.toHaveBeenCalled()
  })

  it('claims per row rather than once for the whole run', async () => {
    // A single run-level lock would let one contended row block every other message.
    const { fns, args } = deps({
      listDue: () => Promise.resolve([row({ id: 'rec1' }), row({ id: 'rec2' })]),
    })
    fns.claim.mockResolvedValueOnce({ granted: false }).mockResolvedValueOnce({ granted: true })

    const result = await drainOutbox(args)

    expect(result).toMatchObject({ skipped: 1, sent: 1 })
    expect(fns.claim.mock.calls.map((call) => call[0])).toEqual(['outbox:rec1', 'outbox:rec2'])
  })

  it('holds the lease long enough to cover a provider call', async () => {
    const { fns, args } = deps()

    await drainOutbox(args)

    expect(fns.claim).toHaveBeenCalledWith('outbox:rec1', 'run-1', LEASE_MS)
  })

  it('passes the row idempotency key to the provider', async () => {
    // This is what makes lease expiry safe. A retry after a crashed-but-delivered
    // send has to collapse at the provider rather than arrive as a second email.
    const { fns, args } = deps()

    await drainOutbox(args)

    expect(fns.send.mock.calls.at(0)?.[0]).toMatchObject({ idempotencyKey: 'key-rec1' })
  })
})

describe('drainOutbox failure handling', () => {
  it('records a failure with an incremented attempt count and leaves it retryable', async () => {
    const { fns, args } = deps()
    fns.send.mockRejectedValue(new AppError(ErrorIds.MAIL_SEND_FAIL, 'provider 500', {}))

    const result = await drainOutbox(args)

    expect(result).toMatchObject({ failed: 1, dead: 0 })
    expect(fns.markFailed).toHaveBeenCalledWith({
      rowId: 'rec1',
      attempts: 1,
      error: expect.stringContaining('E_MAIL_001'),
      dead: false,
      speakerId: undefined,
    })
  })

  it('passes the row speaker id through on failure too, for the CRM comms tag', async () => {
    // markSent has a passthrough test above; markFailed did not have one, and
    // `speakerId: undefined` in the test above cannot distinguish "passed through as
    // undefined" from "dropped entirely" - vitest treats an absent key and an explicit
    // undefined as equal under toHaveBeenCalledWith. This pins a DEFINED speakerId arrives.
    const { fns, args } = deps({
      listDue: () => Promise.resolve([row({ id: 'rec1', speakerId: 'recSpk1' })]),
    })
    fns.send.mockRejectedValue(new AppError(ErrorIds.MAIL_SEND_FAIL, 'provider 500', {}))

    await drainOutbox(args)

    expect(fns.markFailed).toHaveBeenCalledWith(
      expect.objectContaining({ rowId: 'rec1', speakerId: 'recSpk1' }),
    )
  })

  it('kills a row that has exhausted its attempts', async () => {
    const { fns, args } = deps({
      listDue: () => Promise.resolve([row({ id: 'rec1', attempts: MAX_ATTEMPTS - 1 })]),
    })
    fns.send.mockRejectedValue(new AppError(ErrorIds.MAIL_SEND_FAIL, 'still down', {}))

    const result = await drainOutbox(args)

    expect(result).toMatchObject({ dead: 1, failed: 0 })
    expect(fns.markFailed.mock.calls.at(0)?.[0]?.dead).toBe(true)
  })

  it('kills a permanently broken row immediately instead of burning five attempts', async () => {
    // A missing merge field fails identically every time, and retrying it delays the
    // mail that could still succeed.
    const { fns, args } = deps()
    fns.send.mockRejectedValue(
      new AppError(ErrorIds.MAIL_MERGE_FIELD_UNKNOWN, 'speaker.nickname', {}),
    )

    const result = await drainOutbox(args)

    expect(result).toMatchObject({ dead: 1 })
    expect(fns.markFailed.mock.calls.at(0)?.[0]?.attempts).toBe(1)
  })

  it('kills a row the provider refused outright, on the first attempt', async () => {
    // Measured on the deployed base: fourteen of fifteen rows read `dead` after five
    // attempts against one unchanging 422, "Invalid `to` field. Please use our testing
    // email address instead of domains like `example.com`". The sixth would have been
    // identical, and in the meantime those rows were re-leased ahead of mail that could
    // have gone.
    const { fns, args } = deps()
    fns.send.mockRejectedValue(
      new AppError(ErrorIds.MAIL_SEND_FAIL, 'resend rejected the send: 422 Invalid `to` field', {
        status: 422,
      }),
    )

    const result = await drainOutbox(args)

    expect(result).toMatchObject({ dead: 1, failed: 0 })
    expect(fns.markFailed.mock.calls.at(0)?.[0]?.attempts).toBe(1)
  })

  it.each([408, 429, 500, 503])('keeps a %i retryable', async (status) => {
    // The two 4xx a retry can genuinely clear, plus the 5xx the retry budget exists for.
    const { fns, args } = deps()
    fns.send.mockRejectedValue(
      new AppError(ErrorIds.MAIL_SEND_FAIL, `provider ${String(status)}`, { status }),
    )

    const result = await drainOutbox(args)

    expect(result).toMatchObject({ failed: 1, dead: 0 })
  })

  it('keeps draining after one row fails', async () => {
    const { fns, args } = deps({
      listDue: () => Promise.resolve([row({ id: 'rec1' }), row({ id: 'rec2' })]),
    })
    fns.send
      .mockRejectedValueOnce(new AppError(ErrorIds.MAIL_SEND_FAIL, 'transient', {}))
      .mockResolvedValueOnce({ delivered: true, messageId: 'msg_2' })

    const result = await drainOutbox(args)

    expect(result).toMatchObject({ failed: 1, sent: 1 })
  })

  it('never marks a row sent when the provider rejected it', async () => {
    const { fns, args } = deps()
    fns.send.mockRejectedValue(new AppError(ErrorIds.MAIL_SEND_FAIL, 'nope', {}))

    await drainOutbox(args)

    expect(fns.markSent).not.toHaveBeenCalled()
  })
})
