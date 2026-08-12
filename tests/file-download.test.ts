// The filename that goes into a download's `content-disposition` header.
//
// A filename is one of the few strings a user controls end to end: it arrives from a file
// picker on somebody else's machine and lands inside a quoted header parameter. A double
// quote ends that parameter early, and a newline breaks the header entirely, which is how
// a response gets split. Neither needs a determined attacker to show up.

import { describe, expect, it } from 'vitest'

import { safeFilename } from '@/features/files/download'

describe('safeFilename', () => {
  it('leaves an ordinary filename alone, spaces and unicode included', () => {
    expect(safeFilename('Keynote Slides v2.pdf')).toBe('Keynote Slides v2.pdf')
    expect(safeFilename('Präsentation – 2026.pdf')).toBe('Präsentation – 2026.pdf')
  })

  it('strips a double quote, which would end the header parameter early', () => {
    expect(safeFilename('slides".pdf')).toBe('slides.pdf')
  })

  it('strips CR and LF, which would break the response into two', () => {
    expect(safeFilename('a\r\nContent-Length: 0\r\n\r\nevil.pdf')).toBe(
      'aContent-Length: 0evil.pdf',
    )
  })

  it('strips a backslash, so nothing can escape its way back out', () => {
    expect(safeFilename('slides\\".pdf')).toBe('slides.pdf')
  })

  it('falls back to a name rather than an empty parameter', () => {
    // An empty filename makes some browsers save the URL's last segment, which here is a
    // record id: the download arrives called `recAbc123` with no extension.
    expect(safeFilename('"""')).toBe('download')
    expect(safeFilename('   ')).toBe('download')
  })
})
