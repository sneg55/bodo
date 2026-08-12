// Stripping hidden answers, which BUILD_SPEC section 5.1 requires and which
// validation alone cannot do: validation skips a hidden field, so the stale value
// survives in the object it was handed. Whatever the caller then persists or
// routes off still carries an answer to a question the speaker was not shown.
//
// The unknown-key half is the same tampered-POST threat model as shape checking:
// the wizard only sends declared field ids, curl sends whatever it likes.

import { describe, expect, it } from 'vitest'

import { matchedTrackId, sanitizeAnswers } from '@/features/forms/logic'
import type { FormField, RoutingConfig } from '@/types/forms'

const FORMAT: FormField = { id: 'format', type: 'select', label: 'Format', required: false }

const LAB: FormField = {
  id: 'lab',
  type: 'text',
  label: 'Lab setup requirements',
  required: false,
  showIf: { fieldId: 'format', op: 'eq', value: 'workshop' },
}

describe('sanitizeAnswers', () => {
  it('keeps the answers of every visible field', () => {
    const answers = { format: 'workshop', lab: 'Docker installed' }

    expect(sanitizeAnswers([FORMAT, LAB], answers)).toEqual(answers)
  })

  it('removes the answer of a field whose condition no longer holds', () => {
    // The speaker answered the workshop question, then switched Format to talk.
    const answers = { format: 'talk', lab: 'Docker installed' }

    expect(sanitizeAnswers([FORMAT, LAB], answers)).toEqual({ format: 'talk' })
  })

  it('removes a dependent whose controller is itself hidden', () => {
    const deeper: FormField = {
      id: 'roomSetup',
      type: 'text',
      label: 'Room setup',
      required: false,
      showIf: { fieldId: 'lab', op: 'answered' },
    }
    const answers = { format: 'talk', lab: 'Docker installed', roomSetup: 'U shape' }

    expect(sanitizeAnswers([FORMAT, LAB, deeper], answers)).toEqual({ format: 'talk' })
  })

  it('drops keys that are not fields of this form at all', () => {
    // `constructor` is the shape of the collision the answer Map already guards
    // against; it is here to prove a tampered key is dropped rather than read.
    const answers = { format: 'talk', trackId: 'trk_keynote', constructor: 'boom' }

    expect(sanitizeAnswers([FORMAT, LAB], answers)).toEqual({ format: 'talk' })
  })

  it('keeps a false checkbox, which is an answer even though it is not answered', () => {
    // Stripping is about visibility, not about emptiness: an unchecked consent box
    // still has to reach storage as false rather than vanish.
    const terms: FormField = { id: 'terms', type: 'checkbox', label: 'Terms', required: false }

    expect(sanitizeAnswers([terms], { terms: false })).toEqual({ terms: false })
  })

  it('leaves the object the caller passed in untouched', () => {
    const answers = { format: 'talk', lab: 'Docker installed' }
    sanitizeAnswers([FORMAT, LAB], answers)

    expect(answers).toEqual({ format: 'talk', lab: 'Docker installed' })
  })

  it('returns an empty set for a form with no fields', () => {
    expect(sanitizeAnswers([], { anything: 'here' })).toEqual({})
  })
})

describe('matchedTrackId sanitizes before it routes', () => {
  const routing: RoutingConfig = {
    rules: [{ when: { fieldId: 'lab', op: 'answered' }, trackId: 'trk_workshop' }],
    defaultTrackId: 'trk_general',
  }

  it('ignores a stale hidden answer when choosing the track', () => {
    // Routing off `lab` here would file a talk under the workshop track, which is
    // a track the speaker never chose. No rule matches once the stale answer is
    // stripped, so nothing is routed and `prepare.ts` reaches for the speaker's own
    // Track answer and then `trk_general`.
    const answers = { format: 'talk', lab: 'Docker installed' }

    expect(matchedTrackId(routing, [FORMAT, LAB], answers)).toBeUndefined()
  })

  it('still routes off the answer while the field is visible', () => {
    const answers = { format: 'workshop', lab: 'Docker installed' }

    expect(matchedTrackId(routing, [FORMAT, LAB], answers)).toBe('trk_workshop')
  })

  it('ignores an injected answer for a field the form does not declare', () => {
    const injected: RoutingConfig = {
      rules: [{ when: { fieldId: 'vip', op: 'answered' }, trackId: 'trk_keynote' }],
      defaultTrackId: 'trk_general',
    }

    expect(matchedTrackId(injected, [FORMAT], { format: 'talk', vip: 'yes' })).toBeUndefined()
  })
})
