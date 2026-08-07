/**
 * Tests for electronic signatures.
 *
 * The load-bearing property is canonicalisation: it must be DETERMINISTIC (or
 * an unchanged document falsely reports tampering) and UNAMBIGUOUS (or two
 * different documents hash the same, which is a forgery). Most of these prove
 * one of those two things.
 */
import { describe, it, expect } from 'vitest'
import {
  ATTESTATION,
  MAX_SIGNATURE_BYTES,
  type SignableField,
  type SignatureRecord,
  canonicalize,
  checkSignatureImage,
  hashContent,
  provenanceLine,
  signingBlockers,
  verifyIntegrity,
} from './signature'

const FIELDS: SignableField[] = [
  { label: 'Consignee', value: 'M&S Buckley Farms' },
  { label: 'Total value', value: '17,500.00 USD' },
  { label: 'Invoice number', value: 'INV-2026-014' },
]

// ═══════════════════════════════════════════════════════════════════════════
// Canonicalisation
// ═══════════════════════════════════════════════════════════════════════════

describe('canonicalize', () => {
  it('is stable regardless of field order', () => {
    // Without this, re-hashing an UNCHANGED document can report tampering
    // purely because the UI built the field list in a different order.
    const a = canonicalize('commercial-invoice', 'INV-1', FIELDS)
    const b = canonicalize('commercial-invoice', 'INV-1', [...FIELDS].reverse())
    expect(a).toBe(b)
  })

  it('changes when any value changes', () => {
    const a = canonicalize('commercial-invoice', 'INV-1', FIELDS)
    const b = canonicalize('commercial-invoice', 'INV-1', [
      ...FIELDS.slice(0, 1),
      { label: 'Total value', value: '17,500.01 USD' },
      ...FIELDS.slice(2),
    ])
    expect(a).not.toBe(b)
  })

  it('changes when the document kind changes', () => {
    expect(canonicalize('commercial-invoice', 'X', FIELDS)).not.toBe(canonicalize('cusma-certificate', 'X', FIELDS))
  })

  it('changes when the reference changes', () => {
    expect(canonicalize('k', 'INV-1', FIELDS)).not.toBe(canonicalize('k', 'INV-2', FIELDS))
  })

  it('cannot be forged by shifting a separator into a value', () => {
    // The reason values are length-prefixed. With naive `label=value` joining,
    // these two DIFFERENT documents would produce the same string.
    const a = canonicalize('k', 'r', [{ label: 'AB', value: 'C' }])
    const b = canonicalize('k', 'r', [{ label: 'A', value: 'BC' }])
    expect(a).not.toBe(b)
  })

  it('cannot be forged by embedding a newline in a value', () => {
    const a = canonicalize('k', 'r', [{ label: 'X', value: 'one\n5:Y=3:two' }])
    const b = canonicalize('k', 'r', [
      { label: 'X', value: 'one' },
      { label: 'Y', value: 'two' },
    ])
    expect(a).not.toBe(b)
  })

  it('distinguishes an empty value from a missing field', () => {
    const a = canonicalize('k', 'r', [{ label: 'Note', value: '' }])
    const b = canonicalize('k', 'r', [])
    expect(a).not.toBe(b)
  })
})

