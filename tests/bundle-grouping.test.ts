// `Group files by`, and the collision rule that keeps the archive honest.
//
// Two members with the same path make a zip that extracts one over the other with no error
// anywhere, so the suffixing is the part worth testing hardest. The grouping options are
// authored (the reference confirms the control and not its list, see grouping.ts), but what
// each one DOES with a folder is asserted here so it cannot drift.

import { describe, expect, it } from 'vitest'

import {
  BUNDLE_GROUPING_OPTIONS,
  bundleEntryPaths,
  DEFAULT_BUNDLE_GROUPING,
  type PlaceableFile,
  parseGrouping,
} from '@/features/bundle/grouping'

function placeable(over: Partial<PlaceableFile> & { id: string }): PlaceableFile {
  return {
    filename: 'deck.pdf',
    kind: 'slides',
    sessionLabel: 'SESS-1 Scaling Postgres',
    speakerLabel: 'Ana Ruiz',
    ...over,
  }
}

const paths = (files: readonly PlaceableFile[], grouping: Parameters<typeof bundleEntryPaths>[1]) =>
  bundleEntryPaths(files, grouping).map((entry) => entry.path)

describe('parseGrouping', () => {
  it('accepts every advertised option', () => {
    for (const option of BUNDLE_GROUPING_OPTIONS) {
      expect(parseGrouping(option.value)).toBe(option.value)
    }
  })

  it('falls back to the default for anything else, since it is a view knob', () => {
    expect(parseGrouping('by-vibes')).toBe(DEFAULT_BUNDLE_GROUPING)
    expect(parseGrouping(null)).toBe(DEFAULT_BUNDLE_GROUPING)
    expect(parseGrouping(undefined)).toBe(DEFAULT_BUNDLE_GROUPING)
  })

  it('defaults to session, which is how an organizer thinks about the list', () => {
    expect(DEFAULT_BUNDLE_GROUPING).toBe('session')
  })
})

describe('bundleEntryPaths folders', () => {
  const one = [placeable({ id: 'f-1' })]

  it('puts a file under its session by default', () => {
    expect(paths(one, 'session')).toEqual(['SESS-1 Scaling Postgres/deck.pdf'])
  })

  it('puts a file under its speaker', () => {
    expect(paths(one, 'speaker')).toEqual(['Ana Ruiz/deck.pdf'])
  })

  it('puts a file under a readable type folder rather than the raw kind', () => {
    expect(paths([placeable({ id: 'f-1', kind: 'headshot' })], 'type')).toEqual([
      'Headshots/deck.pdf',
    ])
    expect(paths([placeable({ id: 'f-1', kind: 'doc' })], 'type')).toEqual(['Documents/deck.pdf'])
  })

  it('files an unknown kind rather than dropping it', () => {
    expect(paths([placeable({ id: 'f-1', kind: 'mystery' })], 'type')).toEqual(['Other/deck.pdf'])
  })

  it('writes a flat archive for no folders', () => {
    expect(paths(one, 'none')).toEqual(['deck.pdf'])
  })

  it('names a folder for a file with no session', () => {
    expect(paths([placeable({ id: 'f-1', sessionLabel: '' })], 'session')).toEqual([
      'Unassigned/deck.pdf',
    ])
  })

  it('names a folder for a file whose speaker row is gone', () => {
    expect(paths([placeable({ id: 'f-1', speakerLabel: '   ' })], 'speaker')).toEqual([
      'Unknown speaker/deck.pdf',
    ])
  })
})

