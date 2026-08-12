// What the CRM's Server Actions authorize before they write.
//
// The scope, the reads and the mutations are all mocked, so what is under test is the thing
// no unit of pure logic can hold on its own: that every action recomputes the scope for
// itself, that a list is writable only by its owner, that the OWNER's id (not the caller's)
// is what reaches `deleteSpeakerList`, and that a speaker outside the caller's events cannot
// be tagged. Those are the rules `bodo-conventions.md` calls out and the ones a layout
// cannot enforce, because an action is reachable by POST without the layout ever rendering.

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { DataTableFilter } from '@/components/primitives/data-table-types'
import { AppError, ErrorIds } from '@/constants/errorIds'
import type { SpeakerList } from '@/types/domain'

/**
 * One real filter. Every save in here carries at least one, because a list that stores no
 * filters is refused: it would match the unfiltered directory and capture the default view.
 * The refusal itself is asserted below.
 */
const COMPANY: DataTableFilter = { id: 'f0', key: 'company', operator: 'contains', value: 'Acme' }

const mocks = vi.hoisted(() => ({
  requireCrmScope: vi.fn(),
  listSpeakerLists: vi.fn(),
  listSpeakersInEvents: vi.fn(),
  listSpeakerTags: vi.fn(),
  saveSpeakerList: vi.fn(),
  deleteSpeakerList: vi.fn(),
  setSpeakerTags: vi.fn(),
  createSpeakerTag: vi.fn(),
}))

vi.mock('@/features/crm/scope', () => ({ requireCrmScope: mocks.requireCrmScope }))

vi.mock('@/services/airtable/queries', () => ({
  listSpeakerLists: mocks.listSpeakerLists,
  listSpeakersInEvents: mocks.listSpeakersInEvents,
  listSpeakerTags: mocks.listSpeakerTags,
}))

vi.mock('@/services/airtable/mutations-crm', () => ({
  saveSpeakerList: mocks.saveSpeakerList,
  deleteSpeakerList: mocks.deleteSpeakerList,
  setSpeakerTags: mocks.setSpeakerTags,
  createSpeakerTag: mocks.createSpeakerTag,
}))

const {
  createSpeakerTagAction,
  deleteSpeakerListAction,
  saveSpeakerListAction,
  setSpeakerTagsAction,
} = await import('@/features/crm/actions')

const MINE: SpeakerList = {
  id: 'lst1',
  name: 'Keynotes',
  ownerId: 'usr1',
  isShared: false,
  filters: [],
}
const THEIRS_SHARED: SpeakerList = {
  id: 'lst2',
  name: 'Sponsors',
  ownerId: 'usr2',
  isShared: true,
  filters: [],
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset()
  mocks.requireCrmScope.mockResolvedValue({
    userId: 'usr1',
    eventIds: ['e1'],
    contextEventId: 'e1',
  })
  mocks.listSpeakerLists.mockResolvedValue([MINE, THEIRS_SHARED])
  mocks.listSpeakersInEvents.mockResolvedValue([{ speaker: { id: 'spk1' }, eventIds: ['e1'] }])
  mocks.listSpeakerTags.mockResolvedValue([{ id: 'tag1', name: 'Keynote', color: '#64748b' }])
  mocks.saveSpeakerList.mockImplementation((_origin: string, input: { name: string }) =>
    Promise.resolve({ ...MINE, name: input.name }),
  )
  mocks.deleteSpeakerList.mockResolvedValue(undefined)
  mocks.setSpeakerTags.mockResolvedValue(undefined)
  mocks.createSpeakerTag.mockResolvedValue({ id: 'tag9', name: 'New', color: '#ef4444' })
})

