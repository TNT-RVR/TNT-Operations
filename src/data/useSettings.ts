/**
 * The settings slice: company details, signatures, and QuickBooks status.
 *
 * Exists to fix a seam violation. The Company, Archive, Access and QuickBooks
 * screens were each importing `supabase` and querying tables directly, which
 * CLAUDE.md forbids for good reason: it means those screens simply don't work
 * in mock mode, and every one of them re-invents its own loading and error
 * handling. Now they call `useData()` like everything else.
 *
 * One hook serves both providers. Unlike the sales and tasks slices — which
 * have genuinely different mock and live implementations — everything here is
 * either a plain table read or a no-op without a backend, so a single
 * implementation branching on `supabase` is less code and less to keep in step.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from './supabaseClient'
import type { AccessOverrides, Grant } from '@/domain/access'
import type { Module, Role } from '@/auth/session'
import type { ArchivedUser, CompanyDetails, DocumentSignature, GcalStatus, QboStatus, UserSignature } from './types'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>

export interface SettingsResult {
  ok: boolean
  error?: string
}

const DEFAULT_COMPANY: CompanyDetails = {
  legalName: 'TNT Pollination',
  tradeName: '',
  addressLines: [],
  city: 'Grassy Lake',
  region: 'AB',
  postalCode: '',
  country: 'CA',
  businessNumber: '',
  gstNumber: '',
  phone: '',
  email: '',
  website: '',
  signatoryName: '',
  signatoryTitle: '',
}

const toCompany = (r: Row): CompanyDetails => ({
  legalName: r.legal_name ?? '',
  tradeName: r.trade_name ?? '',
  addressLines: r.address_lines ?? [],
  city: r.city ?? '',
  region: r.region ?? '',
  postalCode: r.postal_code ?? '',
  country: r.country ?? 'CA',
  businessNumber: r.business_number ?? '',
  gstNumber: r.gst_number ?? '',
  phone: r.phone ?? '',
  email: r.email ?? '',
  website: r.website ?? '',
  signatoryName: r.signatory_name ?? '',
  signatoryTitle: r.signatory_title ?? '',
})

const companyToRow = (p: Partial<CompanyDetails>): Row => {
  const r: Row = {}
  const set = (k: string, v: unknown) => { if (v !== undefined) r[k] = v }
  set('legal_name', p.legalName)
  set('trade_name', p.tradeName)
  set('address_lines', p.addressLines)
  set('city', p.city)
  set('region', p.region)
  set('postal_code', p.postalCode)
  set('country', p.country)
  set('business_number', p.businessNumber)
  set('gst_number', p.gstNumber)
  set('phone', p.phone)
  set('email', p.email)
  set('website', p.website)
  set('signatory_name', p.signatoryName)
  set('signatory_title', p.signatoryTitle)
  return r
}

const toDocSignature = (r: Row): DocumentSignature => ({
  id: r.id,
  documentKind: r.document_kind,
  documentId: r.document_id,
  documentRef: r.document_ref ?? '',
  signerId: r.signer_id ?? null,
  signerName: r.signer_name ?? '',
  signerEmail: r.signer_email ?? '',
  signerTitle: r.signer_title ?? '',
  signedAt: r.signed_at,
  contentHash: r.content_hash ?? '',
  attestation: r.attestation ?? '',
  signatureImage: r.signature_image ?? '',
  ipAddress: r.ip_address ?? null,
  userAgent: r.user_agent ?? null,
  voidedAt: r.voided_at ?? null,
  voidReason: r.void_reason ?? '',
})

export interface SettingsSlice {
  /** Company facts that print on the paperwork. */
  company: CompanyDetails
  saveCompany: (patch: Partial<CompanyDetails>) => Promise<SettingsResult>

  /** Per-role permission overrides, sparse. Empty means built-ins apply. */
  accessOverrides: AccessOverrides
  saveAccessOverrides: (
    diff: ReadonlyArray<{ role: Role; module: Module; grant: Grant }>,
  ) => Promise<SettingsResult>

  /**
   * YOUR signature, or null. Never anyone else's — RLS on `user_signatures`
   * is owner-only, so this query cannot return another person's.
   */
  mySignature: UserSignature | null
  saveMySignature: (input: { image: string; title: string }) => Promise<SettingsResult>
  deleteMySignature: () => Promise<SettingsResult>

  /** Signatures applied to documents, newest first. Visible to all members. */
  documentSignatures: DocumentSignature[]
  /**
   * Sign a document. Goes through a Netlify function so the timestamp, IP and
   * signer identity come from the server rather than the browser.
   */
  signDocument: (input: {
    documentKind: string
    documentId: string
    documentRef: string
    contentHash: string
    attestation: string
  }) => Promise<SettingsResult>
  voidSignature: (id: string, reason: string) => Promise<SettingsResult>

  /** QuickBooks connection state. Null when never connected. */
  qboStatus: QboStatus | null

  /**
   * YOUR Google Calendar connection, or null. Per-user, not per-company: the
   * `gcal_status` view filters to the caller, so this is never anyone else's.
   */
  gcalStatus: GcalStatus | null
  /** Turn syncing on or off without disconnecting the account. */
  setGcalSyncEnabled: (enabled: boolean) => Promise<SettingsResult>

  /**
   * Sign-in state per user id — who has been invited and who has actually
   * arrived. Empty in mock mode, where there are no real logins to track.
   */
  userPresence: Record<string, { lastSignInAt: string | null; invitedAt: string | null }>
  /** Archived people, newest first. */
  archivedUsers: ArchivedUser[]
  archiveUser: (id: string) => Promise<SettingsResult>
  restoreUser: (id: string) => Promise<SettingsResult>

  settingsLoading: boolean
  loadSettings: () => Promise<void>
}

