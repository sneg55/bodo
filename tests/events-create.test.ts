// The blank event draft and the slug suggestion.
//
// `suggestSlug` gets most of the attention here because its output goes into a public URL
// that outlives the form: `/submit/{eventSlug}/{formPublicId}` and `/agenda/{eventSlug}`
// are what an organizer emails to speakers, and changing a slug later breaks every link
// already sent (the settings form warns about exactly that). So a suggestion that is
// merely plausible is not good enough. Every case below is a name a real conference has.

import { describe, expect, it } from 'vitest'
import {
  blankEventDraft,
  DEFAULT_NEW_EVENT_TIMEZONE,
  NEW_EVENT_STATUS,
  slugToFollow,
  suggestSlug,
} from '@/features/events/create'
import { checkEventDetails } from '@/features/settings/checks'
import { EVENT_TYPE_OPTIONS, isSlugShaped, SLUG_MAX_LENGTH } from '@/features/settings/draft'

describe('blankEventDraft', () => {
  it('starts on an event type the base actually accepts', () => {
    // A blank single select is a 422 from Airtable, not an empty field.
    expect(EVENT_TYPE_OPTIONS).toContain(blankEventDraft().eventType)
  })

  it('defaults the timezone rather than leaving it empty', () => {
    expect(blankEventDraft().timezone).toBe(DEFAULT_NEW_EVENT_TIMEZONE)
  })

  it('takes a timezone when the caller has a better one', () => {
    expect(blankEventDraft('America/Los_Angeles').timezone).toBe('America/Los_Angeles')
  })

  it('leaves both dates cleared, because there is nothing honest to guess', () => {
    const draft = blankEventDraft()

    expect(draft.startsAt).toBeUndefined()
    expect(draft.endsAt).toBeUndefined()
  })

  it('carries no image URLs, which cannot be set before the record exists', () => {
    const draft = blankEventDraft()

    expect(draft.logoUrl).toBe('')
    expect(draft.backgroundUrl).toBe('')
  })

  it('fails the same validation an empty settings form would', () => {
    // The blank draft is a starting point, not a saveable value. If this ever passed,
    // the create button would write an unnamed event with no dates.
    const problems = checkEventDetails(blankEventDraft())
    const fields = problems.map((problem) => problem.field)

    expect(fields).toContain('name')
    expect(fields).toContain('slug')
    expect(fields).toContain('startsAt')
    expect(fields).toContain('endsAt')
  })

  it('starts the event closed to submissions', () => {
    expect(NEW_EVENT_STATUS).toBe('draft')
  })
})

describe('suggestSlug', () => {
  it('lowercases and hyphenates an ordinary conference name', () => {
    expect(suggestSlug('AI Engineer Sandbox')).toBe('ai-engineer-sandbox')
  })

  it('drops punctuation rather than encoding it', () => {
    // `Rust Conf 2027!` must not become `rust-conf-2027%21` in a URL anyone types.
    expect(suggestSlug('Rust Conf 2027!')).toBe('rust-conf-2027')
  })

  it('collapses runs of separators into one hyphen', () => {
    expect(suggestSlug('Data   &&&   AI   Summit')).toBe('data-ai-summit')
  })

  it('strips accents to their base letters instead of deleting the word', () => {
    // `Café Systems` losing its first word entirely would be worse than a wrong letter.
    expect(suggestSlug('Café Systems')).toBe('cafe-systems')
  })

  it('carries no leading or trailing hyphen from surrounding punctuation', () => {
    expect(suggestSlug('  --- Kubecon ---  ')).toBe('kubecon')
  })

  it('keeps digits, which conference names are mostly made of', () => {
    expect(suggestSlug('Scale 2026')).toBe('scale-2026')
  })

  it('returns something the shape check accepts, for every name that yields characters', () => {
    const names = [
      'AI Engineer Sandbox',
      'Rust Conf 2027!',
      'Data   &&&   AI   Summit',
      'Café Systems',
      '  --- Kubecon ---  ',
      'Scale 2026',
      `A${'b'.repeat(200)}`,
    ]

    for (const name of names) {
      const slug = suggestSlug(name)
      expect(isSlugShaped(slug), `${name} produced ${slug}`).toBe(true)
    }
  })

  it('truncates to the maximum without leaving a trailing hyphen', () => {
    // The interesting case: the cut lands exactly on a separator. A naive slice would
    // return `...word-`, which `isSlugShaped` rejects for a reason the organizer cannot
    // see, since the box would look full of perfectly ordinary text.
    const name = `${'word '.repeat(30)}tail`
    const slug = suggestSlug(name)

    expect(slug.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH)
    expect(slug.endsWith('-')).toBe(false)
    expect(isSlugShaped(slug)).toBe(true)
  })

  it('returns an empty string for a name with nothing to slugify', () => {
    // Not a thrown error and not an invented value: the form reports "Event Slug is
    // required" and the organizer types one, which is better than a public URL nobody chose.
    expect(suggestSlug('!!! ???')).toBe('')
  })
})

describe('slugToFollow', () => {
  it('follows the name while the slug is untouched', () => {
    expect(slugToFollow({ name: 'AI Engineer Sandbox' }, false)).toBe('ai-engineer-sandbox')
  })

  it('stops following once the slug has been edited', () => {
    // The rule that protects a deliberate slug from a later typo fix in the name.
    expect(slugToFollow({ name: 'AI Engineer Sandbox' }, true)).toBeUndefined()
  })

  it('never overrides the very edit that touches the slug', () => {
    // Name and slug arrive together in one patch when the organizer pastes into the slug
    // box. Suggesting over the top of it would make the field impossible to type in.
    expect(slugToFollow({ name: 'Something Else', slug: 'my-choice' }, false)).toBeUndefined()
  })

  it('ignores a patch that does not touch the name', () => {
    expect(slugToFollow({}, false)).toBeUndefined()
  })

  it('leaves a visible slug alone when the name is cleared', () => {
    // Mid-retype the name is briefly empty. Wiping the slug then reads as lost work,
    // and the organizer has no way to know it will not come back.
    expect(slugToFollow({ name: '' }, false)).toBeUndefined()
  })

  it('leaves it alone when the name has no slugifiable characters', () => {
    expect(slugToFollow({ name: '???' }, false)).toBeUndefined()
  })
})
