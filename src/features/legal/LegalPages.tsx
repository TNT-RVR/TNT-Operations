/**
 * The public legal pages: end-user licence agreement and privacy policy.
 *
 * ── Why these render OUTSIDE the session provider ────────────────────────────
 *
 * Intuit requires both URLs to be reachable by anyone, and their reviewer opens
 * them signed out. Every other route in this app sits behind SupabaseSession-
 * Provider, which returns <LoginScreen /> when there is no session — so a route
 * added to App.tsx would show a login form to a reviewer and fail the check.
 * main.tsx therefore matches /legal/* ahead of the provider. Keep it that way,
 * and keep these components free of useSession/useData: they must render with
 * no backend at all.
 *
 * ── Accuracy is the whole point ──────────────────────────────────────────────
 *
 * A privacy policy is a statement of fact about what the software does. The
 * disclosures below were written against the code — the subprocessor list is
 * the set of hosts the app actually calls, the location wording matches
 * useGps.ts and the two placement screens, and the AI wording matches what
 * analysis-ai.mjs actually transmits (labels and statistics, no rows). If you
 * add an integration, a data field, or a third party, update this file in the
 * same change. A policy that has drifted from the code is worse than none.
 */
import { Link } from 'react-router-dom'
import { Logo } from '@/components/ui'
import { SUPPORT_EMAIL } from '@/config/contact'

/** Where privacy requests go. Shared with the in-app support line — see the module. */
const CONTACT_EMAIL = SUPPORT_EMAIL

/** Shown on both pages so a reader can tell whether they have the current text. */
const LAST_UPDATED = '14 August 2026'

const COMPANY = 'TNT Pollination'
const PLACE = 'Grassy Lake, Alberta, Canada'

// ── Shared shell ─────────────────────────────────────────────────────────────

function LegalPage({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-base px-4 py-10">
      <div className="mx-auto w-full max-w-3xl">
        <header className="mb-8">
          <Link to="/" className="inline-block">
            <Logo />
          </Link>
          <h1 className="mt-6 font-display text-3xl font-bold tracking-tight text-primary">{title}</h1>
          <p className="mt-2 text-sm text-muted">{subtitle}</p>
          <p className="mt-1 text-xs text-muted">Last updated {LAST_UPDATED}</p>
        </header>

        <div className="card space-y-6 p-6 text-sm leading-relaxed text-primary">{children}</div>

        <footer className="mt-8 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted">
          <Link to="/legal/eula" className="hover:text-primary">
            Licence agreement
          </Link>
          <Link to="/legal/privacy" className="hover:text-primary">
            Privacy policy
          </Link>
          <span>
            © {new Date().getFullYear()} {COMPANY}
          </span>
        </footer>
      </div>
    </div>
  )
}

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="pt-2 font-display text-lg font-semibold text-primary">{children}</h2>
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-secondary">{children}</p>
}

function UL({ children }: { children: React.ReactNode }) {
  return <ul className="list-disc space-y-1.5 pl-5 text-secondary">{children}</ul>
}

// ── End-user licence agreement ───────────────────────────────────────────────

