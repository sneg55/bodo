// The zip format's fixed records, and the CRC-32 that fills them in.
//
// Split out of zip.ts because that file crossed the 300 line limit, and split along the
// seam that was already there: everything here is a PURE byte layout with no streams and
// no I/O, which is also the half the tests can assert field by field. zip.ts is the state
// machine that emits these in order.
//
// Every field is little-endian. Sizes are 32-bit throughout, which zip.ts checks rather
// than assumes; per-member size cannot overflow independently because the upload cap is
// 25 MB (services/storage/upload-limits).

export const LOCAL_SIG = 0x04034b50
export const DESCRIPTOR_SIG = 0x08074b50
export const CENTRAL_SIG = 0x02014b50
export const EOCD_SIG = 0x06054b50

/** 2.0: the floor for a reader that understands a data descriptor. */
const VERSION = 20

/**
 * Version made by: high byte 3 (Unix), low byte the spec version above.
 *
 * The high byte is not cosmetic. It was 0 (MS-DOS / FAT) at first, and Info-ZIP responds to
 * that by transcoding every filename out of CP437 into the process charset, which mangled
 * an accented member name into `S+?ance` and then refused to create the file with "Illegal
 * byte sequence" on an archive `unzip -t` had just verified. Reproduced against
 * /usr/bin/unzip 6.00, and fixed by claiming Unix origin, which is what Info-ZIP's own
 * `zip` and Python's `zipfile` both write.
 */
const VERSION_MADE_BY = 0x0314

/**
 * External file attributes: a regular file, mode 0644, in the high 16 bits.
 *
 * Required by the Unix origin above rather than optional next to it. With the field left at
 * 0, Info-ZIP read the mode as 0000 and extracted every member unreadable, so the archive
 * verified and then produced files nobody could open. Reproduced as EACCES in
 * tests/bundle-zip-unzip.test.ts.
 */
const EXTERNAL_ATTRS = 0o100644 * 0x10000

/**
 * Bit 3 announces that the CRC and both sizes follow the member as a data descriptor
 * instead of preceding it, and bit 11 says the name is UTF-8.
 *
 * Bit 3 is the whole reason this writer can stream. A local file header wants the CRC-32
 * before the bytes, and the bytes are not readable twice without paying for a second R2
 * GET, so the local header carries zeroes and the real values follow (APPNOTE 4.3.9).
 * Writing a plausible-looking wrong CRC instead would produce an archive that opens and
 * then fails verification, which is worse than one that fails to open.
 */
export const FLAGS = 0x0008 | 0x0800

/** No compression. The payload is already-compressed PDF, PPTX and images. */
export const STORE = 0

/**
 * A fixed 1980-01-01 00:00 in DOS form, for every member.
 *
 * A real mtime would have to come from somewhere, and both candidates are worse than a
 * constant: the Files row's `uploadedAt` is when the speaker uploaded rather than when the
 * file was authored, and the clock at download time makes one selection produce a
 * different archive on every request. 1980-01-01 is the format's own epoch.
 */
const DOS_TIME = 0
const DOS_DATE = 0x0021

export const LOCAL_HEADER_BYTES = 30
export const DESCRIPTOR_BYTES = 16
export const CENTRAL_HEADER_BYTES = 46
export const EOCD_BYTES = 22
export const UINT16_MAX = 0xffff
export const UINT32_MAX = 0xffff_ffff

export const ZIP_NAMES = new TextEncoder()

/** The CRC-32 polynomial table, built once. A constant, not mutable module state. */
const CRC_TABLE = buildCrcTable()

function buildCrcTable(): Uint32Array {
  const values: number[] = []
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb8_8320 ^ (value >>> 1) : value >>> 1
    }
    values.push(value >>> 0)
  }
  return Uint32Array.from(values)
}

/**
 * CRC-32 (IEEE 802.3), resumable.
 *
 * `previous` is the value the call before it returned, so a member's checksum accumulates
 * chunk by chunk while the bytes stream past: `crc32(b, crc32(a))` equals the checksum of
 * `a` followed by `b`. That property is what makes the data descriptor possible at all.
 *
 * `.at()` rather than `table[i]`, and `for...of` rather than an index, because
 * `security/detect-object-injection` treats a computed read as an injection sink and its
 * warnings fail this build.
 */
export function crc32(bytes: Uint8Array, previous = 0): number {
  let crc = ~previous >>> 0
  for (const byte of bytes) {
    crc = (crc >>> 8) ^ (CRC_TABLE.at((crc ^ byte) & 0xff) ?? 0)
  }
  return ~crc >>> 0
}

