// The Event Settings sub-navigation, as data.
//
// Labels and order are verbatim off docs/parity/event-config.md ref 02: Overview, Event
// Details, Library (collapsible, expanded, with Fields / Tags indented), Record Settings,
// Portals, Submission Forms, Email Templates, Integrations. Do not reorder or reword the
// entries that remain: familiarity is scored.
//
// Two of ref 02's entries are deliberately absent. Personas (under Library) and Email Themes
// were removed on request 2026-08-09, because both were out-of-scope cards rather than
// surfaces, and BUILD_SPEC 5.0b is amended to match. Nothing else about the order moves: the
// gap each one leaves is closed by the entry that followed it.
//
// Data rather than JSX for the same reason `admin-nav.ts` is: the sub-nav needs the
// pathname so it is a client component, while the Overview page renders the same titles
// server side and must not disagree with it.
//
// Two entries point at routes OUTSIDE the settings tree, because the surface they name is
// already built elsewhere and a second, emptier copy of it would be worse than a link:
// "Submission Forms" is `/admin/{id}/forms`, and "Portals" is `/admin/{id}/portals`, which
// the Program tree's own Portals entry also points at. Everything else that has no build
// behind it lands on the shared
// out-of-scope card at `/settings/{section}`, which names the section it stands in for.

export type SettingsNavLeaf = {
  readonly id: string
  readonly label: string
  readonly href: string
}

export type SettingsNavGroup = {
  readonly id: string
  readonly label: string
  readonly children: readonly SettingsNavLeaf[]
}

export type SettingsNavEntry =
  | ({ readonly kind: 'leaf' } & SettingsNavLeaf)
  | ({ readonly kind: 'group' } & SettingsNavGroup)

export function settingsHref(eventId: string, path = ''): string {
  return `/admin/${eventId}/settings${path}`
}

export function settingsNav(eventId: string): readonly SettingsNavEntry[] {
  const at = (path: string) => settingsHref(eventId, path)

  return [
    { kind: 'leaf', id: 'overview', label: 'Overview', href: at('') },
    { kind: 'leaf', id: 'details', label: 'Event Details', href: at('/details') },
    {
      kind: 'group',
      id: 'library',
      label: 'Library',
      children: [
        { id: 'fields', label: 'Fields', href: at('/fields') },
        { id: 'tags', label: 'Tags', href: at('/tags') },
      ],
    },
    // Outside the settings tree, the same trick Submission Forms uses below: Portals is a
    // real surface at `/admin/{id}/portals` (BUILD_SPEC 5.0c) and the Program tree points
    // at the same href. Two routes over one set of rows is how the two entries come to
    // disagree about assignment order, which is what decides who lands where.
    { kind: 'leaf', id: 'portals', label: 'Portals', href: `/admin/${eventId}/portals` },
    {
      kind: 'leaf',
      id: 'submission-forms',
      label: 'Submission Forms',
      href: `/admin/${eventId}/forms`,
    },
    {
      kind: 'leaf',
      id: 'email-templates',
      label: 'Email Templates',
      href: at('/email-templates'),
    },
    { kind: 'leaf', id: 'integrations', label: 'Integrations', href: at('/integrations') },
    // Beside Integrations rather than under Library, because that is what it is: the other
    // way data leaves bodo for a system somebody else owns. Library holds vocabularies an
    // organizer edits, and a credential is not one.
    { kind: 'leaf', id: 'api', label: 'API Tokens', href: at('/api') },
    // Directly AFTER API Tokens because it is that page's other half: the credential is minted
    // there and the thing an organizer wanted it for is set up here. It is not folded into
    // that screen because the two answer different questions. API Tokens is the register of
    // every credential you hold, which is what you open to revoke one; this is a three-step
    // setup you run once per machine, and the token it mints has to stay on screen while you
    // paste it, which the register's one-time dialog exists to prevent.
    { kind: 'leaf', id: 'mcp', label: 'MCP Server', href: at('/mcp') },
    // Beside API Tokens for the same reason API Tokens sits beside Integrations: the three
    // are the ways data crosses out of bodo. Integrations push on a schedule, the API is
    // pulled, and a webhook is pushed the moment something happens.
    { kind: 'leaf', id: 'webhooks', label: 'Webhooks', href: at('/webhooks') },
  ]
}

/** Every leaf, flattened, so a caller does not have to walk the group. */
export function settingsNavLeaves(eventId: string): readonly SettingsNavLeaf[] {
  return settingsNav(eventId).flatMap((entry) =>
    entry.kind === 'group'
      ? entry.children
      : [{ id: entry.id, label: entry.label, href: entry.href }],
  )
}

/**
 * Which entry the current pathname selects.
 *
 * Longest matching href wins, so `/settings/fields` selects Fields rather than Overview,
 * whose href is a prefix of every other one. Exact match or a `/` boundary only: without
 * the boundary check `/settings/record-settings` would also match a hypothetical
 * `/settings/record`.
 */
export function activeSettingsId(pathname: string, eventId: string): string | undefined {
  const candidates = settingsNavLeaves(eventId).filter(
    (leaf) => pathname === leaf.href || pathname.startsWith(`${leaf.href}/`),
  )
  return candidates.sort((left, right) => right.href.length - left.href.length).at(0)?.id
}

/** True when the Library group holds the selection, so it renders expanded. */
export function isLibraryActive(pathname: string, eventId: string): boolean {
  const active = activeSettingsId(pathname, eventId)
  return active === 'fields' || active === 'tags'
}

/**
 * THE OUT-OF-SCOPE CARD IS GONE FROM SETTINGS, and so is the route that rendered it.
 *
 * This was a Map of URL segment to label, read by `settings/[section]/page.tsx`, which
 * showed a "Not part of this build" card naming the section an organizer had clicked. It
 * emptied one entry at a time and Record Settings was the last, removed on the owner's
 * instruction 2026-08-10:
 *
 *   - Portals (2026-08-09) became a real surface at `/admin/{id}/portals`, so the sub-nav
 *     points there and no URL reaches the card.
 *   - Personas and Email Themes (2026-08-09) lost their sub-nav entries outright.
 *   - Email Templates and Integrations were never here: both are real static segments that
 *     win over `[section]`, and an entry would have made the two routes disagree about
 *     whether the section exists.
 *
 * With the map empty the route could only ever `notFound()`, so `settings/[section]` was
 * deleted with it. That also fixes a defect the old comment recorded and accepted: a
 * `notFound()` from inside that page answered **HTTP 200 with the 404 body**, because
 * `../loading.tsx` is a Suspense boundary above it. An unmatched segment with no page at
 * all is refused by the router, before any boundary, and answers a real 404.
 *
 * The exported name is kept off deliberately rather than left as an empty Map: an empty
 * placeholder registry is an invitation to add a placeholder back.
 */
