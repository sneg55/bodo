// The ⌘K ask, and the one property that makes an LLM answer safe to render in a palette.
//
// **A ref the snapshot never carried cannot become a link.** The model hands back record
// ids and this code turns them into rows. An id it invented, an id copied out of prose, an
// id that belongs to a speaker but arrived tagged as a submission: every one has to
// disappear rather than become something the organizer can click. Most of this file is
// that single rule approached from a different angle each time, because it is the only
// thing standing between a hallucinated id and a link in the product.
//
// **The mock is held to the same standard as the live path.** It is what a keyless clone
// demonstrates, so it is computed from the same rows the model would have been given and
// must not drift between two identical asks. A frozen sentence would pass a shallower test
// and teach whoever reads the palette that the feature works.

import { describe, expect, it } from 'vitest'

import {
  ASK_SCHEMA,
  ASK_SYSTEM_PROMPT,
  readAskAnswer,
  resolveRefs,
  snapshotRows,
} from '@/features/ai/ask'
import { mockAskAnswer } from '@/features/ai/ask-mock'
import { buildEventSnapshot, SNAPSHOT_LIMIT } from '@/features/ai/snapshot'
import { GROUP_LIMIT } from '@/features/search/global-search'
import { EVENT_ID, EVENT_ROW, speaker, submission, submissions } from './helpers/ai-ask-fakes'

const ROWS = { eventId: EVENT_ID, submissions: [submission()], speakers: [speaker()] }

describe('resolveRefs, an id the snapshot never carried cannot become a link', () => {
  it('drops an id that matches no row', () => {
    // The whole reason a ref is an id and not a URL. A model that invents `recFake` gets
    // nothing rendered for it, rather than a link into a 404.
    expect(resolveRefs([{ kind: 'submission', id: 'recFake' }], ROWS)).toEqual([])
  })

  it('drops a real id cited under the wrong kind', () => {
    // A speaker id arriving as a submission ref would, on any scheme keyed by id alone,
    // resolve against the wrong table.
    expect(resolveRefs([{ kind: 'submission', id: 'recSpk1' }], ROWS)).toEqual([])
  })

  it('keeps the refs that resolve while dropping the ones that do not', () => {
    const items = resolveRefs(
      [
        { kind: 'submission', id: 'recFake' },
        { kind: 'submission', id: 'recSub1' },
      ],
      ROWS,
    )

    expect(items.map((item) => item.id)).toEqual(['recSub1'])
  })

  it('resolves nothing when there are no rows at all', () => {
    expect(
      resolveRefs([{ kind: 'speaker', id: 'recSpk1' }], {
        eventId: EVENT_ID,
        submissions: [],
        speakers: [],
      }),
    ).toEqual([])
  })
})

describe('resolveRefs, what a resolved ref becomes', () => {
  it('sends a submission to the abstracts list filtered by its code', () => {
    // The same builder the search group uses, so an answer row and a search row for one
    // submission cannot disagree about where it lives.
    expect(resolveRefs([{ kind: 'submission', id: 'recSub1' }], ROWS)).toEqual([
      {
        id: 'recSub1',
        label: 'Scaling inference on a budget',
        description: 'SESS-14',
        href: `/admin/${EVENT_ID}/abstracts?q=SESS-14`,
      },
    ])
  })

  it('sends a speaker to their CRM profile, not to one of their talks', () => {
    // This asserted the abstracts list filtered by name until 2026-08-10, back when there
    // was no speaker route to send anyone to. There is one, and the old destination made a
    // row that named a PERSON open a SUBMISSION: for a speaker with a single accepted talk
    // the filtered list showed exactly that talk, so the answer looked like it had opened
    // the abstract. The id is the address; a name was only ever a query string.
    expect(resolveRefs([{ kind: 'speaker', id: 'recSpk1' }], ROWS)).toEqual([
      {
        id: 'recSpk1',
        label: 'Ada Lovelace',
        description: 'ada@example.com',
        href: '/admin/crm/recSpk1',
      },
    ])
  })

  it('keeps the order the model cited, because that order is its ranking', () => {
    const items = resolveRefs(
      [
        { kind: 'speaker', id: 'recSpk1' },
        { kind: 'submission', id: 'recSub1' },
      ],
      ROWS,
    )

    expect(items.map((item) => item.id)).toEqual(['recSpk1', 'recSub1'])
  })
})

describe('resolveRefs, duplicates and the cap', () => {
  it('collapses a record cited twice into one row', () => {
    const items = resolveRefs(
      [
        { kind: 'submission', id: 'recSub1' },
        { kind: 'submission', id: 'recSub1' },
      ],
      ROWS,
    )

    expect(items).toHaveLength(1)
  })

  it('caps at GROUP_LIMIT, the cap every other palette group already uses', () => {
    const many = submissions(GROUP_LIMIT + 4)
    const items = resolveRefs(
      many.map((row) => ({ kind: 'submission' as const, id: row.id })),
      { eventId: EVENT_ID, submissions: many, speakers: [] },
    )

    expect(items).toHaveLength(GROUP_LIMIT)
  })

  it('counts only resolved rows towards the cap', () => {
    // Otherwise a run of invented ids eats the budget and pushes the real rows out.
    const many = submissions(GROUP_LIMIT)
    const refs = [
      ...Array.from({ length: 5 }, (_, index) => ({
        kind: 'submission' as const,
        id: `recGhost${index}`,
      })),
      ...many.map((row) => ({ kind: 'submission' as const, id: row.id })),
    ]

    expect(resolveRefs(refs, { eventId: EVENT_ID, submissions: many, speakers: [] })).toHaveLength(
      GROUP_LIMIT,
    )
  })
})