export function Eula() {
  return (
    <LegalPage
      title="End-user licence agreement"
      subtitle={`The terms on which ${COMPANY} makes the TNT Operations application available to its personnel and authorised contractors.`}
    >
      <P>
        This agreement is between {COMPANY} (&ldquo;{COMPANY}&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;) and you, the
        person signing in to the TNT Operations application (the &ldquo;Software&rdquo;). By signing in or using the
        Software you accept these terms. If you do not accept them, do not sign in.
      </P>

      <H2>1. What the Software is</H2>
      <P>
        TNT Operations is a private, internal business application built and operated by {COMPANY} to run a leafcutter-bee
        pollination business: planning bee-shelter placement on fields, tracking incubation and sensor readings,
        recording field work, preparing quotes and invoices, and synchronising accounting records with QuickBooks
        Online. It is not a consumer product, it is not offered for sale, and accounts are not open to the public.
      </P>

      <H2>2. Licence</H2>
      <P>
        We grant you a personal, non-exclusive, non-transferable, revocable licence to use the Software while you are
        employed by, contracted to, or otherwise authorised by {COMPANY}, and only for {COMPANY}&rsquo;s business
        purposes. The Software is licensed, not sold. All rights not expressly granted are reserved.
      </P>

      <H2>3. Accounts and access</H2>
      <UL>
        <li>Accounts are created by invitation from an administrator. You may not create an account any other way.</li>
        <li>
          Your credentials are personal to you. Do not share them, and do not let another person act under your account.
          Shared tablet accounts used by field crews are issued deliberately by an administrator and are the exception.
        </li>
        <li>
          Tell an administrator immediately if you believe your credentials or a shared device have been compromised.
        </li>
        <li>
          Access is scoped by role. Attempting to reach data outside your role, whether through the interface or the API,
          is a breach of this agreement.
        </li>
      </UL>

      <H2>4. Acceptable use</H2>
      <P>You agree not to:</P>
      <UL>
        <li>
          copy, sell, sublicense, rent, or otherwise make the Software available to anyone outside {COMPANY};
        </li>
        <li>
          reverse-engineer, decompile, or attempt to derive source code, except where that restriction is prohibited by
          law;
        </li>
        <li>
          extract, export, or retain {COMPANY} data — including customer records, field data, pricing, and accounting
          information — for any purpose other than your work for {COMPANY}, or after your authorisation ends;
        </li>
        <li>interfere with the Software&rsquo;s operation or security, or probe it for vulnerabilities without consent;</li>
        <li>use the Software to break any law, or to infringe anyone&rsquo;s rights.</li>
      </UL>

      <H2>5. Data and ownership</H2>
      <P>
        All data entered into or produced by the Software — field boundaries, placement plans, incubation and sensor
        records, customer and pricing information, invoices, and accounting records — is the property of {COMPANY} and
        remains so. The Software, its source code, and its design are also the property of {COMPANY}. Your use of the
        Software gives you no ownership in either.
      </P>
      <P>
        Personal information is handled as described in the{' '}
        <Link to="/legal/privacy" className="text-brand hover:underline">
          privacy policy
        </Link>
        , which forms part of this agreement.
      </P>

      <H2>6. Third-party services</H2>
      <P>
        The Software connects to third-party services to do its job, including Intuit QuickBooks Online for accounting,
        Google Calendar for scheduling, and sensor and climate-control vendors for equipment telemetry. Those services
        are governed by their own terms, and we are not responsible for them. Where the Software writes to QuickBooks,
        QuickBooks remains the authoritative record of the company&rsquo;s finances; the Software is the authoritative
        record of operations.
      </P>

      <H2>7. Availability</H2>
      <P>
        We aim to keep the Software available but do not guarantee it. It may be unavailable for maintenance, or because
        a third-party service, network, or hosting provider has failed. Field Mode caches enough to keep working offline,
        but you should not rely on the Software as the only record of safety-critical or time-critical information.
      </P>

      <H2>8. No warranty</H2>
      <P>
        The Software is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;, without warranty of any kind, express or implied,
        including warranties of merchantability, fitness for a particular purpose, and non-infringement. Calculations the
        Software performs — shelter placement, tray and bee mathematics, cost estimates, statistical analysis, and tax
        treatment on invoices — are decision aids. You remain responsible for checking results before acting on them,
        and {COMPANY} remains responsible for its own filings and records.
      </P>

      <H2>9. Limitation of liability</H2>
      <P>
        To the fullest extent permitted by law, {COMPANY} is not liable for any indirect, incidental, special,
        consequential, or punitive damages, or for lost profits, revenue, data, or business, arising out of or relating
        to the Software, however caused. Nothing in this agreement limits liability that cannot be limited by law.
      </P>

      <H2>10. Termination</H2>
      <P>
        This licence ends automatically when your employment, contract, or authorisation with {COMPANY} ends, and we may
        suspend or end it at any time. On termination you must stop using the Software and destroy or return any {COMPANY}{' '}
        data in your possession. Sections 4, 5, 8, 9, and 11 survive termination.
      </P>

      <H2>11. Governing law</H2>
      <P>
        This agreement is governed by the laws of the Province of Alberta and the federal laws of Canada that apply in
        it, without regard to conflict-of-laws rules. The courts of Alberta have exclusive jurisdiction.
      </P>

      <H2>12. Changes</H2>
      <P>
        We may update this agreement. The date at the top of this page shows when it last changed. Continuing to use the
        Software after a change means you accept the updated terms.
      </P>

      <H2>13. Contact</H2>
      <P>
        {COMPANY}, {PLACE}. Questions about this agreement:{' '}
        <a href={`mailto:${CONTACT_EMAIL}`} className="text-brand hover:underline">
          {CONTACT_EMAIL}
        </a>
        .
      </P>
    </LegalPage>
  )
}

