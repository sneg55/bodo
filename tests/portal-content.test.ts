import { describe, expect, it } from 'vitest'
import type { PortalContentRow, PortalContentSources } from '@/features/portal-config/content'
import { buildPortalContent, denseOrder, isExposed } from '@/features/portal-config/content'
import type { Portal } from '@/types/portals'
import type { PortalItem, Resource } from '@/types/resources'

import { fileRequest, form, task } from './helpers/portal-fakes'

const EVENT = 'recEvent1'
const OTHER_EVENT = 'recEvent2'

const DEFAULT_PORTAL: Portal = {
  id: 'recDefault',
  eventId: EVENT,
  name: 'Speaker Portal',
  kind: 'contacts',
  isDefault: true,
  order: 0,
  filters: { contactTypes: [], rules: [] },
  alwaysShowTasks: false,
  manageProfile: false,
}

const CUSTOM_PORTAL: Portal = { ...DEFAULT_PORTAL, id: 'recCustom', isDefault: false, order: 1 }

function resource(over: Partial<Resource> & { id: string }): Resource {
  return { eventId: EVENT, title: over.id, slug: over.id, visibility: 'portal', order: 0, ...over }
}

function item(
  over: Partial<PortalItem> & { id: string; itemType: PortalItem['itemType'] },
): PortalItem {
  return { eventId: EVENT, portalId: DEFAULT_PORTAL.id, enabled: true, order: 0, ...over }
}

function sources(over: Partial<PortalContentSources> = {}): PortalContentSources {
  return { tasks: [], forms: [], fileRequests: [], resources: [], ...over }
}

describe('isExposed', () => {
  it('hides a resource with no row, because that is a draft', () => {
    expect(isExposed('resource', undefined)).toBe(false)
  })

  it('shows a task, form and file request with no row, because absence is the old default', () => {
    // Every event in the base has assignments and zero PortalItems rows for these three,
    // so the other reading would empty every existing portal the moment the page shipped.
    expect(isExposed('task', undefined)).toBe(true)
    expect(isExposed('form', undefined)).toBe(true)
    expect(isExposed('file_request', undefined)).toBe(true)
  })

  it('lets a present row answer for itself, in both directions and for every kind', () => {
    expect(isExposed('resource', item({ id: 'i1', itemType: 'resource' }))).toBe(true)
    expect(isExposed('task', item({ id: 'i2', itemType: 'task', enabled: false }))).toBe(false)
  })
})

