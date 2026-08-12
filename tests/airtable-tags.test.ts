// Tag builders are one line each, and a typo in one is invisible: the read still
// works, the write still succeeds, and the screen just never updates. So the exact
// strings are pinned here, and so is the property that actually matters, which is
// that no tag is a prefix collision of another.

import { describe, expect, it } from 'vitest'

import {
  eventAgendaPublishedTag,
  eventAgendaTag,
  eventFormsTag,
  eventLookupsTag,
  eventOutboxTag,
  eventPlanTag,
  eventResourcesTag,
  eventReviewTag,
  eventSavedViewsTag,
  eventSpeakersTag,
  eventSubmissionsTag,
  eventTag,
  eventTasksTag,
  formPublicTag,
  speakerFilesTag,
  speakerTag,
  speakerTasksTag,
  submissionFilesTag,
  submissionTag,
} from '@/services/airtable/tags'

describe('tag builders', () => {
  it('matches the granularity in .claude/rules/bodo-conventions.md exactly', () => {
    expect(eventSubmissionsTag('ev1')).toBe('event:ev1:submissions')
    expect(eventAgendaTag('ev1')).toBe('event:ev1:agenda')
    expect(eventAgendaPublishedTag('ev1')).toBe('event:ev1:agenda:published')
    expect(eventFormsTag('ev1')).toBe('event:ev1:forms')
    expect(speakerTag('spk1')).toBe('speaker:spk1')
    expect(submissionTag('sub1')).toBe('submission:sub1')
  })

  it('scopes the remaining reads under the same event prefix', () => {
    expect(eventTag('ev1')).toBe('event:ev1')
    expect(eventLookupsTag('ev1')).toBe('event:ev1:lookups')
    expect(eventSpeakersTag('ev1')).toBe('event:ev1:speakers')
    expect(eventReviewTag('ev1')).toBe('event:ev1:review')
    expect(eventPlanTag('ev1')).toBe('event:ev1:plan')
    expect(eventTasksTag('ev1')).toBe('event:ev1:tasks')
    expect(eventOutboxTag('ev1')).toBe('event:ev1:outbox')
    // Resources and their PortalItems rows share one tag, and it is deliberately NOT the
    // tasks tag even though PortalItems also holds task rows: editing a resource page must
    // not expire every speaker's task list.
    expect(eventResourcesTag('ev1')).toBe('event:ev1:resources')
    expect(eventResourcesTag('ev1')).not.toBe(eventTasksTag('ev1'))
    // Saved views are a preference over a list, not the list: creating one must not
    // expire the submissions the list is drawn from.
    expect(eventSavedViewsTag('ev1')).toBe('event:ev1:saved-views')
    expect(eventSavedViewsTag('ev1')).not.toBe(eventSubmissionsTag('ev1'))
  })

  it('scopes tasks and files under the record that owns them', () => {
    // Per speaker and per submission, not per event: one speaker ticking off a task
    // must not expire the portal of every other speaker at the conference.
    expect(speakerTasksTag('spk1')).toBe('speaker:spk1:tasks')
    expect(speakerFilesTag('spk1')).toBe('speaker:spk1:files')
    expect(submissionFilesTag('sub1')).toBe('submission:sub1:files')
  })

  it('keeps a record tag distinct from the lists hanging off it', () => {
    // `speaker:spk1` is the profile and `speaker:spk1:tasks` is the task list. If a
    // write confused the two, saving a biography would expire task lists and
    // completing a task would expire profiles, and neither would ever be noticed.
    expect(speakerTag('spk1')).not.toBe(speakerTasksTag('spk1'))
    expect(submissionTag('sub1')).not.toBe(submissionFilesTag('sub1'))
  })

  it('keys a public form on its publicId, which is what the URL carries', () => {
    expect(formPublicTag('cfp2026sandboxdemo01')).toBe('form:cfp2026sandboxdemo01')
  })

  it('never produces the same tag twice for one event', () => {
    const tags = [
      eventTag('ev1'),
      eventSubmissionsTag('ev1'),
      eventAgendaTag('ev1'),
      eventAgendaPublishedTag('ev1'),
      eventFormsTag('ev1'),
      eventLookupsTag('ev1'),
      eventSpeakersTag('ev1'),
      eventReviewTag('ev1'),
      eventPlanTag('ev1'),
      eventTasksTag('ev1'),
      eventOutboxTag('ev1'),
      eventResourcesTag('ev1'),
      eventSavedViewsTag('ev1'),
    ]

    // Accepting one submission must not invalidate the agenda and every list, and
    // a duplicated tag string would quietly undo that.
    expect(new Set(tags).size).toBe(tags.length)
  })

  it('keeps two events apart', () => {
    expect(eventSubmissionsTag('ev1')).not.toBe(eventSubmissionsTag('ev2'))
  })

  it('stays inside the 256-character tag limit for real record ids', () => {
    // Airtable ids are 17 characters; the limit is Next's, from the cacheTag docs.
    expect(eventAgendaPublishedTag('recABCDEFGHIJKLMN').length).toBeLessThan(256)
  })
})