describe('saveSpeakerListAction', () => {
  it('recomputes the scope for itself rather than trusting a layout', async () => {
    await saveSpeakerListAction({ name: 'Workshops', isShared: false, filters: [COMPANY] })
    expect(mocks.requireCrmScope).toHaveBeenCalledTimes(1)
  })

  it('never takes the owner from the client: a create is owned by the caller', async () => {
    await saveSpeakerListAction({ name: 'Workshops', isShared: false, filters: [COMPANY] })
    expect(mocks.saveSpeakerList).toHaveBeenCalledWith(
      'action',
      expect.objectContaining({ ownerId: 'usr1', id: undefined }),
    )
  })

  it('refuses to overwrite a shared list somebody else owns', async () => {
    const result = await saveSpeakerListAction({
      id: THEIRS_SHARED.id,
      name: 'Renamed',
      isShared: true,
      filters: [COMPANY],
    })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.errorId).toBe(ErrorIds.DATA_RECORD_NOT_FOUND)
    expect(mocks.saveSpeakerList).not.toHaveBeenCalled()
  })

  it('refuses a duplicate name and does not write', async () => {
    const result = await saveSpeakerListAction({
      name: 'keynotes',
      isShared: false,
      filters: [COMPANY],
    })
    expect(result.ok).toBe(false)
    expect(mocks.saveSpeakerList).not.toHaveBeenCalled()
  })

  it('lets a list keep its own name while being renamed', async () => {
    const result = await saveSpeakerListAction({
      id: MINE.id,
      name: 'Keynotes',
      isShared: true,
      filters: [COMPANY],
    })
    expect(result.ok).toBe(true)
    expect(mocks.saveSpeakerList).toHaveBeenCalledWith(
      'action',
      expect.objectContaining({ id: 'lst1', ownerId: 'usr1', isShared: true }),
    )
  })

  it('sanitizes the filters it is handed before they reach a cell', async () => {
    await saveSpeakerListAction({
      name: 'Workshops',
      isShared: false,
      filters: [
        { id: 'junk', key: '', operator: 'is', value: 'x' },
        { id: 'junk2', key: 'company', operator: 'contains', value: 'Acme' },
      ],
    })
    expect(mocks.saveSpeakerList).toHaveBeenCalledWith(
      'action',
      expect.objectContaining({
        filters: [{ id: 'f0', key: 'company', operator: 'contains', value: 'Acme' }],
      }),
    )
  })

  it('refuses a list that stores no filters, because that list would capture the whole directory', async () => {
    const result = await saveSpeakerListAction({ name: 'Everyone', isShared: false, filters: [] })
    expect(result.ok).toBe(false)
    expect(mocks.saveSpeakerList).not.toHaveBeenCalled()
  })

  it('refuses a set whose filters are ALL dropped by sanitation, which is the same thing', async () => {
    const result = await saveSpeakerListAction({
      name: 'Everyone',
      isShared: false,
      filters: [{ id: 'junk', key: '', operator: 'is', value: 'x' }],
    })
    expect(result.ok).toBe(false)
    expect(mocks.saveSpeakerList).not.toHaveBeenCalled()
  })
})

describe('deleteSpeakerListAction', () => {
  it("passes the OWNER's id, which is what names the cache tag to expire", async () => {
    const result = await deleteSpeakerListAction({ listId: MINE.id })
    expect(result.ok).toBe(true)
    expect(mocks.deleteSpeakerList).toHaveBeenCalledWith('action', 'lst1', 'usr1')
  })

  it('refuses a shared list the caller does not own, since sharing grants read only', async () => {
    const result = await deleteSpeakerListAction({ listId: THEIRS_SHARED.id })
    expect(result.ok).toBe(false)
    expect(mocks.deleteSpeakerList).not.toHaveBeenCalled()
  })

  it('answers the same way for an id that does not exist as for one that is not yours', async () => {
    const missing = await deleteSpeakerListAction({ listId: 'nope' })
    const theirs = await deleteSpeakerListAction({ listId: THEIRS_SHARED.id })
    expect(missing.ok === false && missing.errorId).toBe(theirs.ok === false && theirs.errorId)
  })
})

