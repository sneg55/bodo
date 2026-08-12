// The checks that protect a TYPED COLUMN: which answers reach a first-class Airtable column
// and which fall into `answersJson`.
//
// Split out of `builder-checks.test.ts` when that file passed the size limit. The fixture is
// shared through `helpers/builder-checks-fixtures.ts`, deliberately, because both files
// describe the same form and two copies of it would drift.

import { describe, expect, it } from 'vitest'

import { checkDraft } from '@/features/forms/builder/checks'
import type { FormField } from '@/types/forms'

import {
  draft,
  FORMAT,
  LAB,
  messages,
  TAGS,
  TRACKS,
  trackField,
} from './helpers/builder-checks-fixtures'

describe('checks that protect a typed column, all found by Codex review', () => {
  it('refuses a Track option belonging to another event', () => {
    // The one that mattered. `checkRouting` validated routing-rule and fallback ids but not
    // the option LIST, and `prepareSubmission` writes the chosen option value straight into
    // the Track link. So a form could offer another event's category and the submission was
    // linked to it. Reproduced by Codex against a real draft before this existed.
    const problems = checkDraft(
      draft({ fields: [FORMAT, LAB, trackField(['recInfra', 'recSomeoneElsesEvent'])] }),
      TRACKS,
      TAGS,
    )

    expect(messages(problems)).toContain('on this event, so an answer of')
    expect(problems.some((problem) => problem.severity === 'error')).toBe(true)
  })

  it('accepts a Track option list drawn entirely from this event', () => {
    expect(checkDraft(draft({ fields: [FORMAT, LAB, trackField(TRACKS)] }), TRACKS, TAGS)).toEqual(
      [],
    )
  })

  it('refuses a foreign Tags option too, since tagIds is also a link column', () => {
    const tagField: FormField = {
      id: 'f_tags',
      type: 'multiselect',
      label: 'Tags',
      required: false,
      registryKey: 'tags',
      options: [{ value: 'recNotOurs', label: 'Not ours' }],
    }

    expect(
      messages(checkDraft(draft({ fields: [FORMAT, LAB, tagField] }), TRACKS, TAGS)),
    ).toContain('on this event, so an answer of')
  })

  it('refuses a registryKey that names no registry field', () => {
    // The editor only ever sets a key from the registry, but `saveFormAction` takes the
    // whole draft from the client, so the UI behaving well is not a check on a POST.
    const bogus: FormField = {
      id: 'f_bogus',
      type: 'text',
      label: 'Invented',
      required: false,
      registryKey: 'notAField',
    }

    expect(messages(checkDraft(draft({ fields: [FORMAT, bogus] }), TRACKS, TAGS))).toContain(
      'bound to an unknown field key',
    )
  })

  it('refuses two questions bound to the same column', () => {
    // Two answers would race for one column and whichever `answer-storage` visits last
    // wins, which is a silent wrong answer rather than an error.
    const one: FormField = {
      id: 'f1',
      type: 'text',
      label: 'Title A',
      required: false,
      registryKey: 'title',
    }
    const two: FormField = {
      id: 'f2',
      type: 'text',
      label: 'Title B',
      required: false,
      registryKey: 'title',
    }

    expect(messages(checkDraft(draft({ fields: [one, two] }), TRACKS, TAGS))).toContain(
      'bound to the same field',
    )
  })
})

