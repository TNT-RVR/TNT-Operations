/**
 * Electronic signatures: what gets recorded, and what makes the record hold up.
 * Pure functions — no React, no DB, no network.
 *
 * ── What an electronic signature actually needs ──────────────────────────────
 *
 * Canada's federal PIPEDA and Alberta's Electronic Transactions Act, and the US
 * ESIGN Act and UETA, all converge on the same evidentiary requirements. An
 * image of a signature satisfies none of them on its own — a PNG pasted onto a
 * PDF proves nothing about who put it there or when. What matters is:
 *
 *   1. INTENT     the signer took a deliberate act meaning "I am signing this",
 *                 distinct from merely viewing or sending it.
 *   2. ATTRIBUTION evidence tying the act to a specific person.
 *   3. INTEGRITY  proof the document has not changed since it was signed.
 *   4. RETENTION  the record can be reproduced later, intact.
 *
 * So the checkbox is not UI decoration — it IS the signature. The image is
 * decoration. This module builds the record that carries 1–4.
 *
 * ── Integrity is the one most implementations skip ───────────────────────────
 *
 * Without a hash of what was signed, a signature record proves someone clicked
 * a box on a document that may since have been edited — which is worse than no
 * record, because it looks like proof. `canonicalize` produces a stable string
 * of the signed content; the caller hashes it and stores the digest. Re-hashing
 * later and comparing is what detects tampering.
 *
 * ── Not legal advice ─────────────────────────────────────────────────────────
 *
 * This implements the recognised technical requirements. Whether a particular
 * document is validly signed this way depends on the document and the
 * jurisdiction — some instruments (wills, land transfers, certain notarised
 * forms) are excluded from electronic signing entirely. CUSMA certifications
 * and commercial invoices are not. Have counsel confirm anything unusual.
 */

/** The act the signer is agreeing to. Stored verbatim on every record. */
export const ATTESTATION =
  'By checking this box I am electronically signing this document. I confirm that I have reviewed it, ' +
  'that the information in it is true and complete to the best of my knowledge, and I intend this ' +
  'electronic signature to have the same legal effect as my handwritten signature.'

/** What was signed, and by whom. */
export interface SignatureRecord {
  /** Which document — 'commercial-invoice', 'cusma-certificate', … */
  documentKind: string
  /** The document's id in this app. */
  documentId: string
  /** Human-readable identifier printed on the document, e.g. 'INV-2026-014'. */
  documentRef: string

  signerId: string
  signerName: string
  signerEmail: string
  /** The signer's stated role at the time, e.g. 'Owner'. */
  signerTitle: string

  /** ISO UTC, from the SERVER. See `serverTimeRequired` below. */
  signedAt: string
  /** SHA-256 of `canonicalize(...)`, lowercase hex. */
  contentHash: string
  /** The exact wording agreed to, so a later change to ATTESTATION can't rewrite history. */
  attestation: string

  /** Best-effort environment evidence. Neither is proof of identity on its own. */
  ipAddress: string | null
  userAgent: string | null
}

/**
 * The timestamp MUST come from the server.
 *
 * A browser clock is set by the user and can say anything. A signature dated by
 * the signer's own machine is worth very little as evidence, so the database
 * default (`now()`) is the source and the client never supplies one.
 */
export const serverTimeRequired = true as const

// ═══════════════════════════════════════════════════════════════════════════
// Canonicalisation
// ═══════════════════════════════════════════════════════════════════════════

/** A field/value pair as it appears on the document being signed. */
export interface SignableField {
  label: string
  value: string
}

/**
 * A stable string representing exactly what was signed.
 *
 * Two properties matter and both are easy to get wrong:
 *
 *  - DETERMINISTIC. The same document must produce the same string every time,
 *    regardless of object key order or how the UI happened to build it. Fields
 *    are therefore sorted by label. Without this, re-hashing a genuinely
 *    unchanged document can report tampering.
 *  - UNAMBIGUOUS. Values are length-prefixed, so a field `("AB", "C")` cannot
 *    hash the same as `("A", "BC")`. Naive concatenation with a separator is
 *    forgeable by moving the separator into a value.
 */
export function canonicalize(kind: string, ref: string, fields: readonly SignableField[]): string {
  const sorted = [...fields].sort((a, b) => a.label.localeCompare(b.label))
  const parts = [`kind:${kind.length}:${kind}`, `ref:${ref.length}:${ref}`]
  for (const f of sorted) {
    parts.push(`${f.label.length}:${f.label}=${f.value.length}:${f.value}`)
  }
  return parts.join('\n')
}

