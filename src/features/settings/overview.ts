// The Event Settings > Overview launcher, as data.
//
// Section headings, card titles and card descriptions are transcribed verbatim from
// docs/parity/event-config.md ref 02, down to the trailing full stops. Do not improve the
// wording: the audit read it off the real product and familiarity is scored.
//
// TWO descriptions are deliberately NOT the transcribed ones, and the test for each is the
// same: does the card describe what it opens? Familiarity is scored, but a card that promises
// what the page behind it does not have is worse than one an organizer does not recognise,
// because they only find out by clicking.
//
//   - Integrations. Ref 02 gives "Connect Cvent, Swoogo, Zoom, and more.", and this build
//     connects Accelevents, Sessionboard and Sessionize instead. None of the three named
//     products exists here.
//   - Portals. Ref 02 gives "Speaker and exhibitor portal appearance.", and BUILD_SPEC 5.0c
//     DECLINES event-level portal branding outright (login and home logos, background images,
//     colours, fonts), as theming of the kind Email Themes was removed for. The page is the
//     assignment surface instead: portals in match order with their contact counts, and what
//     each one exposes. The description now says that, and it agrees with the header the page
//     itself renders.
//
// Hrefs come from `settingsNav`, matched by id, so a card and its sub-nav entry can never
// point at two different places. That is the parity checklist item "Card links navigate to
// the corresponding sub-nav section", expressed in the type rather than in prose.
//
// EVERY CARD HERE OPENS A SECTION THAT EXISTS. A product-critic pass found Record Settings
// sitting as a peer of six working cards and opening "Not part of this build", and marking it
// was the first answer; removing it, which landed from another branch the same day, is the
// better one and this file no longer carries the marking. Personas and Email Themes went the
// same way on 2026-08-09. Re-introducing a card whose page is a placeholder means saying so on
// the card, because finding out by clicking is the defect.
//
// TWO CARDS ARE NOT VERBATIM, both recorded in docs/parity/event-config.md, and one test
// decides both: does the card describe what it opens?
//
// The Integrations card reads "Connect Cvent, Swoogo, Zoom, and more." on the real product,
// and every provider it names is one bodo does not have: the page behind the card offers
// Accelevents, Sessionboard and Sessionize. Familiarity is scored, but a promise is not a
// wording preference. So the sentence keeps the vendor's shape and takes its providers from
// `INTEGRATION_PROVIDERS`, which means a fourth provider updates this card by existing
// rather than by somebody remembering this file.
//
// The Portals card reads "Speaker and exhibitor portal appearance." and BUILD_SPEC 5.0c
// explicitly declines event-level portal branding, the login and home logos, backgrounds,
// colours and fonts that Email Themes was removed for. So it advertised a waived feature,
// and the screen behind it styles nothing: it assigns contacts to portals and content to
// each portal, which is what the description names now.

import {
  BookOpenIcon,
  ClipboardListIcon,
  DoorOpenIcon,
  KeyIcon,
  LayoutListIcon,
  type LucideIcon,
  MailIcon,
  PlugIcon,
  SettingsIcon,
  TagIcon,
  TerminalIcon,
  WebhookIcon,
} from 'lucide-react'

import { settingsNavLeaves } from '@/features/settings/nav'
import { INTEGRATION_PROVIDERS } from '@/services/integrations/registry'

export type OverviewCard = {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly href: string
  readonly icon: LucideIcon
}

export type OverviewSection = {
  readonly id: string
  readonly heading: string
  readonly cards: readonly OverviewCard[]
}

type CardSpec = { id: string; description: string; icon: LucideIcon }

/**
 * "Accelevents, Sessionboard, and Sessionize", in the shape the vendor's sentence uses.
 *
 * Exported for the test that pins it to the registry rather than to a string, because the
 * value of deriving it is precisely that nobody has to come back here.
 */
export function providerSentenceList(labels: readonly string[]): string {
  const last = labels.at(-1)
  if (last === undefined) return ''
  if (labels.length === 1) return last
  const head = labels.slice(0, -1)
  // The Oxford comma is the vendor's, from "Cvent, Swoogo, Zoom, and more.", and it only
  // applies past two items: "Accelevents, and Sessionize" would read as a typo.
  return labels.length === 2 ? `${head[0]} and ${last}` : `${head.join(', ')}, and ${last}`
}