/**
 * @param currentUserId the signed-in user, for owner-scoped writes
 * @param live          whether to talk to Supabase at all
 *
 * `live` is passed in rather than inferred from the Supabase client existing.
 * They are different questions: `VITE_DATA_SOURCE=mock` with real credentials
 * in .env is the normal way to develop, and inferring made this slice fire
 * unauthenticated queries at the live database in exactly that setup.
 */
export function useSettings(currentUserId: string | null, live: boolean): SettingsSlice {
  const sbase = live ? supabase : null
  const [company, setCompany] = useState<CompanyDetails>(DEFAULT_COMPANY)
  const [accessOverrides, setOverrides] = useState<AccessOverrides>({})
  const [mySignature, setMySignature] = useState<UserSignature | null>(null)
  const [documentSignatures, setDocSignatures] = useState<DocumentSignature[]>([])
  const [qboStatus, setQbo] = useState<QboStatus | null>(null)
  const [gcalStatus, setGcal] = useState<GcalStatus | null>(null)
  const [userPresence, setPresence] = useState<SettingsSlice['userPresence']>({})
  const [archivedUsers, setArchived] = useState<ArchivedUser[]>([])
  const [settingsLoading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const loadSettings = useCallback(async (): Promise<void> => {
    if (!sbase) {
      setLoaded(true)
      return
    }
    setLoading(true)
    const sb = sbase

    const [co, ov, sig, docSigs, qbo, people, gcal] = await Promise.all([
      sb.from('app_company').select('*').limit(1).maybeSingle(),
      sb.from('app_role_access').select('role, module, grant_level'),
      sb.from('user_signatures').select('*').limit(1).maybeSingle(),
      sb.from('document_signatures').select('*').order('signed_at', { ascending: false }).limit(200),
      sb.from('qbo_status').select('*').limit(1).maybeSingle(),
      sb.from('profiles').select('id, name, email, role, archived_at, last_sign_in_at, invited_at'),
      sb.from('gcal_status').select('*').limit(1).maybeSingle(),
    ])

    // Each is independent — a missing migration for one must not blank the
    // others, so failures are logged per query rather than short-circuiting.
    if (co.error) console.warn('[settings] company:', co.error.message)
    else if (co.data) setCompany(toCompany(co.data as Row))

    if (ov.error) console.warn('[settings] access overrides:', ov.error.message)
    else {
      const o: AccessOverrides = {}
      for (const r of (ov.data as Row[]) ?? []) {
        o[r.role as Role] = { ...(o[r.role as Role] ?? {}), [r.module as Module]: r.grant_level as Grant }
      }
      setOverrides(o)
    }

    if (sig.error) console.warn('[settings] signature:', sig.error.message)
    else if (sig.data) {
      const r = sig.data as Row
      setMySignature({ userId: r.user_id, image: r.image, title: r.title ?? '', updatedAt: r.updated_at })
    } else setMySignature(null)

    if (docSigs.error) console.warn('[settings] document signatures:', docSigs.error.message)
    else setDocSignatures(((docSigs.data as Row[]) ?? []).map(toDocSignature))

    if (qbo.error) console.warn('[settings] quickbooks:', qbo.error.message)
    else if (qbo.data) {
      const r = qbo.data as Row
      setQbo({
        realmId: r.realm_id,
        companyName: r.company_name ?? '',
        environment: r.environment ?? 'sandbox',
        homeCurrency: r.home_currency ?? 'CAD',
        multicurrencyEnabled: r.multicurrency_enabled === true,
        defaultTaxCodeId: r.default_tax_code_id ?? null,
        exemptTaxCodeId: r.exempt_tax_code_id ?? null,
        shippingItemId: r.shipping_item_id ?? null,
        incomeAccountId: r.income_account_id ?? null,
        connected: r.connected === true,
        expiringSoon: r.expiring_soon === true,
        refreshTokenExpiresAt: r.refresh_token_expires_at,
        lastError: r.last_error ?? '',
      })
    } else setQbo(null)

    if (gcal.error) console.warn('[settings] google calendar:', gcal.error.message)
    else if (gcal.data) {
      const r = gcal.data as Row
      setGcal({
        googleEmail: r.google_email ?? '',
        calendarId: r.calendar_id ?? null,
        syncEnabled: r.sync_enabled !== false,
        lastSyncedAt: r.last_synced_at ?? null,
        lastError: r.last_error ?? '',
        connected: r.connected === true,
      })
    } else setGcal(null)

    if (people.error) console.warn('[settings] roster:', people.error.message)
    else {
      const rows = (people.data as Row[]) ?? []
      setPresence(
        Object.fromEntries(
          rows.map((r) => [r.id, { lastSignInAt: r.last_sign_in_at ?? null, invitedAt: r.invited_at ?? null }]),
        ),
      )
      setArchived(
        rows
          .filter((r) => r.archived_at)
          .map((r) => ({
            id: r.id,
            name: r.name ?? '',
            email: r.email ?? '',
            role: r.role ?? '',
            archivedAt: r.archived_at,
          }))
          .sort((a, b) => b.archivedAt.localeCompare(a.archivedAt)),
      )
    }

    setLoading(false)
    setLoaded(true)
  }, [sbase])

  const setArchivedAt = useCallback(
    async (id: string, at: string | null): Promise<SettingsResult> => {
      if (!sbase) return { ok: false, error: 'Not connected' }
      const { error } = await sbase
        .from('profiles')
        .update({ archived_at: at, archived_by: at ? currentUserId : null })
        .eq('id', id)
      if (error) return { ok: false, error: error.message }
      setLoaded(false) // re-read the roster
      return { ok: true }
    },
    [currentUserId, sbase],
  )

  const setGcalSyncEnabled = useCallback(
    async (enabled: boolean): Promise<SettingsResult> => {
      if (!sbase || !currentUserId) return { ok: false, error: 'Not connected' }
      const { error } = await sbase
        .from('gcal_connection')
        .update({ sync_enabled: enabled })
        .eq('user_id', currentUserId)
      if (error) return { ok: false, error: error.message }
      setGcal((g) => (g ? { ...g, syncEnabled: enabled } : g))
      return { ok: true }
    },
    [sbase, currentUserId],
  )

  const archiveUser = useCallback((id: string) => setArchivedAt(id, new Date().toISOString()), [setArchivedAt])
  const restoreUser = useCallback((id: string) => setArchivedAt(id, null), [setArchivedAt])

  // Load once. Unlike sales and tasks, several screens outside one section need
  // this (the paperwork builder wants the company block), so it self-loads.
  useEffect(() => {
    if (!loaded) void loadSettings()
  }, [loaded, loadSettings])

  const saveCompany = useCallback(async (patch: Partial<CompanyDetails>): Promise<SettingsResult> => {
    setCompany((c) => ({ ...c, ...patch }))
    if (!sbase) return { ok: true }
    const { error } = await sbase.from('app_company').update(companyToRow(patch)).eq('id', true)
    return error ? { ok: false, error: error.message } : { ok: true }
  }, [sbase])

  const saveAccessOverrides = useCallback(
    async (diff: ReadonlyArray<{ role: Role; module: Module; grant: Grant }>): Promise<SettingsResult> => {
      const next: AccessOverrides = {}
      for (const d of diff) next[d.role] = { ...(next[d.role] ?? {}), [d.module]: d.grant }
      setOverrides(next)
      if (!sbase) return { ok: true }

      // Replace wholesale: the table is sparse, so a cell returned to its
      // built-in must lose its row rather than keep a stale one.
      const del = await sbase.from('app_role_access').delete().neq('role', '__never__')
      if (del.error) return { ok: false, error: del.error.message }
      if (diff.length > 0) {
        const ins = await sbase
          .from('app_role_access')
          .insert(diff.map((d) => ({ role: d.role, module: d.module, grant_level: d.grant })))
        if (ins.error) return { ok: false, error: ins.error.message }
      }
      return { ok: true }
    },
    [sbase],
  )

  const saveMySignature = useCallback(
    async (input: { image: string; title: string }): Promise<SettingsResult> => {
      if (!currentUserId) return { ok: false, error: 'Sign in first' }
      if (!sbase) {
        setMySignature({ userId: currentUserId, image: input.image, title: input.title, updatedAt: new Date().toISOString() })
        return { ok: true }
      }
      const { error } = await sbase
        .from('user_signatures')
        .upsert({ user_id: currentUserId, image: input.image, title: input.title }, { onConflict: 'user_id' })
      if (error) return { ok: false, error: error.message }
      setMySignature({ userId: currentUserId, image: input.image, title: input.title, updatedAt: new Date().toISOString() })
      return { ok: true }
    },
    [currentUserId, sbase],
  )

  const deleteMySignature = useCallback(async (): Promise<SettingsResult> => {
    if (!currentUserId) return { ok: false, error: 'Sign in first' }
    setMySignature(null)
    if (!sbase) return { ok: true }
    const { error } = await sbase.from('user_signatures').delete().eq('user_id', currentUserId)
    return error ? { ok: false, error: error.message } : { ok: true }
  }, [currentUserId, sbase])

  const signDocument = useCallback<SettingsSlice['signDocument']>(
    async (input) => {
      if (!sbase) return { ok: false, error: 'Signing needs a connection.' }
      const { data } = await sbase.auth.getSession()
      const token = data.session?.access_token
      if (!token) return { ok: false, error: 'Sign in again.' }

      const r = await fetch('/.netlify/functions/sign-document', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      const out = await r.json().catch(() => ({}))
      if (!r.ok) return { ok: false, error: out.error ?? `Signing failed (${r.status})` }

      setDocSignatures((prev) => [toDocSignature(out.signature as Row), ...prev])
      return { ok: true }
    },
    [sbase],
  )

  const voidSignature = useCallback(async (id: string, reason: string): Promise<SettingsResult> => {
    if (!sbase) return { ok: false, error: 'Not connected' }
    const { error } = await sbase
      .from('document_signatures')
      .update({ voided_at: new Date().toISOString(), voided_by: currentUserId, void_reason: reason })
      .eq('id', id)
    if (error) return { ok: false, error: error.message }
    setDocSignatures((prev) =>
      prev.map((sgn) => (sgn.id === id ? { ...sgn, voidedAt: new Date().toISOString(), voidReason: reason } : sgn)),
    )
    return { ok: true }
  }, [currentUserId, sbase])

  return useMemo<SettingsSlice>(
    () => ({
      company,
      saveCompany,
      accessOverrides,
      saveAccessOverrides,
      mySignature,
      saveMySignature,
      deleteMySignature,
      documentSignatures,
      signDocument,
      voidSignature,
      qboStatus,
      gcalStatus,
      setGcalSyncEnabled,
      userPresence,
      archivedUsers,
      archiveUser,
      restoreUser,
      settingsLoading,
      loadSettings,
    }),
    [
      company, saveCompany, accessOverrides, saveAccessOverrides, mySignature, saveMySignature,
      deleteMySignature, documentSignatures, signDocument, voidSignature, qboStatus, gcalStatus, setGcalSyncEnabled,
      userPresence, archivedUsers, archiveUser, restoreUser, settingsLoading, loadSettings,
    ],
  )
}