describe('bundleEntryPaths sanitisation', () => {
  it('strips a path separator out of a title so it cannot invent a folder', () => {
    expect(
      paths([placeable({ id: 'f-1', sessionLabel: 'SESS-1 A/B testing' })], 'session'),
    ).toEqual(['SESS-1 A-B testing/deck.pdf'])
  })

  it('cannot escape the archive with a traversal in the name', () => {
    const written = paths([placeable({ id: 'f-1', filename: '../../etc/passwd' })], 'none')

    expect(written).toEqual(['etc-passwd'])
    expect(written.at(0)).not.toContain('/')
  })

  it('replaces the characters Windows refuses in a filename', () => {
    expect(paths([placeable({ id: 'f-1', filename: 'q1:2026 <draft>.pdf' })], 'none')).toEqual([
      'q1-2026 -draft-.pdf',
    ])
  })

  it('removes control characters instead of writing them into a path', () => {
    expect(paths([placeable({ id: 'f-1', filename: 'de\u0001ck\u007f.pdf' })], 'none')).toEqual([
      'de ck .pdf',
    ])
  })

  it('drops a trailing dot, which Windows cannot create', () => {
    expect(paths([placeable({ id: 'f-1', sessionLabel: 'SESS-1 Recap...' })], 'session')).toEqual([
      'SESS-1 Recap/deck.pdf',
    ])
  })

  it('caps a very long session title', () => {
    const folder = paths(
      [placeable({ id: 'f-1', sessionLabel: `SESS-1 ${'long '.repeat(40)}` })],
      'session',
    )
      .at(0)
      ?.split('/')
      .at(0)

    expect(folder?.length).toBeLessThanOrEqual(80)
  })

  it('falls back rather than producing an empty name', () => {
    expect(paths([placeable({ id: 'f-1', filename: '///' })], 'none')).toEqual(['file'])
  })
})

describe('bundleEntryPaths collisions', () => {
  it('suffixes a duplicate name inside one folder, before the extension', () => {
    expect(
      paths(
        [placeable({ id: 'f-1' }), placeable({ id: 'f-2' }), placeable({ id: 'f-3' })],
        'session',
      ),
    ).toEqual([
      'SESS-1 Scaling Postgres/deck.pdf',
      'SESS-1 Scaling Postgres/deck (2).pdf',
      'SESS-1 Scaling Postgres/deck (3).pdf',
    ])
  })

  it('does not suffix the same name in two different folders', () => {
    expect(
      paths(
        [
          placeable({ id: 'f-1', sessionLabel: 'SESS-1 One' }),
          placeable({ id: 'f-2', sessionLabel: 'SESS-2 Two' }),
        ],
        'session',
      ),
    ).toEqual(['SESS-1 One/deck.pdf', 'SESS-2 Two/deck.pdf'])
  })

  it('collides under type where it did not under speaker', () => {
    const two = [
      placeable({
        id: 'f-1',
        kind: 'headshot',
        filename: 'headshot.png',
        speakerLabel: 'Ana Ruiz',
      }),
      placeable({ id: 'f-2', kind: 'headshot', filename: 'headshot.png', speakerLabel: 'Bo Chen' }),
    ]

    expect(paths(two, 'speaker')).toEqual(['Ana Ruiz/headshot.png', 'Bo Chen/headshot.png'])
    expect(paths(two, 'type')).toEqual(['Headshots/headshot.png', 'Headshots/headshot (2).png'])
  })

  it('does not hand two members the same path when a real name already looks suffixed', () => {
    const written = paths(
      [
        placeable({ id: 'f-1', filename: 'deck.pdf' }),
        placeable({ id: 'f-2', filename: 'deck (2).pdf' }),
        placeable({ id: 'f-3', filename: 'deck.pdf' }),
      ],
      'none',
    )

    expect(new Set(written).size).toBe(written.length)
    expect(written).toEqual(['deck.pdf', 'deck (2).pdf', 'deck (3).pdf'])
  })

  it('treats two names differing only in case as a collision, for a case-insensitive disk', () => {
    const written = paths(
      [
        placeable({ id: 'f-1', filename: 'Deck.pdf' }),
        placeable({ id: 'f-2', filename: 'deck.pdf' }),
      ],
      'none',
    )

    expect(written).toEqual(['Deck.pdf', 'deck (2).pdf'])
  })

  it('suffixes an extensionless name at the end', () => {
    expect(
      paths(
        [placeable({ id: 'f-1', filename: 'notes' }), placeable({ id: 'f-2', filename: 'notes' })],
        'none',
      ),
    ).toEqual(['notes', 'notes (2)'])
  })

  it('keeps the file id alongside its path, so the caller can find the object key', () => {
    expect(bundleEntryPaths([placeable({ id: 'f-42' })], 'none')).toEqual([
      { id: 'f-42', path: 'deck.pdf' },
    ])
  })

  it('produces nothing for nothing', () => {
    expect(bundleEntryPaths([], 'session')).toEqual([])
  })
})