// ── Privacy policy ───────────────────────────────────────────────────────────

export function Privacy() {
  return (
    <LegalPage
      title="Privacy policy"
      subtitle={`How ${COMPANY} collects, uses, and protects personal information in the TNT Operations application.`}
    >
      <P>
        {COMPANY} operates TNT Operations, a private internal application used by our staff and authorised contractors
        to run our pollination business. This policy explains what personal information the application handles, why,
        who it is shared with, and what you can ask us to do about it. It applies to the application and its supporting
        services, not to our other business dealings.
      </P>
      <P>
        We handle personal information in accordance with Canada&rsquo;s Personal Information Protection and Electronic
        Documents Act (PIPEDA) and Alberta&rsquo;s Personal Information Protection Act (PIPA).
      </P>

      <H2>1. Information we collect</H2>
      <P>
        <strong className="text-primary">Account information.</strong> Your name, email address, role, and an optional
        profile picture. Passwords are set by you and stored only as salted hashes by our authentication provider; we
        never see or store your password.
      </P>
      <P>
        <strong className="text-primary">Signatures.</strong> If you create an electronic signature for signing
        documents, we store the signature image and, each time you apply it, a record of what you signed: the wording you
        agreed to, your name and email at that moment, the time, and a cryptographic hash of the signed content. Your
        stored signature image is readable only by you — not by administrators — so that nobody can apply your signature
        on your behalf. Once you apply it to a document, it is visible on that document.
      </P>
      <P>
        <strong className="text-primary">Location.</strong> When you use Field Mode to place shelters or trays, the
        application reads your device&rsquo;s GPS position so it can record where equipment was placed, show your position
        on the field map, and share it with the office while the job is running. Location is read only while those
        screens are open and only after your device grants permission; there is no background tracking, and you can
        refuse or revoke the permission in your device settings, at the cost of those features.
      </P>
      <P>
        <strong className="text-primary">Device and notification data.</strong> If you enable push notifications we store
        the subscription identifier your browser issues, so alerts can reach that device. The application stores
        preferences such as your theme and visible map layers on the device itself.
      </P>
      <P>
        <strong className="text-primary">Business contact information.</strong> Names, business addresses, email
        addresses, and phone numbers of our customers, growers, and suppliers, together with the orders, quotes, and
        invoices they relate to.
      </P>
      <P>
        <strong className="text-primary">Operational records.</strong> Field boundaries and legal land descriptions,
        shelter placements, incubation and inspection records, sensor and equipment telemetry, work orders, and crew
        assignments. Most of this is not personal information, but it can be linked to the person who recorded it.
      </P>
      <P>
        <strong className="text-primary">Technical logs.</strong> Our hosting and database providers keep standard
        server logs, including IP addresses and request metadata, for security and troubleshooting.
      </P>

      <H2>2. Why we use it</H2>
      <UL>
        <li>To operate the application and give you access appropriate to your role.</li>
        <li>To plan, carry out, and record field, incubation, and sales work.</li>
        <li>To prepare and issue quotes and invoices, and to keep our accounting records.</li>
        <li>To send operational alerts, such as an incubator out of range or a sensor that has stopped reporting.</li>
        <li>To secure the application, investigate misuse, and meet our legal, tax, and audit obligations.</li>
      </UL>
      <P>
        We do not sell personal information. We do not use it for advertising, and we do not build profiles for any
        purpose other than running the business described above.
      </P>

      <H2>3. Who we share it with</H2>
      <P>
        We share personal information only with service providers that make the application work, and only as far as each
        needs. They are:
      </P>
      <UL>
        <li>
          <strong className="text-primary">Supabase</strong> — database, authentication, and file storage. Holds
          essentially all application data.
        </li>
        <li>
          <strong className="text-primary">Netlify</strong> — website hosting and the scheduled server functions.
        </li>
        <li>
          <strong className="text-primary">Intuit (QuickBooks Online)</strong> — accounting. See section 4.
        </li>
        <li>
          <strong className="text-primary">Google</strong> — calendar synchronisation, if an administrator connects it.
        </li>
        <li>
          <strong className="text-primary">Govee and Sensibo</strong> — incubator sensor readings and climate-control
          equipment. Equipment telemetry only; no personal information is sent to them.
        </li>
        <li>
          <strong className="text-primary">Anthropic</strong> — used in two narrow places: researching publicly
          advertised grant programs, and writing a plain-language explanation of a statistical result we have already
          computed. What is transmitted is metric labels and computed statistics. We do not send account details,
          customer records, signatures, or location data, and this material is not used to train models.
        </li>
        <li>
          <strong className="text-primary">Esri, MapTiler, and Open-Meteo</strong> — satellite imagery, map tiles, and
          historical weather. These receive map coordinates in the ordinary course of serving a map; they receive no
          account information.
        </li>
      </UL>
      <P>
        We may also disclose information where the law requires it, or to establish or defend a legal claim. Several of
        these providers operate outside Canada, chiefly in the United States, so information may be stored or processed
        there and be subject to the laws of that country.
      </P>

      <H2>4. What goes to QuickBooks</H2>
      <P>
        When an administrator connects QuickBooks Online, the application sends customer records, product and service
        items, estimates, and invoices — including names, business addresses, line items, amounts, and tax treatment — to
        the QuickBooks company file. It reads back payment status, so an invoice paid in QuickBooks shows as paid here.
      </P>
      <P>
        The connection is authorised by an administrator through Intuit&rsquo;s own sign-in; we never see or store your
        QuickBooks password. The resulting access tokens are stored so that they cannot be read through the application
        at all — not by any user, including administrators — and are used only by our server functions. An administrator
        can disconnect at any time, which revokes our access at Intuit. Information already in QuickBooks stays there and
        is then governed by Intuit&rsquo;s privacy policy.
      </P>

      <H2>5. How we protect it</H2>
      <UL>
        <li>All traffic is encrypted in transit with TLS, and stored data is encrypted at rest by our providers.</li>
        <li>
          Access is enforced in the database itself with row-level security tied to your role, not only in the interface,
          so a request that bypasses the interface is still refused.
        </li>
        <li>
          Credentials for third-party services are held in server-side environment configuration and are never included
          in the code we publish or in anything sent to your browser.
        </li>
        <li>Accounts are created by invitation and can be suspended or removed immediately by an administrator.</li>
      </UL>
      <P>
        No system is perfectly secure. If a breach affects your personal information and creates a real risk of
        significant harm, we will notify you and the relevant regulator as the law requires.
      </P>

      <H2>6. How long we keep it</H2>
      <P>
        Operational and accounting records are kept for as long as we need them to run the business and to meet legal
        and tax obligations — for Canadian tax records, generally six years from the end of the tax year they relate to.
        Account information is kept while your account is active and for a reasonable period afterwards so that records
        of who did what remain intact. Sensor readings are kept as long-term history, because comparing seasons is the
        point of collecting them. Your signature image is deleted when you delete it or when your account is removed;
        records of documents you already signed are retained, because a signed document must keep its signature.
      </P>

      <H2>7. Your rights</H2>
      <P>You can ask us to:</P>
      <UL>
        <li>tell you what personal information we hold about you, and how it has been used and disclosed;</li>
        <li>correct it if it is wrong or incomplete;</li>
        <li>delete it, where we are not required to keep it for legal, tax, or record-integrity reasons;</li>
        <li>withdraw a consent you have given, such as location or push notifications.</li>
      </UL>
      <P>
        Write to the address in section 9. We will respond within 30 days. If you are not satisfied with our answer you
        may complain to the Office of the Privacy Commissioner of Canada, or to the Office of the Information and Privacy
        Commissioner of Alberta.
      </P>

      <H2>8. Children</H2>
      <P>
        The application is a workplace tool and is not directed at children. We do not knowingly collect personal
        information from anyone under 18 other than as part of an employment relationship permitted by law.
      </P>

      <H2>9. Contact</H2>
      <P>
        {COMPANY}, {PLACE}. For privacy questions, access requests, or complaints:{' '}
        <a href={`mailto:${CONTACT_EMAIL}`} className="text-brand hover:underline">
          {CONTACT_EMAIL}
        </a>
        .
      </P>

      <H2>10. Changes</H2>
      <P>
        We may update this policy as the application changes. The date at the top of this page shows when it last
        changed; where a change materially affects how we handle your information, we will tell you in the application.
      </P>
    </LegalPage>
  )
}
