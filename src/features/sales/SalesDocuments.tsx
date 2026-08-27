/**
 * The shipping-paperwork panel: one tab per document, each showing what it
 * would print and — more importantly — what it is missing.
 *
 * The Print button is DISABLED while a document has required fields missing.
 * That is the whole point of the module: a customs document with a blank HS
 * code or a guessed origin is worse than no document, so the UI refuses rather
 * than producing something that looks finished.
 */
import { useMemo, useState } from 'react'
import { useData } from '@/data/context'
import { useSession } from '@/auth/session'
import { Badge, Button, InfoDot, Modal } from '@/components/ui'
import { AlertTriangle, PenLine, Printer, ShieldCheck } from 'lucide-react'
import type { SalesOrder } from '@/data/types'
import { type BuiltDocument, isReady } from '@/domain/salesDocs'
import { helpFor } from '@/domain/docHelp'
import { FreightQuoteView } from './FreightQuoteView'
import {
  ATTESTATION,
  canonicalize,
  hashContent,
  provenanceLine,
  signingBlockers,
} from '@/domain/signature'
import type { OrderComputed } from './useOrderPricing'

export function DocumentsModal({
  order,
  computed,
  onClose,
}: {
  order: SalesOrder
  computed: OrderComputed
  onClose: () => void
}) {
  const docs = computed.documents
  // 'quote' is not a BuiltDocument — it is an editable form with its own
  // renderer, so it is addressed by name rather than by index.
  const [active, setActive] = useState<number | 'quote'>('quote')
  const doc = typeof active === 'number' ? docs[active] : undefined
  const quoteIncomplete = computed.quote.blockers.length > 0

  return (
    <Modal title={`Paperwork — ${order.number}`} onClose={onClose} wide>
      {docs.length === 0 ? (
        <p className="text-sm text-muted">Add a line to the order first.</p>
      ) : (
        <div className="space-y-4">
          <div className="print-hide flex flex-wrap gap-1 border-b border-subtle">
            <button
              onClick={() => setActive('quote')}
              className={`-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium ${
 active === 'quote' ? 'border-brand text-brand' : 'border-transparent text-muted hover:text-secondary'
              }`}
            >
              Freight Quote
              {quoteIncomplete && <AlertTriangle size={13} className="text-warn" />}
            </button>
            {docs.map((d, i) => (
              <button
                key={d.kind}
                onClick={() => setActive(i)}
                className={`-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium ${
 i === active ? 'border-brand text-brand' : 'border-transparent text-muted hover:text-secondary'
                }`}
              >
                {d.title}
                {!isReady(d) && <AlertTriangle size={13} className="text-warn" />}
              </button>
            ))}
          </div>

          {active === 'quote' ? (
            <FreightQuoteView order={order} />
          ) : (
            doc && <DocumentView doc={doc} order={order} />
          )}
        </div>
      )}
    </Modal>
  )
}

/**
 * Which explanation belongs to a printed field, by its label.
 *
 * Matched on the label rather than carried on the field itself, because
 * `salesDocs` builds forms defined by law — CBSA numbers its boxes and CUSMA
 * names its data elements — and those field lists should not have to know that
 * this app has info buttons. An unmapped label simply gets none.
 */
const HELP_BY_LABEL: Record<string, string> = {
  'Shipper': 'shipper',
  'Ship from': 'shipper',
  'Vendor': 'shipper',
  'Consignee': 'consignee',
  'Ship to': 'consignee',
  'Terms of sale': 'incoterm',
  'Incoterm': 'incoterm',
  'Gross weight': 'weight',
  'Net weight': 'weight',
  'Total packages': 'handlingUnits',
  'Freight terms': 'billingTerms',
  'Customs broker': 'broker',
  'Declared value': 'unitValue',
}

/**
 * A line-table column heading.
 *
 * The generic rule splits camelCase and capitalises, which is right for
 * `freightClass` and wrong for an acronym: `nmfc` came out as "Nmfc", which is
 * not what is printed on any carrier's paperwork.
 */
const COLUMN_LABELS: Record<string, string> = { nmfc: 'NMFC', hsCode: 'HS code', dgUn: 'DG UN' }

