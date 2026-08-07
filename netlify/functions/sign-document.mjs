/**
 * Record an electronic signature.
 *
 *   POST /.netlify/functions/sign-document
 *   Authorization: Bearer <the signer's own access token>
 *   { documentKind, documentId, documentRef, contentHash, attestation }
 *
 * ── Why this isn't a plain insert from the browser ───────────────────────────
 *
 * Two pieces of evidence can only be captured server-side:
 *
 *   IP ADDRESS  a browser cannot see its own public IP, and anything it claimed
 *               would be the signer's own assertion about themselves — worthless
 *               as corroboration.
 *   IDENTITY    the signer's name, email and signature image are read here from
 *               the database against their verified token, not accepted from the
 *               request. A client that could supply those could sign as someone
 *               else, which is the one thing a signature must prevent.
 *
 * The timestamp is neither the client's nor this function's — the table's
 * `signed_at` default and its BEFORE INSERT trigger overwrite it with the
 * database clock.
 *
 * The content hash IS accepted from the client, and that is fine: it is a
 * commitment, not a claim. If it doesn't match the document, verification
 * fails later and the signature is shown as not matching. A wrong hash can only
 * weaken the signer's own position, never forge someone else's.
 */

const json = (body, status) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** The caller's IP, from the proxy headers Netlify sets. */
function clientIp(req) {
  // x-nf-client-connection-ip is Netlify's own and is not client-settable.
  const direct = req.headers.get('x-nf-client-connection-ip')
  if (direct) return direct
  // x-forwarded-for can be spoofed upstream; take the FIRST entry and treat it
  // as indicative only.
  const fwd = req.headers.get('x-forwarded-for')
  return fwd ? fwd.split(',')[0].trim() : null
}

export default async (req) => {
  const URL_ = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const KEY = process.env.SUPABASE_SERVICE_ROLE
  if (!URL_ || !KEY) return json({ error: 'Not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE)' }, 501)
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return json({ error: 'Sign in first' }, 401)

  let body
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  const { documentKind, documentId, documentRef, contentHash, attestation } = body ?? {}
  if (!documentKind || !documentId || !contentHash || !attestation) {
    return json({ error: 'documentKind, documentId, contentHash and attestation are all required' }, 400)
  }
  if (!/^[0-9a-f]{64}$/.test(String(contentHash))) {
    return json({ error: 'contentHash must be a SHA-256 hex digest' }, 400)
  }

  const svc = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }

  // 1. Who is calling? Verified against GoTrue, not taken from the body.
  const me = await fetch(`${URL_}/auth/v1/user`, {
    headers: { apikey: KEY, Authorization: `Bearer ${jwt}` },
  })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
  if (!me?.id) return json({ error: 'Your session is invalid — sign in again' }, 401)

  // 2. Their profile and signature, read server-side.
  const [profileRows, sigRows] = await Promise.all([
    fetch(`${URL_}/rest/v1/profiles?id=eq.${me.id}&select=name,email,title,archived_at`, { headers: svc })
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => []),
    fetch(`${URL_}/rest/v1/user_signatures?user_id=eq.${me.id}&select=image,title`, { headers: svc })
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => []),
  ])

  const profile = profileRows[0]
  const signature = sigRows[0]
  if (!profile) return json({ error: 'No profile found for your account' }, 403)
  if (profile.archived_at) return json({ error: 'Archived accounts cannot sign' }, 403)
  if (!signature?.image) {
    return json({ error: 'Add your signature image under Users & Settings → Account first' }, 409)
  }

  const title = (signature.title || profile.title || '').trim()
  if (!title) {
    return json({ error: 'Set your title (e.g. Owner) under Users & Settings → Account first' }, 409)
  }

  // 3. Already signed? Re-signing must be an explicit void-then-sign, not a
  //    silent second record that makes the history ambiguous.
  const existing = await fetch(
    `${URL_}/rest/v1/document_signatures?document_kind=eq.${encodeURIComponent(documentKind)}` +
      `&document_id=eq.${documentId}&voided_at=is.null&select=id&limit=1`,
    { headers: svc },
  )
    .then((r) => (r.ok ? r.json() : []))
    .catch(() => [])
  if (existing.length > 0) {
    return json({ error: 'This document is already signed. Void that signature before signing again.' }, 409)
  }

  // 4. Record it. signed_at is set by the database, not by us.
  const insert = await fetch(`${URL_}/rest/v1/document_signatures`, {
    method: 'POST',
    headers: { ...svc, Prefer: 'return=representation' },
    body: JSON.stringify({
      document_kind: documentKind,
      document_id: documentId,
      document_ref: documentRef ?? '',
      signer_id: me.id,
      signer_name: profile.name || profile.email,
      signer_email: profile.email,
      signer_title: title,
      content_hash: contentHash,
      attestation,
      signature_image: signature.image,
      ip_address: clientIp(req),
      user_agent: (req.headers.get('user-agent') ?? '').slice(0, 500),
    }),
  })

  if (!insert.ok) return json({ error: `Could not record the signature: ${await insert.text()}` }, 500)
  const [row] = await insert.json()
  return json({ ok: true, signature: row }, 200)
}
