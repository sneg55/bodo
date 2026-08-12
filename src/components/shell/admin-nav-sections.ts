// The admin sidebar's blocks, as data. Split out of admin-nav.ts because that file was past
// the file-size budget with the nav inlined in it.
//
// FLAT, as of 2026-08-10. This file held `programTree`, one collapsible carrying fourteen of
// the nineteen destinations under four section headers, and the two trees before it (CRM,
// CMS) were flattened earlier the same day. Program went for a sharper reason than either:
// it declared `defaultOpen: true`, so the disclosure opened on first paint and every
// organizer left it open. A chevron that is always down is a control that costs a click to
// use and buys nothing, and it forced two levels of indentation on rows that have no parent
// worth naming. The section headers survive as block labels, so the grouping the reference
// draws is intact; what went is the container above them.
//
// Four defects went with it, all of them visible in one screenshot of the old sidebar:
//
//   1. TWO `Settings` ROWS, ONE URL. `Program > CONFIGURE > Settings` and the bottom block's
//      `Settings` were both `/admin/{id}/settings`, same label, same destination.
//   2. `Forms` AND `Files` EACH TWICE, unqualified. Nothing on the row said whether `Forms`
//      meant the submission form builder or the portal forms an assigned speaker fills in.
//      They are `Submission Forms`, `Portal Forms` and `Portal Files` now. `Submission
//      Forms` is not a coinage: it is already the label Event Settings uses for the same
//      route (features/settings/nav.ts), so the two navs agree instead of disagreeing.
//   3. A SECTION CALLED `PORTALS` CONTAINING AN ITEM CALLED `Portals`. The header is
//      `SPEAKER PORTAL` now, which is what the surface is called everywhere else.
//   4. `CONFIGURE` HELD EVENT-LEVEL SURFACES. Email history and Settings are not programme
//      surfaces; they sit in the EVENT block with Team, which is where an organizer looks
//      for what the system did rather than for the programme itself.
//
// ONE BLOCK PER SCOPE, as of the second pass the same day. The event chip at the top of the
// sidebar scopes everything under it, so a row that the chip does NOT re-point cannot sit in
// that run without lying about itself. The three CRM rows are exactly that row: they are the
// org's contact database across every event the viewer belongs to, they were in EVENT, and
// they are the ORGANIZATION block at the foot now. Their hrefs are the tell and they always
// were: no event id anywhere in them.
//
// Labels otherwise stay verbatim off docs/parity/abstracts-review.md and event-config.md.
// The departure from the reference's collapsible is recorded in both parity docs and pinned
// by tests/admin-nav.test.ts, so nobody matching a screenshot restores the chevron in good
// faith.

import {
  BookOpenIcon,
  BriefcaseIcon,
  CalendarDaysIcon,
  CalendarIcon,
  ChartNoAxesColumnIcon,
  ClipboardListIcon,
  ClipboardPenIcon,
  CodeXmlIcon,
  ContactRoundIcon,
  DoorOpenIcon,
  FileTextIcon,
  FileUpIcon,
  KanbanIcon,
  LayoutDashboardIcon,
  ListIcon,
  MailIcon,
  PaperclipIcon,
  ScrollTextIcon,
  SettingsIcon,
  StarIcon,
  UserCogIcon,
  UsersIcon,
} from 'lucide-react'

import { type AdminNavBlock, adminHref } from '@/components/shell/admin-nav-types'

