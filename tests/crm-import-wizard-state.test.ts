import { describe, expect, it } from 'vitest'

import { ErrorIds } from '@/constants/errorIds'
import { IMPORT_ROW_CAP } from '@/features/crm/import/fields'
import { autoMapHeaders } from '@/features/crm/import/map-row'
import {
  completedImportSteps,
  IMPORT_STEPS,
  MAX_UPLOAD_BYTES,
  mapBlockers,
  previewBlockers,
  stepBlockers,
  uploadBlockers,
  uploadSizeMessage,
} from '@/features/crm/import/wizard-gates'
import {
  attemptIdAfter,
  type ColumnChoice,
  choicesFromMapping,
  chooseColumn,
  dispositions,
  fileRowNumber,
  IGNORE_COLUMN,
  mappingFromChoices,
  mapRows,
  previewCounts,
  retiresAttempt,
} from '@/features/crm/import/wizard-state'

describe('column choices', () => {
  const headers = ['Email', 'First Name', 'Favourite Colour']
  const initial = choicesFromMapping(headers, autoMapHeaders(headers))

  it('starts from what the auto-mapper guessed and ignores the rest', () => {
    expect(initial.get('Email')).toBe('email')
    expect(initial.get('First Name')).toBe('firstName')
    expect(initial.get('Favourite Colour')).toBe(IGNORE_COLUMN)
  })

  it('takes a field off the column that held it, rather than writing it twice', () => {
    const next = chooseColumn(initial, 'Favourite Colour', 'firstName')
    expect(next.get('Favourite Colour')).toBe('firstName')
    expect(next.get('First Name')).toBe(IGNORE_COLUMN)
  })

  it('lets several columns be ignored at once', () => {
    const next = chooseColumn(
      chooseColumn(initial, 'Email', IGNORE_COLUMN),
      'First Name',
      IGNORE_COLUMN,
    )
    expect([...mappingFromChoices(next)]).toEqual([])
  })

  it('leaves the other columns alone when a column is re-picked to what it already held', () => {
    const next = chooseColumn(initial, 'Email', 'email')
    expect(next.get('First Name')).toBe('firstName')
  })
})

describe('mapRows', () => {
  const mapping = mappingFromChoices(
    choicesFromMapping(['Email', 'First Name'], autoMapHeaders(['Email', 'First Name'])),
  )

  it('numbers rows from the file, where row 1 is the header', () => {
    expect(fileRowNumber(0)).toBe(2)
    const { rows } = mapRows([{ Email: 'ada@example.com', 'First Name': 'Ada' }], mapping)
    expect(rows[0]).toMatchObject({ rowNumber: 2, email: 'ada@example.com', firstName: 'Ada' })
  })

  it('keeps a bad row as a reject instead of discarding the good ones', () => {
    const { rows, rejected } = mapRows(
      [
        { Email: 'ada@example.com', 'First Name': 'Ada' },
        { Email: '', 'First Name': 'Nobody' },
        { Email: 'grace@example.com', 'First Name': 'Grace' },
      ],
      mapping,
    )
    expect(rows.map((row) => row.rowNumber)).toEqual([2, 4])
    expect(rejected).toEqual([{ rowNumber: 3, reason: 'Missing email' }])
  })
})

describe('blockers', () => {
  it('asks for a file before anything else', () => {
    expect(uploadBlockers(undefined)).toEqual(['Upload a file to import.'])
  })

  it('accepts a file at exactly the cap and refuses one over it', () => {
    expect(uploadBlockers({ rowCount: IMPORT_ROW_CAP })).toEqual([])
    const blockers = uploadBlockers({ rowCount: IMPORT_ROW_CAP + 1 })
    expect(blockers[0]).toContain(String(IMPORT_ROW_CAP + 1))
    expect(blockers[0]).toContain(String(IMPORT_ROW_CAP))
  })

  it('refuses a file with a header and no rows', () => {
    expect(uploadBlockers({ rowCount: 0 })).toHaveLength(1)
  })

  it('complains about a file too big to read into the tab, in MB', () => {
    expect(uploadSizeMessage(MAX_UPLOAD_BYTES)).toBeUndefined()
    expect(uploadSizeMessage(MAX_UPLOAD_BYTES + 1)).toContain('MB')
  })

  it('holds the mapping step until a column is pointed at Email', () => {
    const choices = choicesFromMapping(['Nickname'], autoMapHeaders(['Nickname']))
    expect(mapBlockers(choices)[0]).toContain('Email')
    expect(mapBlockers(chooseColumn(choices, 'Nickname', 'email'))).toEqual([])
  })

  it('does not ask for the optional fields', () => {
    const choices = choicesFromMapping(['Email'], autoMapHeaders(['Email']))
    expect(mapBlockers(choices)).toEqual([])
  })

  it('refuses to commit a file where every row was rejected', () => {
    expect(
      previewBlockers({ rows: [], rejected: [{ rowNumber: 2, reason: 'Missing email' }] }),
    ).toHaveLength(1)
    expect(previewBlockers({ rows: [{ rowNumber: 2, email: 'a@b.co' }], rejected: [] })).toEqual([])
  })
})

describe('dispositions', () => {
  const rows = [
    { rowNumber: 2, email: 'ada@example.com' },
    { rowNumber: 3, email: 'grace@example.com' },
    { rowNumber: 4, email: 'ADA@example.com' },
  ]

  it('reads a speaker id as an update and a row pointer as a repeat', () => {
    const shown = dispositions(
      rows,
      new Map([
        [3, 'spk1'],
        [4, 'row:2'],
      ]),
    )
    expect(shown).toEqual([
      { rowNumber: 2, email: 'ada@example.com', kind: 'create' },
      { rowNumber: 3, email: 'grace@example.com', kind: 'update' },
      { rowNumber: 4, email: 'ADA@example.com', kind: 'repeat', of: 2 },
    ])
    expect(previewCounts(shown)).toEqual({ create: 1, update: 1, repeat: 1 })
  })

  it('treats an unchecked file as all creates rather than as an error', () => {
    expect(previewCounts(dispositions(rows, new Map()))).toEqual({
      create: 3,
      update: 0,
      repeat: 0,
    })
  })
})

