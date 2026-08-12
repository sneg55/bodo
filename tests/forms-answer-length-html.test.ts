// `answerLength` over rich text: the counter and the server have to charge the same number.
//
// The reported defect: a speaker's abstract showed as raw markup in the portal and the
// counter under it read "45 / 5,000" for 38 characters of prose, because `<p>` and `</p>`
// were being counted. Now that the editor is a real one, every formatting button would
// have moved that number further from what the speaker could see, and `checkAnswer` on the
// server measures with this same function.

import { describe, expect, it } from 'vitest'

import { checkAnswer } from '@/features/forms/field-checks'
import { answerLength } from '@/features/forms/logic'
import type { FormField } from '@/types/forms'

const ABSTRACT = 'A taxonomy of mid-trajectory failures.'

function wysiwyg(overrides: Partial<FormField> = {}): FormField {
  return { id: 'f1', type: 'wysiwyg', label: 'Description', required: false, ...overrides }
}

describe('answerLength over plain text', () => {
  it('counts a plain string as written, untrimmed', () => {
    expect(answerLength('abc')).toBe(3)
    expect(answerLength('  padded  ')).toBe(10)
  })

  it('leaves a stray angle bracket alone, because it is not a tag', () => {
    expect(answerLength('if a < b then')).toBe(13)
    expect(answerLength('rated <3')).toBe(8)
  })

  it('is unchanged for the non-string answers', () => {
    expect(answerLength(undefined)).toBe(0)
    expect(answerLength(42)).toBe(2)
    expect(answerLength(true)).toBe(4)
    expect(answerLength(['ab', 'cd'])).toBe(4)
  })
})

describe('answerLength over rich text', () => {
  it('counts the prose, not the paragraph tags', () => {
    expect(answerLength(`<p>${ABSTRACT}</p>`, 'wysiwyg')).toBe(ABSTRACT.length)
    // 38 characters of prose; the paragraph tags took it to the reported 45.
    expect(ABSTRACT.length).toBe(38)
  })

  it('does not charge for formatting a run of text', () => {
    expect(answerLength('<p>A <strong>bold</strong> claim</p>', 'wysiwyg')).toBe(
      'A bold claim'.length,
    )
  })

  it('counts a paragraph break as the one character it renders as', () => {
    expect(answerLength('<p>one</p><p>two</p>', 'wysiwyg')).toBe('one\ntwo'.length)
    expect(answerLength('<p>one<br>two</p>', 'wysiwyg')).toBe('one\ntwo'.length)
  })

  it('counts a decoded entity as one character', () => {
    expect(answerLength('<p>Tom &amp; Jerry</p>', 'wysiwyg')).toBe('Tom & Jerry'.length)
    expect(answerLength('<p>&lt;script&gt;</p>', 'wysiwyg')).toBe('<script>'.length)
  })

  it('counts a list as its items and their breaks', () => {
    expect(answerLength('<ul><li>one</li><li>two</li></ul>', 'wysiwyg')).toBe('one\ntwo'.length)
  })

  it('sums a rich text answer inside an array the same way', () => {
    expect(answerLength(['<p>one</p>', '<p>two</p>'], 'wysiwyg')).toBe(6)
  })
})

describe('the counter and the server agree', () => {
  it('accepts an answer whose text fits but whose markup does not', () => {
    const field = wysiwyg({ maxLen: 40 })
    const answer = `<p><strong>${ABSTRACT}</strong></p>`

    // What the drawer's counter shows, and what the cap is measured against.
    expect(answerLength(answer, field.type)).toBe(ABSTRACT.length)
    expect(answer.length).toBeGreaterThan(40)
    expect(checkAnswer(field, answer)).toEqual([])
  })

  it('still refuses an answer whose text is over the cap', () => {
    const field = wysiwyg({ maxLen: 10 })
    const problems = checkAnswer(field, `<p>${ABSTRACT}</p>`)
    expect(problems).toHaveLength(1)
    expect(problems[0]?.message).toContain('38 characters')
  })
})

describe('a tag-shaped span of plain text cannot hide characters', () => {
  // Codex review, 2026-08-10. Measuring EVERY string as text let any field be filled past its
  // cap: the tag pattern accepts a tag name followed by anything up to the next `>`, so one
  // 6,004 character "tag" stripped to nothing and a 5,000 cap passed on both the counter and
  // the server. The fix is that only a rich text FIELD is measured as markup.
  const HIDDEN = `<x ${'a'.repeat(6000)}>`

  it('counts every character when the field is not rich text', () => {
    expect(HIDDEN.length).toBe(6004)
    expect(answerLength(HIDDEN)).toBe(6004)
    expect(answerLength(HIDDEN, 'text')).toBe(6004)
    expect(answerLength(HIDDEN, 'textarea')).toBe(6004)
  })

  it('refuses it on a capped plain text field, where it used to pass', () => {
    const field: FormField = {
      id: 'f2',
      type: 'text',
      label: 'Title',
      required: false,
      maxLen: 5000,
    }
    const problems = checkAnswer(field, HIDDEN)
    expect(problems).toHaveLength(1)
    expect(problems[0]?.message).toContain('6004 characters')
  })

  it('refuses it on a rich text field too, because the cap is what it strips TO', () => {
    // Inside a wysiwyg field the span really is invisible to a reader, so measuring it as
    // nothing is correct. What must hold is that the visible text still cannot exceed the cap.
    const field = wysiwyg({ maxLen: 10 })
    expect(checkAnswer(field, HIDDEN)).toEqual([])
    expect(checkAnswer(field, `<p>${'b'.repeat(11)}</p>`)).toHaveLength(1)
  })
})