describe('setSpeakerTagsAction', () => {
  it('writes the whole set for a speaker on one of the caller events', async () => {
    const result = await setSpeakerTagsAction({ speakerId: 'spk1', tagIds: ['tag1'] })
    expect(result.ok).toBe(true)
    expect(mocks.setSpeakerTags).toHaveBeenCalledWith('action', 'spk1', ['tag1'])
  })

  it('refuses a speaker reachable through no event the caller belongs to', async () => {
    const result = await setSpeakerTagsAction({ speakerId: 'spk-elsewhere', tagIds: ['tag1'] })
    expect(result.ok).toBe(false)
    expect(mocks.setSpeakerTags).not.toHaveBeenCalled()
  })

  it('refuses a tag the vocabulary no longer has rather than dropping it silently', async () => {
    const result = await setSpeakerTagsAction({ speakerId: 'spk1', tagIds: ['tag1', 'gone'] })
    expect(result.ok).toBe(false)
    expect(mocks.setSpeakerTags).not.toHaveBeenCalled()
  })

  it('accepts an empty set, which is how the last chip is removed', async () => {
    const result = await setSpeakerTagsAction({ speakerId: 'spk1', tagIds: [] })
    expect(result.ok).toBe(true)
    expect(mocks.setSpeakerTags).toHaveBeenCalledWith('action', 'spk1', [])
  })
})

describe('createSpeakerTagAction', () => {
  it('refuses a colour outside the palette', async () => {
    const result = await createSpeakerTagAction({ name: 'Workshop', color: 'red; url(x)' })
    expect(result.ok).toBe(false)
    expect(mocks.createSpeakerTag).not.toHaveBeenCalled()
  })

  it('refuses a name the global vocabulary already has', async () => {
    const result = await createSpeakerTagAction({ name: 'keynote' })
    expect(result.ok).toBe(false)
    expect(mocks.createSpeakerTag).not.toHaveBeenCalled()
  })

  it('picks a palette colour when the caller names none', async () => {
    const result = await createSpeakerTagAction({ name: 'Workshop' })
    expect(result.ok).toBe(true)
    expect(mocks.createSpeakerTag).toHaveBeenCalledWith(
      'action',
      expect.objectContaining({
        name: 'Workshop',
        color: expect.stringMatching(/^#[0-9a-f]{6}$/u),
      }),
    )
  })
})

// The one path a layout cannot cover, and the stated reason `actions.ts` exists: a Server
// Action is a POST endpoint reachable whether or not the layout ever rendered. Every action
// must recompute the scope and refuse for itself, and refuse WITHOUT writing.
//
// `requireCrmScope` rejects with `AUTH_FORBIDDEN_ROLE` for a signed-in user holding no
// membership, which is the same answer `requireEventRole` gives for an event that is not
// yours. It is an `AppError`, so `actionFailure` reports it rather than re-throwing.
describe('a caller the CRM scope refuses', () => {
  beforeEach(() => {
    mocks.requireCrmScope.mockRejectedValue(
      new AppError(ErrorIds.AUTH_FORBIDDEN_ROLE, 'no event membership'),
    )
  })

  it('cannot save a list', async () => {
    const result = await saveSpeakerListAction({ name: 'X', isShared: false, filters: [COMPANY] })
    expect(result.ok === false && result.errorId).toBe(ErrorIds.AUTH_FORBIDDEN_ROLE)
    expect(mocks.saveSpeakerList).not.toHaveBeenCalled()
    // Not even READ: the refusal lands before anybody's lists are fetched.
    expect(mocks.listSpeakerLists).not.toHaveBeenCalled()
  })

  it('cannot delete a list', async () => {
    const result = await deleteSpeakerListAction({ listId: MINE.id })
    expect(result.ok === false && result.errorId).toBe(ErrorIds.AUTH_FORBIDDEN_ROLE)
    expect(mocks.deleteSpeakerList).not.toHaveBeenCalled()
  })

  it('cannot tag a speaker', async () => {
    const result = await setSpeakerTagsAction({ speakerId: 'spk1', tagIds: ['tag1'] })
    expect(result.ok === false && result.errorId).toBe(ErrorIds.AUTH_FORBIDDEN_ROLE)
    expect(mocks.setSpeakerTags).not.toHaveBeenCalled()
    expect(mocks.listSpeakersInEvents).not.toHaveBeenCalled()
  })

  it('cannot add to the tag vocabulary', async () => {
    const result = await createSpeakerTagAction({ name: 'Workshop' })
    expect(result.ok === false && result.errorId).toBe(ErrorIds.AUTH_FORBIDDEN_ROLE)
    expect(mocks.createSpeakerTag).not.toHaveBeenCalled()
    expect(mocks.listSpeakerTags).not.toHaveBeenCalled()
  })
})