describe('retiresAttempt', () => {
  it('lets a genuine failure be retried under a new submission id', () => {
    expect(retiresAttempt(ErrorIds.DATA_RATE_LIMITED)).toBe(true)
    expect(retiresAttempt(ErrorIds.DATA_WRITE_FAIL)).toBe(true)
    expect(retiresAttempt(ErrorIds.AUTH_FORBIDDEN_ROLE)).toBe(true)
  })

  it('keeps the submission id when the claim guard is the one refusing', () => {
    // Regenerating here would hand the next press a key `claimOnce` has never seen, so the
    // second commit of one import would land: the guard would be re-armed against itself and
    // would only be covering the in-flight window the disabled button already covers.
    expect(retiresAttempt(ErrorIds.CRM_IMPORT_ALREADY_CLAIMED)).toBe(false)
  })
})

describe('attemptIdAfter', () => {
  // A counting mint, so "a new id" is checked by value rather than by trusting a stub.
  const minting = () => {
    let n = 0
    return () => {
      n += 1
      return `minted-${String(n)}`
    }
  }

  it('mints a new submission id for a newly picked file', () => {
    expect(attemptIdAfter({ kind: 'file' }, 'first', minting())).toBe('minted-1')
  })

  it('mints a new submission id for a genuine failure, and keeps it for the guard’s refusal', () => {
    const mint = minting()
    expect(
      attemptIdAfter({ kind: 'failure', errorId: ErrorIds.DATA_RATE_LIMITED }, 'x', mint),
    ).toBe('minted-1')
    expect(
      attemptIdAfter({ kind: 'failure', errorId: ErrorIds.CRM_IMPORT_ALREADY_CLAIMED }, 'x', mint),
    ).toBe('x')
  })

  it('gives a second file its own id even after the guard refused the first', () => {
    // The reported defect, as the sequence that produced it. File A imports; a press of
    // Import on file B goes out under A's id and the guard refuses it, correctly keeping the
    // id; picking file B is what has to retire it. Without the 'file' case, `second` is
    // `first` and every subsequent press repeats the refusal for the full claim TTL, under a
    // message ("This import has already been submitted") about a file nobody submitted.
    const mint = minting()
    const first = attemptIdAfter({ kind: 'file' }, 'at-mount', mint)
    const afterRefusal = attemptIdAfter(
      { kind: 'failure', errorId: ErrorIds.CRM_IMPORT_ALREADY_CLAIMED },
      first,
      mint,
    )
    const second = attemptIdAfter({ kind: 'file' }, afterRefusal, mint)

    expect(afterRefusal).toBe(first)
    expect(second).not.toBe(first)
  })
})

describe('IMPORT_STEPS', () => {
  it('is the four steps the wizard advertises, in order', () => {
    expect(IMPORT_STEPS.map((step) => step.id)).toEqual(['upload', 'map', 'preview', 'commit'])
  })
})

describe('the gate', () => {
  const headers = ['Email', 'First Name']
  const rows = [{ Email: 'a@example.com', 'First Name': 'Ada' }]
  const mapped = (choices: ReadonlyMap<string, ColumnChoice>) =>
    mapRows(rows, mappingFromChoices(choices))

  const emptyState = {
    parsed: undefined,
    choices: new Map<string, ColumnChoice>(),
    mapped: mapRows([], new Map()),
  }

  const goodChoices = choicesFromMapping(headers, autoMapHeaders(headers))
  const goodState = {
    parsed: { rowCount: rows.length },
    choices: goodChoices,
    mapped: mapped(goodChoices),
  }

  it('routes each step to its own rule, and the commit step gates nothing', () => {
    expect(stepBlockers('upload', emptyState)).toEqual(uploadBlockers(undefined))
    expect(stepBlockers('map', emptyState)).toEqual(mapBlockers(emptyState.choices))
    expect(stepBlockers('preview', emptyState)).toEqual(previewBlockers(emptyState.mapped))
    // Its control is the import itself; what stops it is the receipt, which is not a rule
    // about the file and so is not answerable here.
    expect(stepBlockers('commit', emptyState)).toEqual([])
  })

  it('completes nothing but the commit step before a file is chosen', () => {
    // Not the empty set: the commit step has no rule, so it is vacuously complete. What
    // keeps the organizer off it is that `canReachStep` also requires the three before it.
    expect([...completedImportSteps(emptyState)]).toEqual(['commit'])
  })

  it('completes every step once the file maps an email column', () => {
    expect([...completedImportSteps(goodState)]).toEqual(['upload', 'map', 'preview', 'commit'])
  })

  it('re-closes the steps after one that is edited back into an invalid state', () => {
    // The mapping is emptied while the file stays: `map` stops being complete, and because
    // `canReachStep` reads this set rather than a furthest-reached cursor, `preview` is shut
    // again rather than staying open on the strength of having been visited.
    const ignored = new Map<string, ColumnChoice>(
      headers.map((header) => [header, IGNORE_COLUMN] as const),
    )
    const broken = { parsed: { rowCount: rows.length }, choices: ignored, mapped: mapped(ignored) }

    const completed = completedImportSteps(broken)
    expect(completed.has('upload')).toBe(true)
    expect(completed.has('map')).toBe(false)
    expect(stepBlockers('map', broken).length).toBeGreaterThan(0)
  })
})