const INTEGRATIONS_DESCRIPTION = `Connect ${providerSentenceList(
  INTEGRATION_PROVIDERS.map((provider) => provider.label),
)}.`

const SECTION_SPECS: readonly { id: string; heading: string; cards: readonly CardSpec[] }[] = [
  {
    id: 'event-setup',
    heading: 'Event setup',
    cards: [
      {
        id: 'details',
        description: 'Name, dates, timezone, and the basics.',
        icon: SettingsIcon,
      },
      // "Record Settings" sat here, described as "Record layouts and field configuration."
      // It was an out-of-scope card rather than a surface, and it went on the owner's
      // instruction 2026-08-10 along with the `[section]` route that rendered it. Removed
      // from BOTH lists on purpose: `settingsOverview` drops any card whose id has no
      // sub-nav entry behind it, so pulling only the nav leaf would have made this card
      // vanish with nothing in the code saying it should.
      {
        id: 'portals',
        // Assignment, not appearance. See the header: 5.0c declines the branding ref 02's
        // wording promises, and this is what `/admin/{id}/portals` actually opens on.
        description: 'Which contacts land on which portal, and what each one shows.',
        icon: DoorOpenIcon,
      },
      {
        id: 'submission-forms',
        description: 'Submission form appearance and content.',
        icon: ClipboardListIcon,
      },
    ],
  },
  {
    id: 'library',
    heading: 'Library',
    cards: [
      {
        id: 'fields',
        description: 'Custom fields for contacts, sessions, and submissions.',
        icon: BookOpenIcon,
      },
      { id: 'tags', description: 'Reusable labels across records.', icon: TagIcon },
      // The Personas card sat here and the Email Themes card in Communications below. Both
      // went with their sub-nav entries on 2026-08-09; see the header of `nav.ts`. The four
      // parity headings stay, because each still has at least one card under it.
    ],
  },
  {
    id: 'communications',
    heading: 'Communications',
    cards: [{ id: 'email-templates', description: 'Transactional email content.', icon: MailIcon }],
  },
  {
    id: 'configuration',
    heading: 'Configuration',
    cards: [
      {
        id: 'integrations',
        // Derived from `INTEGRATION_PROVIDERS` rather than written out, so a fourth provider
        // updates this card by existing. See the header for why it is not ref 02's wording.
        description: INTEGRATIONS_DESCRIPTION,
        icon: PlugIcon,
      },
      {
        // Beside Integrations rather than in its own section: both answer "how does data get
        // out of bodo to something somebody else owns". Integrations push, the API pulls.
        id: 'api',
        description: 'Read-only tokens for the public API and the MCP server.',
        icon: KeyIcon,
      },
      {
        // The card that names the thing rather than the credential. "API Tokens" above is
        // where an organizer goes once they know they want one; nobody arrives at a settings
        // hub looking for a token, they arrive wanting their assistant to answer questions
        // about the conference, and this is the row that says that is possible.
        id: 'mcp',
        description: 'Connect an AI agent to your sessions, speakers, and outstanding tasks.',
        icon: TerminalIcon,
      },
      {
        // The third way out, and the only one that leaves on its own: Integrations push on a
        // schedule, the API is pulled, a webhook fires when something happens. Sessionboard
        // has no equivalent card, so the wording is ours; it names the two receivers an
        // organizer will actually point this at.
        id: 'webhooks',
        description: 'Signed POSTs to your own service or a Discord channel.',
        icon: WebhookIcon,
      },
    ],
  },
]

export function settingsOverview(eventId: string): readonly OverviewSection[] {
  const byId = new Map(settingsNavLeaves(eventId).map((leaf) => [leaf.id, leaf]))

  return SECTION_SPECS.map((section) => ({
    id: section.id,
    heading: section.heading,
    cards: section.cards.flatMap((card) => {
      const leaf = byId.get(card.id)
      // A card with no sub-nav entry behind it would be a link to nowhere, so it is
      // dropped rather than rendered dead. Unreachable while the two lists agree, which
      // is what tests/settings-nav.test.ts checks.
      return leaf === undefined
        ? []
        : [
            {
              id: card.id,
              title: leaf.label,
              description: card.description,
              href: leaf.href,
              icon: card.icon,
            },
          ]
    }),
  }))
}
