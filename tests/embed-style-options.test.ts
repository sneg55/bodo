// `Primary Color` and `Website Color Theme`, as rules.
//
// Reference: docs/parity/external-references.md, "Embed Style Options". The expanded panel shows
// `Primary Color` as a swatch plus a hex input holding `#1b6ec2`, and `Website Color Theme` as a
// Select showing `Light`. Neither the validation nor the effect on the rendered page is captured,
// so both are ours and both are pinned here.
//
// The hex rule is the one that has to be strict at BOTH boundaries. The value is written into the
// served page as a CSS custom property, so `red; } body { display: none` in that cell is a
// stylesheet injection that needs no `<` and would sail past the CSS sanitizer, which never sees
// it. `#rrggbb` and nothing else is the whole defence, and it is applied on the way out of the DAL
// as well as on the way in, because the Airtable cell is writable by hand.

import { describe, expect, it } from 'vitest'

import {
  embedPrimaryColor,
  embedStyleVars,
  isEmbedHex,
  normalizeEmbedHex,
} from '@/features/cms/style-options'
import { EMBED_DEFAULTS } from '@/types/cms'

describe('isEmbedHex', () => {
  it('accepts the captured value', () => {
    expect(isEmbedHex('#1b6ec2')).toBe(true)
  })

  it('accepts upper case and normalises it to lower', () => {
    expect(isEmbedHex('#1B6EC2')).toBe(true)
    expect(normalizeEmbedHex('#1B6EC2')).toBe('#1b6ec2')
  })

  it('refuses the three-digit short form, so one stored shape reaches the page', () => {
    expect(isEmbedHex('#fff')).toBe(false)
  })

  it('refuses eight digits, since an alpha channel on a header band is not a colour choice', () => {
    expect(isEmbedHex('#1b6ec280')).toBe(false)
  })

  it('refuses a named colour and a function, both of which are valid CSS and not a hex', () => {
    expect(isEmbedHex('red')).toBe(false)
    expect(isEmbedHex('rgb(27 110 194)')).toBe(false)
    expect(isEmbedHex('var(--primary)')).toBe(false)
  })

  it('refuses a missing hash', () => {
    expect(isEmbedHex('1b6ec2')).toBe(false)
  })

  it('refuses a declaration smuggled into the value', () => {
    // This is the attack the rule exists for: the value is emitted as a CSS custom property, and
    // the CSS sanitizer never sees this column.
    expect(isEmbedHex('#fff; } body { display: none }')).toBe(false)
    expect(isEmbedHex('#fff;color:red')).toBe(false)
  })

  it('refuses whitespace inside the value while tolerating it around it', () => {
    expect(isEmbedHex('#1b6 ec2')).toBe(false)
    expect(isEmbedHex('  #1b6ec2  ')).toBe(true)
  })
})

describe('embedPrimaryColor, the DAL and render fallback', () => {
  it('keeps a valid stored colour', () => {
    expect(embedPrimaryColor('#0a0a0a')).toBe('#0a0a0a')
  })

  it('falls back to the captured default rather than dropping the colour', () => {
    // A blank or hand-broken cell must not leave the served page with an unset `--primary`, which
    // renders an unreadable header band rather than an obviously wrong one.
    for (const raw of [undefined, '', 'red', '#fff; } html { display: none }']) {
      expect(embedPrimaryColor(raw)).toBe(EMBED_DEFAULTS.primaryColor)
    }
  })
})

describe('embedStyleVars', () => {
  it('sets the primary token, which is what the header band paints with', () => {
    expect(embedStyleVars('#1b6ec2')['--primary']).toBe('#1b6ec2')
  })

  it('picks a light foreground on a dark primary and a dark one on a light primary', () => {
    // Otherwise the event name is unreadable on the band, which is the one place the colour shows.
    expect(embedStyleVars('#0b1c33')['--primary-foreground']).toBe('#ffffff')
    expect(embedStyleVars('#ffe680')['--primary-foreground']).toBe('#111111')
  })

  it('refuses an invalid colour by falling back, never by emitting it', () => {
    const vars = embedStyleVars('#fff; } body { display: none }')

    expect(vars['--primary']).toBe(EMBED_DEFAULTS.primaryColor)
    expect(JSON.stringify(vars)).not.toContain('display')
  })
})
