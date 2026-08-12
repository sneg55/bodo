// The Event Settings sub-nav and the Overview launcher.
//
// Two things are pinned. The labels and order, because they are transcribed off the real
// product (docs/parity/event-config.md ref 02) and drifting from them is a familiarity
// regression nothing else would catch. And the invariant behind the checklist item "Card
// links navigate to the corresponding sub-nav section": every Overview card resolves its
// href from the sub-nav by id, so the two cannot disagree.
//
// Personas and Email Themes are absent from both expectations on purpose. They were dropped
// on request 2026-08-09, and the assertions are the record of that: a re-added entry has to
// be a deliberate edit here rather than a quiet reappearance.

import { describe, expect, it } from 'vitest'

import {
  activeSettingsId,
  isLibraryActive,
  settingsNav,
  settingsNavLeaves,
} from '@/features/settings/nav'
import { providerSentenceList, settingsOverview } from '@/features/settings/overview'
import { INTEGRATION_PROVIDERS } from '@/services/integrations/registry'

const EVENT = 'recVZa0gqwt9VaNw3'

describe('settingsNav', () => {
  it('lists the sub-nav in the order and wording of the parity screenshot', () => {
    expect(
      settingsNav(EVENT).map((entry) =>
        entry.kind === 'group'
          ? [entry.label, entry.children.map((child) => child.label)]
          : entry.label,
      ),
    ).toEqual([
      'Overview',
      'Event Details',
      ['Library', ['Fields', 'Tags']],
      'Portals',
      'Submission Forms',
      'Email Templates',
      'Integrations',
      'API Tokens',
      'MCP Server',
      'Webhooks',
    ])
  })

  it('scopes every settings href under the event', () => {
    for (const leaf of settingsNavLeaves(EVENT)) {
      expect(leaf.href.startsWith(`/admin/${EVENT}/`)).toBe(true)
    }
  })

  it('points Submission Forms at the form list that already exists', () => {
    const leaf = settingsNavLeaves(EVENT).find((entry) => entry.id === 'submission-forms')
    expect(leaf?.href).toBe(`/admin/${EVENT}/forms`)
  })

  it('has one entry per id', () => {
    const ids = settingsNavLeaves(EVENT).map((leaf) => leaf.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('activeSettingsId', () => {
  it('selects Overview on the settings root only', () => {
    expect(activeSettingsId(`/admin/${EVENT}/settings`, EVENT)).toBe('overview')
  })

  it('prefers the longest match, so a section does not select Overview', () => {
    expect(activeSettingsId(`/admin/${EVENT}/settings/details`, EVENT)).toBe('details')
    expect(activeSettingsId(`/admin/${EVENT}/settings/fields`, EVENT)).toBe('fields')
    // The hyphenated case, which is what the `/` boundary check in `activeSettingsId`
    // exists for. It used to be `record-settings`; `email-templates` is the one left.
    expect(activeSettingsId(`/admin/${EVENT}/settings/email-templates`, EVENT)).toBe(
      'email-templates',
    )
  })

  it('selects Submission Forms from the forms route it points at', () => {
    expect(activeSettingsId(`/admin/${EVENT}/forms`, EVENT)).toBe('submission-forms')
  })

  it('is undefined outside the settings tree', () => {
    expect(activeSettingsId(`/admin/${EVENT}/agenda`, EVENT)).toBe(undefined)
  })

  it('expands Library only for its own children', () => {
    expect(isLibraryActive(`/admin/${EVENT}/settings/fields`, EVENT)).toBe(true)
    expect(isLibraryActive(`/admin/${EVENT}/settings/tags`, EVENT)).toBe(true)
    expect(isLibraryActive(`/admin/${EVENT}/settings/details`, EVENT)).toBe(false)
  })
})

describe('settingsOverview', () => {
  const sections = settingsOverview(EVENT)

  it('groups the cards under the four parity headings', () => {
    expect(sections.map((section) => section.heading)).toEqual([
      'Event setup',
      'Library',
      'Communications',
      'Configuration',
    ])
  })

  it('carries the card titles and descriptions verbatim', () => {
    expect(
      sections.flatMap((section) => section.cards.map((card) => [card.title, card.description])),
    ).toEqual([
      ['Event Details', 'Name, dates, timezone, and the basics.'],
      // No Record Settings row: the entry and its card were removed together when the shared
      // "Not part of this build" page was retired, so no card on this hub opens a placeholder.
      // NOT ref 02's "Speaker and exhibitor portal appearance.": BUILD_SPEC 5.0c declines
      // event-level portal branding, so the card describes the assignment surface it opens.
      ['Portals', 'Which contacts land on which portal, and what each one shows.'],
      ['Submission Forms', 'Submission form appearance and content.'],
      ['Fields', 'Custom fields for contacts, sessions, and submissions.'],
      ['Tags', 'Reusable labels across records.'],
      ['Email Templates', 'Transactional email content.'],
      // The one description that is NOT the vendor's. Theirs names Cvent, Swoogo and Zoom,
      // none of which bodo has; see the deviation recorded in overview.ts and in
      // docs/parity/event-config.md.
      [
        'Integrations',
        `Connect ${providerSentenceList(INTEGRATION_PROVIDERS.map((provider) => provider.label))}.`,
      ],
      // R10, added 2026-08-11. Also not the vendor's wording, and for a simpler reason than
      // the Integrations row above: Sessionboard has no equivalent card to copy.
      ['API Tokens', 'Read-only tokens for the public API and the MCP server.'],
      // R10 as well, added 2026-08-11: the setup surface for the server the row above mints a
      // credential for. Ours for the same reason theirs are.
      ['MCP Server', 'Connect an AI agent to your sessions, speakers, and outstanding tasks.'],
      // R11, added 2026-08-11. Ours as well, and for the same reason: there is no
      // Sessionboard card to transcribe.
      ['Webhooks', 'Signed POSTs to your own service or a Discord channel.'],
    ])
  })

  it('names on the Integrations card exactly the providers the page behind it offers', () => {
    // The assertion that matters more than the string above, because it is the one that
    // survives a fourth provider: the card is derived from the registry, so it cannot go
    // back to advertising an integration this build does not have.
    const card = sections
      .flatMap((section) => section.cards)
      .find((entry) => entry.id === 'integrations')

    expect(card).toBeDefined()
    for (const provider of INTEGRATION_PROVIDERS) {
      expect(card?.description).toContain(provider.label)
    }
    for (const absent of ['Cvent', 'Swoogo', 'Zoom']) {
      expect(card?.description).not.toContain(absent)
    }
  })

  it('gives every card the href of the sub-nav entry with the same id', () => {
    const byId = new Map(settingsNavLeaves(EVENT).map((leaf) => [leaf.id, leaf.href]))
    for (const card of sections.flatMap((section) => section.cards)) {
      expect(card.href).toBe(byId.get(card.id))
    }
  })

  it('offers a card for every sub-nav leaf except Overview itself', () => {
    const cardIds = new Set(sections.flatMap((section) => section.cards.map((card) => card.id)))
    for (const leaf of settingsNavLeaves(EVENT)) {
      if (leaf.id === 'overview') continue
      expect(cardIds.has(leaf.id)).toBe(true)
    }
  })
})

describe('the settings sub-nav after the placeholder card was removed', () => {
  // `PLACEHOLDER_SECTIONS` and the `settings/[section]` route it fed are both gone: Record
  // Settings was the last entry in that map, and it went on 2026-08-10. What replaces those
  // assertions is the invariant they were really protecting, which outlives the map.
  it('links only to sections that have a real page behind them', () => {
    const inTree = settingsNavLeaves(EVENT)
      .map((leaf) => leaf.href)
      .filter((href) => href.startsWith(`/admin/${EVENT}/settings/`))
      .map((href) => href.slice(`/admin/${EVENT}/settings/`.length))

    // Every remaining settings-tree destination is a static segment with its own directory
    // under `src/app/**`. There is no dynamic catch-all left, so an entry naming anything
    // else is now a hard 404 rather than a card apologising for itself.
    expect(inTree.toSorted()).toEqual([
      // R10's token screen, added 2026-08-11 with `settings/api/page.tsx` beside it. Listed
      // here because that is this test working: a nav entry added without its route would
      // have failed on this line rather than 404ing in front of somebody.
      'api',
      'details',
      'email-templates',
      'fields',
      'integrations',
      // The MCP setup walkthrough, added 2026-08-11 with `settings/mcp/page.tsx` beside it.
      'mcp',
      'tags',
      // R11's endpoint screen, added 2026-08-11 with `settings/webhooks/page.tsx` beside it.
      'webhooks',
    ])
  })

  it('offers no Record Settings entry or card', () => {
    const cardIds = settingsOverview(EVENT)
      .flatMap((section) => section.cards)
      .map((card) => card.id)

    expect(settingsNavLeaves(EVENT).map((leaf) => leaf.id)).not.toContain('record-settings')
    expect(cardIds).not.toContain('record-settings')
  })
})

describe('providerSentenceList', () => {
  // Three providers today, and the list has to keep reading like the vendor's sentence at
  // whatever the count becomes. Two is the case a bare `join(', and ')` gets wrong.
  it('joins two with "and" and no comma', () => {
    expect(providerSentenceList(['Accelevents', 'Sessionize'])).toBe('Accelevents and Sessionize')
  })

  it('takes the Oxford comma past two, which is what the vendor wrote', () => {
    expect(providerSentenceList(['Accelevents', 'Sessionboard', 'Sessionize'])).toBe(
      'Accelevents, Sessionboard, and Sessionize',
    )
  })

  it('answers a single provider and an empty registry without punctuation of its own', () => {
    expect(providerSentenceList(['Accelevents'])).toBe('Accelevents')
    expect(providerSentenceList([])).toBe('')
  })
})