export function eventNavBlocks(eventId: string): readonly AdminNavBlock[] {
  // No `stub` helper any more, and nothing to point one at: Portals was the last entry
  // reaching the out-of-scope card and it became a real route with BUILD_SPEC 5.0c. The card,
  // its route and `adminPlaceholderHref` were all deleted on 2026-08-10, once every entry
  // here resolved to something built. An entry that has to ship before its feature does gets
  // told so where it is rendered, the way the disabled items in the Add menus are.
  const at = (path: string) => adminHref(eventId, path)

  return [
    {
      id: 'primary',
      items: [{ id: 'dashboard', label: 'Dashboard', icon: LayoutDashboardIcon, href: at('') }],
    },
    {
      id: 'submissions',
      label: 'SUBMISSIONS',
      items: [
        // The three list entries are one table read through one scope each
        // (features/review/submission-scope.ts).
        { id: 'view-all', label: 'View All', icon: ListIcon, href: at('/submissions') },
        { id: 'abstracts', label: 'Abstracts', icon: ScrollTextIcon, href: at('/abstracts') },
        { id: 'sessions', label: 'Sessions', icon: CalendarIcon, href: at('/sessions') },
        // The roster of PEOPLE, beside the three lists of their submissions. Here rather
        // than beside the CRM because it is scoped to this event, while the CRM is the
        // org-level contact directory: a different set of people and a different surface.
        { id: 'speakers', label: 'Speakers', icon: UsersIcon, href: at('/speakers') },
        { id: 'submission-files', label: 'Files', icon: FileTextIcon, href: at('/files') },
        // Was `COLLECT & REVIEW > Forms`. That section is gone: it held Forms, Evaluation
        // and Agenda, and each one belonged with something else. Both of these are about
        // what comes IN, which is what this block is.
        { id: 'forms', label: 'Submission Forms', icon: ClipboardListIcon, href: at('/forms') },
        { id: 'evaluation', label: 'Evaluation', icon: StarIcon, href: at('/evaluation') },
      ],
    },
    {
      id: 'program',
      label: 'PROGRAM',
      items: [
        // What the accepted submissions BECOME: the schedule, and the embed of it that goes
        // on the event's own site. Two rows, so no disclosure.
        { id: 'agenda', label: 'Agenda', icon: CalendarDaysIcon, href: at('/agenda') },
        { id: 'cms-embeds', label: 'CMS Embeds', icon: CodeXmlIcon, href: at('/cms/embeds') },
      ],
    },
    {
      id: 'speaker-portal',
      label: 'SPEAKER PORTAL',
      items: [
        // `Portals` is the configuration surface and the rest is what an assigned speaker
        // finds inside one. The section used to be called PORTALS, which made the header and
        // one of its own children the same word.
        //
        // This is also the SAME href Event Settings > Portals uses (features/settings/nav.ts):
        // two entries over one set of rows is how they disagree about assignment order.
        { id: 'portals', label: 'Portals', icon: DoorOpenIcon, href: at('/portals') },
        { id: 'tasks', label: 'Tasks', icon: BriefcaseIcon, href: at('/tasks') },
        // A DIFFERENT ICON from Submission Forms, and the same for Portal Files below,
        // because the collapsed rail is icons only: with `ClipboardList` and `FileText` on
        // both members of each pair, the two halves of the rail were the same six glyphs
        // and only a tooltip told them apart. Checked on the running app, not inferred.
        {
          id: 'portal-forms',
          label: 'Portal Forms',
          icon: ClipboardPenIcon,
          href: at('/portal-forms'),
        },
        {
          id: 'file-requests',
          label: 'File Requests',
          icon: FileUpIcon,
          href: at('/file-requests'),
        },
        { id: 'resources', label: 'Resources', icon: BookOpenIcon, href: at('/resources') },
        // The two Files entries are one set, partitioned on whether the file is attached to
        // a submission (features/files/file-rows.ts). The labels say so now.
        {
          id: 'portal-files',
          label: 'Portal Files',
          icon: PaperclipIcon,
          href: at('/portal-files'),
        },
      ],
    },
    {
      id: 'event',
      label: 'EVENT',
      items: [
        // Real, not a placeholder: the notification recipient pickers and committee
        // assignment both need a set of people to pick from. BUILD_SPEC 5.0b is explicit
        // about the earlier draft's mistake.
        { id: 'event-team', label: 'Event Team', icon: UserCogIcon, href: at('/team') },
        {
          id: 'comms',
          label: 'Email history',
          icon: MailIcon,
          // The href matches the LABEL. It was `/comms`, so the one URL a person would
          // guess off this entry answered 404.
          href: at('/email-history'),
        },
        // The ONLY Settings row. There were two, both pointing here.
        { id: 'settings', label: 'Settings', icon: SettingsIcon, href: at('/settings') },
      ],
    },
    {
      id: 'organization',
      label: 'ORGANIZATION',
      // THE LAST BLOCK, AND THE ONLY ONE THE EVENT SWITCHER DOES NOT SCOPE. Every block
      // above it is a view of the one conference named in the chip at the top of the
      // sidebar, and switching events re-points every row in them. Nothing here moves: the
      // CRM is the org's contact database, spanning every event the viewer holds a
      // membership on.
      //
      // These three sat in EVENT until 2026-08-10, which said the opposite of what is true
      // of them, and the hrefs said so on the same screen: alone in the nav they carry no
      // event id. `/admin/crm` authorizes on the viewer's membership SET instead, so an id
      // in the href would be a lie about what the page reads. Split out on the owner's
      // instruction, one block per scope, with the global one last so the event-scoped run
      // is unbroken from the chip down.
      //
      // `ORGANIZATION` and not `CRM`: a header must not repeat one of its own rows, which
      // is the defect that renamed `PORTALS` (see the top of this file), and the block is
      // named for the SCOPE it draws, the way EVENT above it is.
      items: [
        // The label says `Speakers CRM` and not `CRM` because the row IS the destination:
        // it was a collapsible over a single `Speakers` child until 2026-08-10, and `CRM`
        // named a section rather than a page. Its saved lists are in the directory's own
        // toolbar, in the slot the reference gives a stored-query control (CrmDirectory.tsx).
        //
        // A distinct icon from `Speakers` in SUBMISSIONS, deliberately: that roster is this
        // event's assigned people and this is every contact the org has, so two surfaces
        // that read as the same row are two surfaces an organizer confuses.
        { id: 'crm', label: 'Speakers CRM', icon: ContactRoundIcon, href: '/admin/crm' },
        // The board over the same contacts, a SIBLING of the row above rather than a child,
        // because that row is a destination and not a container: a child under it would
        // re-create the chevron removed on 2026-08-10, over a section whose first item is
        // the page you are already on.
        //
        // `Sourcing Pipeline` rather than `Pipeline`, because this product also says
        // "pipeline" about the review funnel, and a second word costs nothing.
        {
          id: 'crm-pipeline',
          label: 'Sourcing Pipeline',
          icon: KanbanIcon,
          href: '/admin/crm/pipeline',
        },
        // The org-wide overview: counts by event, by pipeline stage and by tag, plus the
        // duplicate count. No per-event dashboard can answer any of them, because every
        // number on those is scoped to one conference, which is the same reason all three
        // of these rows are here rather than up there.
        //
        // Listing it HERE is what puts `CRM Dashboard` in the ⌘K palette, since
        // `nav-targets.ts` derives the palette from this tree. The evaluation found the
        // palette's whole navigation inventory had no entry for it, and a hand-maintained
        // second list is exactly what that module refuses to be.
        {
          id: 'crm-dashboard',
          label: 'CRM Dashboard',
          icon: ChartNoAxesColumnIcon,
          href: '/admin/crm/dashboard',
        },
      ],
    },
  ]
}
