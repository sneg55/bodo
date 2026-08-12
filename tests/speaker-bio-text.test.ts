// The biography seen through a plain textarea.
//
// The speaker writes it in TipTap and it is stored as HTML; the organizer's edit sheet is a
// textarea. Both directions of that conversion have a way of quietly damaging somebody
// else's words, so both are pinned here.

import { describe, expect, it } from 'vitest'

import { bioToText, textToBioHtml } from '@/features/speakers/bio-text'

describe('bioToText', () => {
  it('shows prose, not markup', () => {
    // This is the whole defect: the sheet rendered the stored HTML as literal text, so an
    // organizer saw "<p>Ada builds compilers.</p>" and either left it alone in confusion or
    // "fixed" it by deleting the tags.
    expect(bioToText('<p>Ada builds compilers.</p>')).toBe('Ada builds compilers.')
  })

  it('keeps paragraphs apart rather than running them together', () => {
    expect(bioToText('<p>First.</p><p>Second.</p>')).toBe('First.\n\nSecond.')
  })

  it('turns a line break into a line break', () => {
    expect(bioToText('<p>One<br>Two</p>')).toBe('One\nTwo')
  })

  it('decodes entities, and decodes the ampersand last', () => {
    // `&amp;lt;` is a literal "&lt;". Decoding `&amp;` first would turn it into `&lt;` and
    // then into `<`, which is a stored biography growing a tag it never had.
    expect(bioToText('<p>AI &amp; ML</p>')).toBe('AI & ML')
    expect(bioToText('<p>&amp;lt;</p>')).toBe('&lt;')
  })

  it('is empty for an empty biography', () => {
    expect(bioToText('')).toBe('')
    expect(bioToText('   ')).toBe('')
  })
})

describe('textToBioHtml', () => {
  it('gives every paragraph a paragraph', () => {
    expect(textToBioHtml('First.\n\nSecond.')).toBe('<p>First.</p><p>Second.</p>')
  })

  it('keeps a single newline as a line break inside one paragraph', () => {
    expect(textToBioHtml('One\nTwo')).toBe('<p>One<br>Two</p>')
  })

  it('escapes what an organizer typed, because this is stored and rendered as HTML', () => {
    // Four characters, not a tag. A biography is one of the strings that reaches an email
    // body, so a `<b>` typed here must not become one.
    expect(textToBioHtml('I write <b>fast</b> code')).toBe(
      '<p>I write &lt;b&gt;fast&lt;/b&gt; code</p>',
    )
    expect(textToBioHtml('AI & ML')).toBe('<p>AI &amp; ML</p>')
  })

  it('is empty for empty input, so a cleared box clears the column', () => {
    expect(textToBioHtml('')).toBe('')
    expect(textToBioHtml('  \n\n  ')).toBe('')
  })
})

describe('the round trip', () => {
  it('survives text the organizer typed', () => {
    const typed = 'Ada builds compilers.\n\nShe has spoken at AI & ML Summit.'
    expect(bioToText(textToBioHtml(typed))).toBe(typed)
  })

  it('survives a literal angle bracket', () => {
    const typed = 'I write <b>fast</b> code'
    expect(bioToText(textToBioHtml(typed))).toBe(typed)
  })
})