function columnLabel(key: string): string {
  if (COLUMN_LABELS[key]) return COLUMN_LABELS[key]
  const spaced = key.replace(/([A-Z])/g, ' $1')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function helpKeyFor(label: string): string {
  return HELP_BY_LABEL[label] ?? ''
}

function DocumentView({ doc, order }: { doc: BuiltDocument; order: SalesOrder }) {
  const ready = isReady(doc)
  const required = doc.missing.filter((m) => m.severity === 'required')
  const recommended = doc.missing.filter((m) => m.severity === 'recommended')

  return (
    <div className="space-y-4">
      {required.length > 0 && (
        <div className="rounded border border-danger/40 bg-[color:var(--danger-bg)] p-3">
          <p className="mb-1 flex items-center gap-2 text-xs font-semibold text-danger">
            <AlertTriangle size={14} /> Cannot issue — {required.length} required field
            {required.length === 1 ? '' : 's'} missing
          </p>
          <ul className="space-y-1.5 text-xs">
            {required.map((m, i) => (
              <li key={i}>
                <span className="font-medium text-primary">{m.label}</span>
                <span className="text-secondary"> — {m.why}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {recommended.length > 0 && (
        <div className="rounded border border-warn/40 bg-warn/10 p-3">
          <p className="mb-1 text-xs font-semibold text-warn">Recommended</p>
          <ul className="space-y-1 text-xs">
            {recommended.map((m, i) => (
              <li key={i}>
                <span className="font-medium text-primary">{m.label}</span>
                <span className="text-secondary"> — {m.why}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="print-target space-y-4">
        <div className="card space-y-2">
          {doc.fields.map((f, i) => (
            <div key={i} className="grid gap-1 sm:grid-cols-[14rem_1fr]">
              <span className="flex items-center gap-1.5 text-xs text-muted">
                {f.box != null && <span className="mr-1 text-faint">{f.box}.</span>}
                {f.label}
                {/* Only the fields that have something worth explaining get one;
                    helpFor returns null for the rest and InfoDot renders nothing. */}
                <span className="print-hide">
                  <InfoDot note={helpFor(helpKeyFor(f.label))} />
                </span>
              </span>
              <span className="whitespace-pre-line text-sm text-primary">
                {f.value || <span className="text-faint">—</span>}
              </span>
            </div>
          ))}
        </div>

        {doc.lines.length > 0 && (
          <div className="card overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  {Object.keys(doc.lines[0]).map((k) => (
                    <th key={k} className="th text-left">
                      {columnLabel(k)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {doc.lines.map((l, i) => (
                  <tr key={i} className="border-t border-subtle">
                    {Object.entries(l).map(([k, v]) => (
                      <td key={k} className="px-3 py-2 text-secondary tabular-nums">
                        {v || <span className="text-faint">—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <SignBlock doc={doc} order={order} documentReady={ready} />

      <div className="print-hide flex items-center gap-3 border-t border-subtle pt-3">
        <Button onClick={() => window.print()} disabled={!ready}>
          <Printer size={16} /> Print
        </Button>
        {ready ? (
          <Badge tone="green">Complete</Badge>
        ) : (
          <span className="text-xs text-muted">Fill the required fields above to enable printing.</span>
        )}
      </div>
    </div>
  )
}

/**
 * Sign this document, or show the signature already on it.
 *
 * The checkbox IS the signature — a deliberate act of assent, which is what
 * makes it a signature in law rather than an image someone pasted on. The
 * button stays disabled until it is ticked, and the attestation text sits right
 * next to it so nobody signs something they have not been shown.
 *
 * A hash of the document's exact contents goes with the record, so a later edit
 * can be detected. Signing an INCOMPLETE document is refused outright: the
 * attestation says the content is true and complete, and a certification
 * missing an origin criterion is neither.
 */
function SignBlock({
  doc,
  order,
  documentReady,
}: {
  doc: BuiltDocument
  order: SalesOrder
  documentReady: boolean
}) {
  const session = useSession()
  const { mySignature, documentSignatures, signDocument } = useData()
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const existing = documentSignatures.find(
    (x) => x.documentKind === doc.kind && x.documentId === order.id && !x.voidedAt,
  )

  const blockers = useMemo(
    () =>
      signingBlockers({
        documentReady,
        hasSignatureImage: !!mySignature?.image,
        signerTitle: mySignature?.title ?? '',
        alreadySigned: !!existing,
      }),
    [documentReady, mySignature, existing],
  )

  // ── Already signed ──
  if (existing) {
    return (
      <div className="rounded border border-brand/40 bg-brand/10 p-3">
        <p className="mb-2 flex items-center gap-2 text-xs font-semibold text-brand">
          <ShieldCheck size={14} /> Signed
        </p>
        {existing.signatureImage && (
          <img
            src={existing.signatureImage}
            alt={`Signature of ${existing.signerName}`}
            className="mb-2 max-h-20 max-w-full object-contain"
          />
        )}
        <p className="text-xs text-secondary">{provenanceLine(existing)}</p>
      </div>
    )
  }

  const sign = async () => {
    setBusy(true)
    setError('')
    // Hash exactly what is on screen — fields and line rows both, so an edit to
    // either is detectable afterwards.
    const fields = [
      ...doc.fields.map((f) => ({ label: f.label, value: f.value })),
      ...doc.lines.flatMap((row, i) =>
        Object.entries(row).map(([k, v]) => ({ label: `line${i}.${k}`, value: String(v ?? '') })),
      ),
    ]
    const hash = await hashContent(canonicalize(doc.kind, order.number, fields))
    if (!hash) {
      setBusy(false)
      return setError('Cannot sign here — secure hashing is unavailable in this browser context.')
    }

    const r = await signDocument({
      documentKind: doc.kind,
      documentId: order.id,
      documentRef: order.number,
      contentHash: hash,
      attestation: ATTESTATION,
    })
    setBusy(false)
    if (!r.ok) setError(r.error ?? 'Could not sign')
    else setAgreed(false)
  }

  return (
    <div className="rounded border border-subtle p-3">
      <p className="mb-2 flex items-center gap-2 text-xs font-semibold text-muted">
        <PenLine size={14} /> Sign this document
      </p>

      {blockers.length > 0 ? (
        <ul className="list-disc space-y-1 pl-4 text-xs text-muted">
          {blockers.map((b, i) => (
            <li key={i}>{b.message}</li>
          ))}
        </ul>
      ) : (
        <>
          <label className="flex cursor-pointer items-start gap-2 text-xs text-secondary">
            <input
              type="checkbox"
              className="mt-0.5 shrink-0"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
            />
            <span>{ATTESTATION}</span>
          </label>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button onClick={sign} disabled={!agreed || busy}>
              <PenLine size={16} /> {busy ? 'Signing…' : `Sign as ${session.user.name}`}
            </Button>
            <span className="text-xs text-faint">
              Records the time from the server, your account, and a fingerprint of this document.
            </span>
          </div>
        </>
      )}

      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  )
}