/**
 * SHA-256 of a canonical string, lowercase hex.
 *
 * Uses Web Crypto, which needs a secure context — HTTPS or localhost. Returns
 * null rather than a weak fallback where it isn't available: a hash that isn't
 * cryptographic gives false assurance, and no hash at all is the honest answer.
 */
export async function hashContent(canonical: string): Promise<string | null> {
  const c = globalThis.crypto
  if (!c?.subtle) return null
  const bytes = new TextEncoder().encode(canonical)
  const digest = await c.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Whether a document still matches the hash recorded when it was signed. */
export async function verifyIntegrity(
  record: Pick<SignatureRecord, 'contentHash'>,
  kind: string,
  ref: string,
  fields: readonly SignableField[],
): Promise<{ intact: boolean; reason?: string }> {
  const hash = await hashContent(canonicalize(kind, ref, fields))
  if (!hash) return { intact: false, reason: 'Cannot verify — cryptographic hashing is unavailable here.' }
  if (hash !== record.contentHash) {
    return { intact: false, reason: 'This document has changed since it was signed.' }
  }
  return { intact: true }
}

// ═══════════════════════════════════════════════════════════════════════════
// Signature images
// ═══════════════════════════════════════════════════════════════════════════

/** Signature images are stored inline, so they need a hard ceiling. */
export const MAX_SIGNATURE_BYTES = 256 * 1024
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp']

export interface ImageProblem {
  message: string
}

/**
 * Whether an uploaded file is usable as a signature image.
 *
 * PNG is the right format — a signature wants a transparent background so it
 * sits on a document rather than in a white box — but JPEG and WebP are
 * accepted because people photograph signatures on paper and that is a
 * perfectly reasonable thing to do.
 */
export function checkSignatureImage(file: { type: string; size: number }): ImageProblem | null {
  if (!ALLOWED_TYPES.includes(file.type)) {
    return { message: 'Use a PNG, JPEG or WebP image. PNG with a transparent background looks best.' }
  }
  if (file.size > MAX_SIGNATURE_BYTES) {
    return {
      message: `That image is ${Math.round(file.size / 1024)} KB. Keep it under ${MAX_SIGNATURE_BYTES / 1024} KB — crop it to just the signature.`,
    }
  }
  if (file.size === 0) return { message: 'That file is empty.' }
  return null
}

// ═══════════════════════════════════════════════════════════════════════════
// Readiness
// ═══════════════════════════════════════════════════════════════════════════

export interface SigningBlocker {
  message: string
}

/**
 * Why this document can't be signed yet.
 *
 * Signing an incomplete customs document is worse than not signing it: the
 * signature attests the content is true and complete, and a certification
 * missing an origin criterion is neither.
 */
export function signingBlockers(input: {
  documentReady: boolean
  hasSignatureImage: boolean
  signerTitle: string
  alreadySigned: boolean
}): SigningBlocker[] {
  const out: SigningBlocker[] = []
  if (input.alreadySigned) {
    out.push({ message: 'This document has already been signed. Void the signature to sign it again.' })
  }
  if (!input.documentReady) {
    out.push({
      message:
        'Fill in the required fields first. Signing attests the document is true and complete, and this one is not yet.',
    })
  }
  if (!input.hasSignatureImage) {
    out.push({ message: 'Add your signature image under Users & Settings → Account first.' })
  }
  if (!input.signerTitle.trim()) {
    out.push({ message: 'Set your title (e.g. Owner) under Users & Settings → Account.' })
  }
  return out
}

/**
 * A one-line provenance summary for printing beneath the signature.
 *
 * Takes only the fields it reads, rather than a whole `SignatureRecord`: the
 * stored row has a nullable `signerId` (the profile FK is `on delete set null`,
 * so a signature survives the signer's account being removed) and none of that
 * matters here.
 */
export function provenanceLine(
  r: Pick<SignatureRecord, 'signerName' | 'signerEmail' | 'signerTitle' | 'signedAt' | 'contentHash'>,
  tz = 'America/Edmonton',
): string {
  const when = new Date(r.signedAt).toLocaleString('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  })
  return `Electronically signed by ${r.signerName} (${r.signerEmail})${
    r.signerTitle ? `, ${r.signerTitle}` : ''
  } on ${when}. Document hash ${r.contentHash.slice(0, 16)}…`
}