describe('readAskAnswer, the schema is a request and not a guarantee', () => {
  it('reads the answer and the refs off a well-formed response', () => {
    const raw = { answer: 'Two speakers have no biography.', refs: [{ kind: 'speaker', id: 'a' }] }

    expect(readAskAnswer(raw)).toEqual(raw)
  })

  it('drops a ref that is not an object', () => {
    expect(readAskAnswer({ answer: 'x', refs: ['recSub1', null, 7] }).refs).toEqual([])
  })

  it('drops a ref with a kind this palette cannot render', () => {
    expect(readAskAnswer({ answer: 'x', refs: [{ kind: 'room', id: 'recRoom1' }] }).refs).toEqual(
      [],
    )
  })

  it('drops a ref with no id, which would resolve against a row keyed on an empty string', () => {
    expect(readAskAnswer({ answer: 'x', refs: [{ kind: 'speaker', id: '' }] }).refs).toEqual([])
  })

  it('returns an empty answer rather than undefined when the text is missing', () => {
    // The caller decides that an empty answer is a failure. It must not have to guard
    // against `undefined.trim()` to find that out.
    expect(readAskAnswer({ refs: [] }).answer).toBe('')
    expect(readAskAnswer(null).answer).toBe('')
    expect(readAskAnswer('a sentence').refs).toEqual([])
  })
})

describe('snapshotRows, the rows the model actually saw', () => {
  it('excludes a row the snapshot capped away', () => {
    // The critical property is about the SNAPSHOT, not about whatever the action happened
    // to read. A submission past the cap never reached the prompt, so an id matching it is
    // an id the model could only have guessed.
    const many = submissions(SNAPSHOT_LIMIT + 2)
    const speakers = [speaker()]
    const snapshot = buildEventSnapshot({
      event: EVENT_ROW,
      tracks: [],
      rooms: [],
      submissions: many,
      speakers,
    })

    const rows = snapshotRows({ ids: snapshot.ids, submissions: many, speakers })

    expect(rows.submissions).toHaveLength(SNAPSHOT_LIMIT)
    expect(rows.submissions.map((row) => row.id)).not.toContain(`recSub${SNAPSHOT_LIMIT + 1}`)
    expect(rows.speakers).toHaveLength(1)
  })

  it('keeps everything when nothing was capped', () => {
    const rows = snapshotRows({
      ids: { submissions: ['recSub1'], speakers: ['recSpk1'] },
      submissions: [submission()],
      speakers: [speaker()],
    })

    expect(rows.submissions).toHaveLength(1)
    expect(rows.speakers).toHaveLength(1)
  })
})

describe('mockAskAnswer, computed from the data and stable', () => {
  const INPUT = {
    question: 'which sessions talk about inference',
    submissions: [
      submission(),
      submission({ id: 'recSub2', code: 'SESS-15', title: 'Prompt caching' }),
    ],
    speakers: [speaker()],
  }

  it('returns exactly the same answer for the same inputs', () => {
    // Determinism is what makes the keyless path demonstrable: two presses of the same
    // question must not produce two different counts.
    expect(mockAskAnswer(INPUT)).toEqual(mockAskAnswer(INPUT))
  })

  it('moves with the data rather than repeating a frozen string', () => {
    const withMore = {
      ...INPUT,
      submissions: [
        ...INPUT.submissions,
        submission({ id: 'recSub3', code: 'SESS-16', title: 'Cheap inference at scale' }),
      ],
    }

    expect(mockAskAnswer(withMore).answer).not.toBe(mockAskAnswer(INPUT).answer)
  })

  it('counts the matching rows against the total and names them', () => {
    const { answer } = mockAskAnswer(INPUT)

    expect(answer).toContain('1 of 2 submissions')
    expect(answer).toContain('SESS-14')
  })

  it('says it is a keyword scan, so nobody reads it as an answer', () => {
    expect(mockAskAnswer(INPUT).answer.toLowerCase()).toContain('keyword')
  })

  it('cites only ids that resolve, so the mock obeys the same rule as the model', () => {
    const { refs } = mockAskAnswer(INPUT)
    const items = resolveRefs(refs, {
      eventId: EVENT_ID,
      submissions: INPUT.submissions,
      speakers: INPUT.speakers,
    })

    expect(refs.length).toBeGreaterThan(0)
    expect(items).toHaveLength(refs.length)
  })

  it('says plainly when the question held no word long enough to scan for', () => {
    const { answer, refs } = mockAskAnswer({ ...INPUT, question: 'is it ok' })

    expect(refs).toEqual([])
    expect(answer).toContain('no word')
  })

  it('reports nothing matched rather than naming a row it did not find', () => {
    const { answer, refs } = mockAskAnswer({ ...INPUT, question: 'quantum cryptography agenda' })

    expect(refs).toEqual([])
    expect(answer).toContain('0 of 2 submissions')
  })
})

describe('the prompt contract', () => {
  it('asks for the two fields the palette renders and nothing else', () => {
    const { properties } = ASK_SCHEMA as { properties: Record<string, unknown> }

    expect(Object.keys(properties).sort()).toEqual(['answer', 'refs'])
    expect(ASK_SCHEMA).toMatchObject({ additionalProperties: false })
  })

  it('tells the model that an invented id renders nothing', () => {
    // The prompt and `resolveRefs` are two halves of one rule. If the prompt stops saying
    // it, the model starts citing plausible ids and the palette starts showing an answer
    // with no rows under it for no visible reason.
    expect(ASK_SYSTEM_PROMPT.toLowerCase()).toContain('invent')
  })
})