describe('hashContent', () => {
  it('produces a 64-char lowercase hex digest', async () => {
    const h = await hashContent('hello')
    expect(h).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is the real SHA-256', async () => {
    // Known vector — proves we're not hashing something else by accident.
    expect(await hashContent('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('differs for different input', async () => {
    expect(await hashContent('a')).not.toBe(await hashContent('b'))
  })
})

describe('verifyIntegrity', () => {
  it('passes for an unchanged document', async () => {
    const contentHash = (await hashContent(canonicalize('k', 'r', FIELDS)))!
    expect(await verifyIntegrity({ contentHash }, 'k', 'r', FIELDS)).toEqual({ intact: true })
  })

  it('passes even if the field order changed', async () => {
    const contentHash = (await hashContent(canonicalize('k', 'r', FIELDS)))!
    const r = await verifyIntegrity({ contentHash }, 'k', 'r', [...FIELDS].reverse())
    expect(r.intact).toBe(true)
  })

  it('FAILS when a value was edited after signing', async () => {
    const contentHash = (await hashContent(canonicalize('k', 'r', FIELDS)))!
    const tampered = [...FIELDS.slice(0, 2), { label: 'Invoice number', value: 'INV-9999' }]
    const r = await verifyIntegrity({ contentHash }, 'k', 'r', tampered)
    expect(r.intact).toBe(false)
    expect(r.reason).toContain('changed since it was signed')
  })

  it('FAILS when a field was removed', async () => {
    const contentHash = (await hashContent(canonicalize('k', 'r', FIELDS)))!
    expect((await verifyIntegrity({ contentHash }, 'k', 'r', FIELDS.slice(1))).intact).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Images
// ═══════════════════════════════════════════════════════════════════════════

describe('checkSignatureImage', () => {
  it('accepts a reasonable PNG', () => {
    expect(checkSignatureImage({ type: 'image/png', size: 40_000 })).toBeNull()
  })

  it('accepts a photographed signature', () => {
    expect(checkSignatureImage({ type: 'image/jpeg', size: 80_000 })).toBeNull()
  })

  it('rejects a PDF', () => {
    expect(checkSignatureImage({ type: 'application/pdf', size: 1000 })?.message).toContain('PNG')
  })

  it('rejects an oversized image and says how big it is', () => {
    const p = checkSignatureImage({ type: 'image/png', size: MAX_SIGNATURE_BYTES + 1 })
    expect(p?.message).toContain('KB')
  })

  it('rejects an empty file', () => {
    expect(checkSignatureImage({ type: 'image/png', size: 0 })?.message).toContain('empty')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Readiness
// ═══════════════════════════════════════════════════════════════════════════

describe('signingBlockers', () => {
  const ok = { documentReady: true, hasSignatureImage: true, signerTitle: 'Owner', alreadySigned: false }

  it('is empty when everything is in place', () => {
    expect(signingBlockers(ok)).toEqual([])
  })

  it('BLOCKS signing an incomplete document', () => {
    // Signing attests the content is true and complete. A CUSMA certification
    // missing an origin criterion is neither.
    const b = signingBlockers({ ...ok, documentReady: false })
    expect(b[0].message).toContain('true and complete')
  })

  it('BLOCKS without a signature image', () => {
    expect(signingBlockers({ ...ok, hasSignatureImage: false })[0].message).toContain('Account')
  })

  it('BLOCKS without a title', () => {
    expect(signingBlockers({ ...ok, signerTitle: '  ' })[0].message).toContain('title')
  })

  it('BLOCKS re-signing', () => {
    expect(signingBlockers({ ...ok, alreadySigned: true })[0].message).toContain('already been signed')
  })

  it('reports every blocker at once', () => {
    expect(
      signingBlockers({ documentReady: false, hasSignatureImage: false, signerTitle: '', alreadySigned: false }),
    ).toHaveLength(3)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Provenance
// ═══════════════════════════════════════════════════════════════════════════

describe('provenanceLine', () => {
  const record: SignatureRecord = {
    documentKind: 'cusma-certificate',
    documentId: 'o1',
    documentRef: 'INV-2026-014',
    signerId: 'u1',
    signerName: 'Tyler Torrie',
    signerEmail: 'tyler.torrie@gmail.com',
    signerTitle: 'Owner',
    signedAt: '2026-08-06T18:30:00Z',
    contentHash: 'a'.repeat(64),
    attestation: ATTESTATION,
    ipAddress: '198.51.100.4',
    userAgent: 'Mozilla/5.0',
  }

  it('names the signer, their title, and when — in Alberta time', () => {
    const line = provenanceLine(record)
    expect(line).toContain('Tyler Torrie')
    expect(line).toContain('tyler.torrie@gmail.com')
    expect(line).toContain('Owner')
    // 18:30 UTC is 12:30 in Edmonton during summer.
    expect(line).toContain('12:30')
  })

  it('includes a hash prefix so the record can be tied to the document', () => {
    expect(provenanceLine(record)).toContain('aaaaaaaaaaaaaaaa')
  })

  it("omits the title cleanly when there is none", () => {
    expect(provenanceLine({ ...record, signerTitle: '' })).not.toContain(', on ')
  })
})

describe('ATTESTATION', () => {
  it('states intent, review, and equivalence to a handwritten signature', () => {
    // These three are what make it an intentional act rather than a click.
    expect(ATTESTATION).toContain('electronically signing')
    expect(ATTESTATION).toContain('reviewed')
    expect(ATTESTATION).toContain('handwritten signature')
  })
})
