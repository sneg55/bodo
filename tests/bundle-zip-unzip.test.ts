// The archive, opened by a real unzip.
//
// This is the test that decides whether the feature works, because "a zip no tool can
// open" is its failure mode and only an actual reader can rule that out. `unzip -t`
// recomputes the CRC of every member and compares it against what the archive claims,
// which is exactly the field a streaming writer gets wrong; `unzip -p` proves the bytes
// come back; `zipinfo -v` proves nothing was silently deflated.
//
// Skipped, loudly, when Info-ZIP is absent. The layout suite next door still covers the
// record fields, so the suite degrades rather than passing on nothing.

import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { build, hasUnzip, source, tempDirectory, writeArchive } from './bundle-zip-fixtures'

const NO_ERRORS = 'No errors detected'

describe.skipIf(!hasUnzip())('a real unzip accepts the archive', () => {
  const files = new Map([
    ['Session A - Scaling Postgres/deck.pdf', 'PDF-ish bytes for the deck'],
    ['Session A - Scaling Postgres/notes (2).pdf', ''],
    ['Session B/Ana Ruiz - headshot.png', 'x'.repeat(9_000)],
    ['top-level.txt', 'no folder for this one'],
  ])

  /** Chunked at 3, so every member's CRC has to survive being accumulated in pieces. */
  async function archivePath(): Promise<string> {
    return writeArchive(
      'bundle.zip',
      await build([...files].map(([path, body]) => source(path, body, 3))),
    )
  }

  it('passes unzip -t, which verifies every member crc', async () => {
    const output = execFileSync('unzip', ['-t', await archivePath()], { encoding: 'utf8' })
    expect(output).toContain(NO_ERRORS)
    for (const path of files.keys()) {
      expect(output).toContain(path)
    }
  })

  it('extracts each member byte for byte', async () => {
    const path = await archivePath()
    for (const [name, body] of files) {
      expect(execFileSync('unzip', ['-p', path, name], { encoding: 'utf8' })).toBe(body)
    }
  })

  it('reports every member as stored, so nothing was silently deflated', async () => {
    const output = execFileSync('zipinfo', ['-v', await archivePath()], { encoding: 'utf8' })
    expect(output).toContain('none (stored)')
    expect(output).not.toContain('deflated')
  })

  // Extracted into a directory rather than matched with `unzip -p <name>`, because Info-ZIP
  // translates a non-ASCII pattern through the shell locale before comparing and then
  // reports "filename not matched" for an archive it has just verified. The extract proves
  // the same round trip without going through its glob matcher.
  it('keeps a UTF-8 filename readable through a real extract', async () => {
    const name = 'Séance/Björk - résumé.pdf'
    const path = writeArchive('accents.zip', await build([source(name, 'accented')]))
    expect(execFileSync('unzip', ['-t', path], { encoding: 'utf8' })).toContain(NO_ERRORS)

    const into = tempDirectory()
    // A UTF-8 locale has to be handed over explicitly. Info-ZIP transcodes the name out of
    // the archive into the process charset, and a vitest child inherits no LANG, so in the
    // C locale it rewrites the name into question marks and then refuses its own output
    // with "Illegal byte sequence" on an archive it verified a line earlier.
    execFileSync('unzip', ['-qq', '-o', path, '-d', into], {
      env: { ...process.env, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' },
    })
    const written = readdirSync(into, { recursive: true, encoding: 'utf8' })

    expect(written.map((entry) => entry.normalize('NFC'))).toContain(name)
    expect(readFileSync(join(into, name), 'utf8')).toBe('accented')
  })

  it('verifies an archive whose only member is empty', async () => {
    const path = writeArchive('empty-member.zip', await build([source('nothing.txt', '')]))
    expect(execFileSync('unzip', ['-t', path], { encoding: 'utf8' })).toContain(NO_ERRORS)
  })

  it('verifies a member large enough to arrive in many chunks', async () => {
    const body = 'abcdefghij'.repeat(50_000)
    const path = writeArchive('large.zip', await build([source('big/deck.pdf', body, 64)]))
    expect(execFileSync('unzip', ['-t', path], { encoding: 'utf8' })).toContain(NO_ERRORS)
    expect(execFileSync('unzip', ['-p', path, 'big/deck.pdf'], { encoding: 'utf8' }).length).toBe(
      body.length,
    )
  })
})