describe('buildPortalContent', () => {
  it('lists every surface on the event with its exposure resolved', () => {
    const content = buildPortalContent(
      DEFAULT_PORTAL,
      sources({
        tasks: [task({ id: 'recTaskA', title: 'Upload slides' })],
        forms: [form({ id: 'recFormA', kind: 'task', name: 'Speaker details' })],
        fileRequests: [fileRequest({ id: 'recReqA', title: 'Headshot' })],
        resources: [resource({ id: 'recResA', title: 'Venue' })],
      }),
      [],
    )

    expect(content.task.map((row) => [row.itemId, row.enabled])).toEqual([['recTaskA', true]])
    expect(content.form.map((row) => [row.itemId, row.enabled])).toEqual([['recFormA', true]])
    expect(content.file_request.map((row) => [row.itemId, row.enabled])).toEqual([
      ['recReqA', true],
    ])
    // The resource is the asymmetric one: listed for the editor, switched off for speakers.
    expect(content.resource.map((row) => [row.itemId, row.enabled])).toEqual([['recResA', false]])
  })

  it('attaches the portal row and takes the enabled flag from it', () => {
    const row = item({ id: 'recItem1', itemType: 'task', taskId: 'recTaskA', enabled: false })

    const content = buildPortalContent(
      DEFAULT_PORTAL,
      sources({ tasks: [task({ id: 'recTaskA' })] }),
      [row],
    )

    expect(content.task[0]?.item).toBe(row)
    expect(content.task[0]?.enabled).toBe(false)
  })

  it('takes the title from whichever column the kind calls it', () => {
    const content = buildPortalContent(
      DEFAULT_PORTAL,
      sources({ forms: [form({ id: 'recFormA', kind: 'task', name: 'Speaker details' })] }),
      [],
    )

    expect(content.form[0]?.title).toBe('Speaker details')
  })

  it('leaves CFP forms off the portal entirely', () => {
    const content = buildPortalContent(
      DEFAULT_PORTAL,
      sources({ forms: [form({ id: 'recCfp', kind: 'cfp' })] }),
      [],
    )

    expect(content.form).toEqual([])
  })

  it('ignores a source record belonging to another conference', () => {
    const content = buildPortalContent(
      DEFAULT_PORTAL,
      sources({ tasks: [task({ id: 'recTaskX', eventId: OTHER_EVENT })] }),
      [],
    )

    expect(content.task).toEqual([])
  })

  it('ignores a portal item belonging to another conference', () => {
    const foreign = item({
      id: 'recItemX',
      itemType: 'task',
      taskId: 'recTaskA',
      eventId: OTHER_EVENT,
      enabled: false,
    })

    const content = buildPortalContent(
      DEFAULT_PORTAL,
      sources({ tasks: [task({ id: 'recTaskA' })] }),
      [foreign],
    )

    // The foreign row cannot switch this portal's task off, so the absence default stands.
    expect(content.task[0]?.item).toBeUndefined()
    expect(content.task[0]?.enabled).toBe(true)
  })

  it('ignores a row written for a different portal on the same event', () => {
    const elsewhere = item({
      id: 'recItemY',
      itemType: 'resource',
      resourceId: 'recResA',
      portalId: CUSTOM_PORTAL.id,
    })

    const content = buildPortalContent(
      DEFAULT_PORTAL,
      sources({ resources: [resource({ id: 'recResA' })] }),
      [elsewhere],
    )

    expect(content.resource[0]?.enabled).toBe(false)
  })

  it('reads a row with no portal link as belonging to the default portal', () => {
    const migrated = item({
      id: 'recItemZ',
      itemType: 'resource',
      resourceId: 'recResA',
      portalId: undefined,
    })
    const both = sources({ resources: [resource({ id: 'recResA' })] })

    expect(buildPortalContent(DEFAULT_PORTAL, both, [migrated]).resource[0]?.enabled).toBe(true)
    // And it must not leak into a custom portal, which has never been given that resource.
    expect(buildPortalContent(CUSTOM_PORTAL, both, [migrated]).resource[0]?.enabled).toBe(false)
  })

  it('ignores a row whose itemType disagrees with the link it carries', () => {
    const crossed = item({ id: 'recItemW', itemType: 'task', resourceId: 'recResA' })

    const content = buildPortalContent(
      DEFAULT_PORTAL,
      sources({ resources: [resource({ id: 'recResA' })] }),
      [crossed],
    )

    expect(content.resource[0]?.item).toBeUndefined()
  })

  it('sorts on order, then title, then id', () => {
    const content = buildPortalContent(
      DEFAULT_PORTAL,
      sources({
        tasks: [
          task({ id: 'recTaskC', title: 'Bio' }),
          task({ id: 'recTaskB', title: 'Bio' }),
          task({ id: 'recTaskA', title: 'Slides' }),
        ],
      }),
      [
        item({ id: 'i1', itemType: 'task', taskId: 'recTaskA', order: 0 }),
        item({ id: 'i2', itemType: 'task', taskId: 'recTaskB', order: 1 }),
        item({ id: 'i3', itemType: 'task', taskId: 'recTaskC', order: 1 }),
      ],
    )

    expect(content.task.map((row) => row.itemId)).toEqual(['recTaskA', 'recTaskB', 'recTaskC'])
  })

  it('puts an untouched row after every row an organizer has ordered', () => {
    const content = buildPortalContent(
      DEFAULT_PORTAL,
      sources({
        tasks: [task({ id: 'recTaskNew', title: 'Aaa' }), task({ id: 'recTaskOld', title: 'Zzz' })],
      }),
      [item({ id: 'i1', itemType: 'task', taskId: 'recTaskOld', order: 3 })],
    )

    expect(content.task.map((row) => row.itemId)).toEqual(['recTaskOld', 'recTaskNew'])
  })

  it('falls back to a resource own order when it has no portal row', () => {
    const content = buildPortalContent(
      DEFAULT_PORTAL,
      sources({
        resources: [
          resource({ id: 'recResB', title: 'Aaa', order: 2 }),
          resource({ id: 'recResA', title: 'Zzz', order: 1 }),
        ],
      }),
      [],
    )

    expect(content.resource.map((row) => row.itemId)).toEqual(['recResA', 'recResB'])
  })
})

describe('denseOrder', () => {
  const rows: readonly PortalContentRow[] = [
    { itemType: 'task', itemId: 'recC', title: 'C', enabled: true, order: 7 },
    { itemType: 'task', itemId: 'recA', title: 'A', enabled: true, order: 7 },
    { itemType: 'task', itemId: 'recB', title: 'B', enabled: false, order: 2 },
  ]

  it('renumbers from 0 so a drag cannot leave a tie behind', () => {
    expect(denseOrder(rows).map((row) => row.order)).toEqual([0, 1, 2])
  })

  it('keeps the order the drag left, rather than re-sorting on the stale numbers', () => {
    expect(denseOrder(rows).map((row) => row.itemId)).toEqual(['recC', 'recA', 'recB'])
  })

  it('changes nothing else about a row', () => {
    expect(denseOrder(rows)[2]).toEqual({ ...rows[2], order: 2 })
  })
})

describe('a duplicate (portal, item) pair', () => {
  // Airtable has no unique index, so two rows for one pair is a state the base can hold
  // even though the editor never writes it. Found by review: resolving it by argument
  // order made a surface visible or hidden according to Airtable's pagination order.
  const sources: PortalContentSources = {
    tasks: [task({ id: 'recTask1', eventId: EVENT, title: 'Upload slides' })],
    forms: [],
    fileRequests: [],
    resources: [],
  }

  const older: PortalItem = {
    id: 'recItemA',
    eventId: EVENT,
    portalId: DEFAULT_PORTAL.id,
    itemType: 'task',
    taskId: 'recTask1',
    enabled: true,
    order: 0,
  }
  const newer: PortalItem = { ...older, id: 'recItemB', enabled: false, order: 9 }

  it('resolves to the lowest record id whichever way round the rows arrive', () => {
    const forwards = buildPortalContent(DEFAULT_PORTAL, sources, [older, newer]).task.at(0)
    const backwards = buildPortalContent(DEFAULT_PORTAL, sources, [newer, older]).task.at(0)

    expect(forwards?.item?.id).toBe('recItemA')
    expect(backwards?.item?.id).toBe('recItemA')
    expect(forwards?.enabled).toBe(backwards?.enabled)
    expect(forwards?.order).toBe(backwards?.order)
  })
})