/** A fixed-size record, filled in field order. */
function writer(size: number): {
  u16: (value: number) => void
  u32: (value: number) => void
  raw: (chunk: Uint8Array) => void
  done: () => Uint8Array
} {
  const out = new Uint8Array(size)
  const view = new DataView(out.buffer)
  let at = 0
  return {
    u16(value) {
      view.setUint16(at, value, true)
      at += 2
    },
    u32(value) {
      view.setUint32(at, value >>> 0, true)
      at += 4
    },
    raw(chunk) {
      out.set(chunk, at)
      at += chunk.length
    },
    done() {
      return out
    },
  }
}

export function localHeader(name: Uint8Array): Uint8Array {
  const out = writer(LOCAL_HEADER_BYTES + name.length)
  out.u32(LOCAL_SIG)
  out.u16(VERSION)
  out.u16(FLAGS)
  out.u16(STORE)
  out.u16(DOS_TIME)
  out.u16(DOS_DATE)
  // CRC and both sizes are unknown here on purpose. See FLAGS.
  out.u32(0)
  out.u32(0)
  out.u32(0)
  out.u16(name.length)
  out.u16(0)
  out.raw(name)
  return out.done()
}

export function dataDescriptor(crc: number, size: number): Uint8Array {
  const out = writer(DESCRIPTOR_BYTES)
  out.u32(DESCRIPTOR_SIG)
  out.u32(crc)
  out.u32(size)
  out.u32(size)
  return out.done()
}

export type ZipMember = {
  readonly name: Uint8Array
  readonly crc: number
  readonly size: number
  readonly headerOffset: number
}

export function centralHeader(member: ZipMember): Uint8Array {
  const out = writer(CENTRAL_HEADER_BYTES + member.name.length)
  out.u32(CENTRAL_SIG)
  // Version made by, then version needed to extract.
  out.u16(VERSION_MADE_BY)
  out.u16(VERSION)
  out.u16(FLAGS)
  out.u16(STORE)
  out.u16(DOS_TIME)
  out.u16(DOS_DATE)
  out.u32(member.crc)
  out.u32(member.size)
  out.u32(member.size)
  // Name, extra and comment lengths.
  out.u16(member.name.length)
  out.u16(0)
  out.u16(0)
  // Disk number start, internal attributes, external attributes.
  out.u16(0)
  out.u16(0)
  out.u32(EXTERNAL_ATTRS)
  out.u32(member.headerOffset)
  out.raw(member.name)
  return out.done()
}

export function endOfCentralDirectory(count: number, size: number, offset: number): Uint8Array {
  const out = writer(EOCD_BYTES)
  out.u32(EOCD_SIG)
  // This disk, and the disk the central directory starts on. Single-disk archive.
  out.u16(0)
  out.u16(0)
  out.u16(count)
  out.u16(count)
  out.u32(size)
  out.u32(offset)
  out.u16(0)
  return out.done()
}

/**
 * Refuse a selection classic zip cannot address, BEFORE anything is streamed.
 *
 * The writer checks the same two limits as it goes, and that was not enough on its own: those
 * checks run inside the generator, which is driven by the consumer reading the response body,
 * so an oversized selection had already been answered `200` with a `Content-Length` and had
 * potentially streamed gigabytes before the throw. What the client got was a truncated archive
 * with no central directory, which no reader can open and which reports no error to the caller.
 * Both numbers are known up front (`storedArchiveSize` is arithmetic), so the honest answer is a
 * 413 before the first byte. The writer keeps its own checks as a backstop for any caller that
 * does not preflight. Found by Codex review.
 *
 * The total bound covers every offset the archive records, since a member's local header offset
 * and the central directory's offset are both less than the total.
 */
export function assertClassicZipFits(
  count: number,
  totalBytes: number,
): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  if (count > UINT16_MAX) return { ok: false, reason: 'a zip holds at most 65535 members' }
  if (totalBytes > UINT32_MAX) {
    return {
      ok: false,
      reason: 'the archive is larger than a 32-bit zip can address; download a smaller selection',
    }
  }
  return { ok: true }
}

/**
 * The exact byte length a STORE archive of these members will have.
 *
 * Deterministic because nothing is compressed and every record has a fixed layout, which
 * is what lets a caller show a total before anything is streamed. Kept next to the record
 * builders rather than in the caller so the two cannot disagree about a header size.
 */
export function storedArchiveSize(
  members: readonly { readonly path: string; readonly size: number }[],
): number {
  let total = EOCD_BYTES
  for (const member of members) {
    const nameBytes = ZIP_NAMES.encode(member.path).length
    total += LOCAL_HEADER_BYTES + nameBytes + member.size + DESCRIPTOR_BYTES
    total += CENTRAL_HEADER_BYTES + nameBytes
  }
  return total
}