describe('a question that impersonates a library field', () => {
  // The 2026-08-12 evaluation run filed this twice under CFP-15 without ever identifying it: a
  // speaker answered `Platform & Infra` to a question headed "Track", and the submission, the
  // Abstracts list, the session and the agenda all read `Agents`. The form's Track question had
  // been built through the bare type picker, so it carried no `registryKey`, its answer went to
  // `answersJson` as designed, and a routing rule `format eq talk -> Agents` decided the column.
  // Nothing was broken and nothing said so.
  const customTrack: FormField = {
    id: 'f_custom',
    type: 'select',
    label: 'Track',
    required: false,
    options: [{ value: 'Platform & Infra', label: 'Platform & Infra' }],
  }

  it('warns that its answers will not reach the column its label implies', () => {
    const problems = checkDraft(draft({ fields: [FORMAT, LAB, customTrack] }), TRACKS, TAGS)

    expect(messages(problems)).toContain('is a custom question, not the Track field')
  })

  it('warns rather than blocks, because the answer is stored and merely not authoritative', () => {
    // Different in kind from the checks above that carry `blocksPublish`, where an answer
    // would be dropped outright. A custom question called Track is a legitimate thing to
    // want; it just does not set the session's track.
    const problems = checkDraft(draft({ fields: [FORMAT, LAB, customTrack] }), TRACKS, TAGS)

    expect(problems.every((problem) => problem.severity === 'warning')).toBe(true)
  })

  it('says nothing when the question IS bound to the library field', () => {
    expect(checkDraft(draft({ fields: [FORMAT, LAB, trackField(TRACKS)] }), TRACKS, TAGS)).toEqual(
      [],
    )
  })

  it('says nothing about a second Track question when a bound one is already present', () => {
    // A form may reasonably carry the library's Track plus another question sharing the word.
    // The bound one owns the column, so the custom one is not impersonating anything.
    const problems = checkDraft(
      draft({ fields: [FORMAT, LAB, trackField(TRACKS), customTrack] }),
      TRACKS,
      TAGS,
    )

    expect(messages(problems)).not.toContain('is a custom question')
  })

  it('ignores a custom question whose label matches no library field', () => {
    const ordinary: FormField = {
      id: 'f_ord',
      type: 'text',
      label: 'Key takeaway',
      required: false,
    }

    expect(checkDraft(draft({ fields: [FORMAT, LAB, ordinary] }), TRACKS, TAGS)).toEqual([])
  })

  it('matches the label case- and whitespace-insensitively', () => {
    const shouty: FormField = { ...customTrack, label: '  TRACK  ' }

    expect(messages(checkDraft(draft({ fields: [FORMAT, LAB, shouty] }), TRACKS, TAGS))).toContain(
      'is a custom question, not the Track field',
    )
  })
})

describe('a form that writes no link columns, found by Codex review', () => {
  // A portal form stores everything in TaskAssignments.answersJson: `splitAnswers` is never
  // called on it, so a Track option value is inert text rather than a record id that reaches a
  // link column. Running the link check anyway rejected every legitimate Track question on a
  // portal form, because its callers have no event track list to pass and would gain nothing by
  // having one. That was a regression the cross-event Track fix introduced through this shared
  // check, which is the risk of sharing a check between two surfaces with different storage.
  const trackQuestion = (): FormField => ({
    id: 'f_track',
    type: 'select',
    label: 'Track',
    required: false,
    registryKey: 'track',
    options: [{ value: 'recNotAnEventTrack', label: 'Anything' }],
  })

  it('accepts an option value that is not an event track', () => {
    const problems = checkDraft(draft({ fields: [FORMAT, trackQuestion()] }), [], [], false)

    expect(messages(problems)).not.toContain('on this event, so an answer of')
  })

  it('still refuses it for a form that DOES write link columns', () => {
    // The CFP default is unchanged, which is the half that matters for the original bug.
    const problems = checkDraft(draft({ fields: [FORMAT, trackQuestion()] }), TRACKS)

    expect(messages(problems)).toContain('on this event, so an answer of')
  })

  it('keeps the other registry-key rules either way', () => {
    // Only the LINK-value check is skipped. An unknown key and a duplicated key are still
    // errors on a portal form, because those break answer storage on any surface.
    const bogus: FormField = {
      id: 'f_bogus',
      type: 'text',
      label: 'Invented',
      required: false,
      registryKey: 'notAField',
    }

    expect(messages(checkDraft(draft({ fields: [FORMAT, bogus] }), [], [], false))).toContain(
      'bound to an unknown field key',
    )
  })
})
