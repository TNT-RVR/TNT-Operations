# Connecting QuickBooks Online

What TNT Operations pushes to QuickBooks, and how to set up the connection.

**Do the sandbox first.** It is a free throwaway company file, it takes ten
minutes, and it is the only way to watch an invoice land without risking your
real books.

---

## What the integration does

**Into QuickBooks:** invoices, estimates, customers, and products as items.
**Back from QuickBooks:** payment status — an invoice paid there shows as paid here.

QuickBooks stays the authority on money; this app stays the authority on what
was sold, what it cost, and what's in stock. Nothing here writes journal
entries or touches your chart of accounts beyond posting sales to the income
account you pick.

Products sync as **NonInventory** items on purpose. A QuickBooks Inventory item
also needs an asset account, a COGS account, an opening quantity and an as-of
date, and getting those wrong writes journal entries an accountant then has to
unpick. Stock lives in this app; QuickBooks only needs to know what was sold.

---

## 1. Create the Intuit app (15 minutes)

1. Sign in at **https://developer.intuit.com** with your Intuit ID.
2. **Dashboard → Create an app → QuickBooks Online and Payments**.
3. Name it (`TNT Operations`) and select the **`com.intuit.quickbooks.accounting`**
   scope. You do not need the Payments scope.

You now have two sets of keys, under **Keys & credentials**: **Development**
(sandbox) and **Production**. They are different apps as far as Intuit is
concerned — different client IDs, different redirect URIs, different companies.

## 2. Set the redirect URIs

Under **Keys & credentials → Redirect URIs**, add:

```
https://tntoperations.netlify.app/.netlify/functions/qbo-auth?action=callback
```

**Intuit matches this exactly** — scheme, host, path, query, trailing slash. A
mismatch gives an `invalid_redirect_uri` error at the Intuit login screen, which
is the single most common thing to get wrong here.

Add it under **both** Development and Production keys.

## 3. Set the Netlify environment variables

Netlify → Site configuration → Environment variables:

| Variable | Value |
|---|---|
| `QBO_CLIENT_ID` | Client ID from Intuit |
| `QBO_CLIENT_SECRET` | Client Secret from Intuit |
| `QBO_REDIRECT_URI` | The exact URI from step 2 |
| `QBO_ENVIRONMENT` | `sandbox` now, `production` later |
| `QBO_TOKEN_KEY` | 32 random bytes, base64 — see below |

**`QBO_TOKEN_KEY` is required.** Generate it once and keep it:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

It encrypts the OAuth tokens before they are written to the database, which
Intuit requires. Without it every QuickBooks endpoint answers 501 and names it
— deliberately, because a security control that quietly falls back to storing
tokens in the clear is not a control.

**Losing this key means reconnecting, not losing data.** Nothing else is
encrypted with it. **Changing it** has the same effect: the stored tokens stop
opening, so disconnect and reconnect if you ever rotate it.

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE` are already set from the other
functions.

**None of these get a `VITE_` prefix.** A `VITE_` variable is compiled into the
browser bundle, and the client secret in a public bundle means anyone can
impersonate the app against Intuit.

## 4. Run the migration

Paste `supabase/migrations/0017_quickbooks.sql` into the Supabase SQL editor.

Verify:

```sql
select table_name from information_schema.tables
where table_name in ('qbo_connection','qbo_links','qbo_sync_log');
```

Three rows.

## 5. Make a sandbox company

Intuit developer dashboard → **Sandbox** → create a sandbox company. Pick
**Canada** so the tax codes match what you'll see in production.

## 6. Connect

In the app: **Sales → QuickBooks → Connect**. You'll bounce to Intuit, choose
the sandbox company, and land back on the settings screen.

Then set the four mappings, which the app will not guess:

- **Income account** — where product sales post.
- **Tax code for taxable sales** — your GST code.
- **Tax code for exempt sales** — for zero-rated exports to your US customers.
- **Freight item** — a Service item for shipping and brokerage lines.

Every push is **blocked** until these are set. That is deliberate: an invoice
posted with no GST is a filing problem, and revenue in the wrong account is
something an accountant unpicks months later.

## 7. Test it

1. Sync one customer. Check it appears in QuickBooks with the right address.
2. Sync one product.
3. Push one invoice. **Open it in QuickBooks and check the total, the tax and
   the income account against the app.**
4. Mark it paid in QuickBooks, then run the payment pull and confirm the app
   shows it paid.

Do all four in the sandbox before switching.

---

## Going to production

Intuit requires an **app assessment** before issuing production keys — a
questionnaire about data handling and security. It is routine for a company
connecting to its own books, but it is not instant, so start it before you need
it.

**Disconnect the sandbox FIRST, before you touch the keys.** Sales → QuickBooks
→ Disconnect. Revoking a token at Intuit is authenticated with the client
credentials that issued it, so once the production keys are in place the
sandbox token can no longer be revoked — the call fails quietly and that
authorisation stays live at Intuit until it ages out. Thirty seconds now, in
the right order, avoids leaving a working credential to your test books lying
around.

Then:

1. Swap `QBO_CLIENT_ID` / `QBO_CLIENT_SECRET` for the production pair.
2. Set `QBO_ENVIRONMENT=production`.
3. Redeploy.
4. **Connect**, and choose the real company this time.
5. **Set all four mappings again.** They are QuickBooks entity ids, and an id
   from the sandbox means nothing in the real file. The new connection starts
   with them null, so pushes stay blocked until you do — which is the intended
   behaviour, not a fault.
6. Push **one** small real invoice and open it in QuickBooks before pushing
   anything else.

### The sandbox row stays behind

`qbo_connection` is keyed by realm id, and the sandbox company is a different
realm — so connecting production INSERTS a row, leaving two. The app handles
this: `getConnection()` filters on `QBO_ENVIRONMENT`, so a production deploy
cannot reach a sandbox company no matter what is stored, and the settings
screen reads the rows newest-first and tells you when older ones exist.

Once you're live and happy, clear the old row:

```sql
delete from public.qbo_connection where environment = 'sandbox';
delete from public.qbo_links where realm_id not in (select realm_id from public.qbo_connection);
```

The second line matters more than it looks: `qbo_links` maps your local records
to QuickBooks ids **per realm**, so the sandbox links are inert but they are
also a permanent invitation to confusion during a future debugging session.

---

## Things that will bite you

**Multicurrency cannot be turned off.** Your tray sales are in USD. If the
QuickBooks file is CAD with multicurrency off, a USD invoice is rejected. The
app blocks that push and says so, rather than letting QuickBooks return
something opaque. Turning multicurrency on is **irreversible** — Account and
Settings → Advanced → Currency.

**Refresh tokens expire after ~101 days of no use.** Ordinary use keeps the
connection alive indefinitely. A quiet winter could let it lapse, and you'll get
a "QuickBooks disconnected" notification when it does; reconnecting takes a
minute.

**DisplayName must be unique.** Two of your customers are both
"SD Custom Pollination Ltd." (Stuart and Dennis). The app appends the contact
name so QuickBooks accepts both.

**Editing an invoice in QuickBooks and then re-pushing** overwrites the
QuickBooks copy with the app's version. The app re-reads the current SyncToken
first, so the write succeeds — it does not merge. Decide which side owns an
invoice once it's been sent.

**Tax is applied per line from the code you configure.** The app defaults US
customers to the exempt code (a shipment leaving Canada is a zero-rated export)
and Canadian ones to your GST code. That is a sensible default, not a ruling —
place of supply has real edge cases, and your accountant should confirm it
against how you actually invoice.

---

## Where the code lives

| Piece | File |
|---|---|
| Mapping and validation | `src/domain/quickbooks.ts` |
| OAuth start/callback/disconnect | `netlify/functions/qbo-auth.mjs` |
| Push and pull | `netlify/functions/qbo-sync.mjs` |
| Tokens, refresh, API wrapper | `netlify/functions/lib/qbo.mjs` |
| Schema | `supabase/migrations/0017_quickbooks.sql` |

`qbo_connection` has RLS enabled with **no policy at all** — deny everything. A
refresh token is a bearer credential to your books, so not even an admin can
read it through the API; only the service-role key in Netlify's environment
can. The app sees connection state through the `qbo_status` view, which exposes
expiry and configuration but never the tokens. If you add a column there, check
you're not exposing a secret.

On top of that, the tokens are **encrypted with AES-256-GCM before they are
written**, under `QBO_TOKEN_KEY`. That key lives only in Netlify's environment,
so the key and the ciphertext are never in the same place: a database backup,
snapshot or export — or the service-role key itself — is not enough to reach
the books. GCM authenticates as well as encrypts, so a token altered at rest
fails to open instead of being sent to Intuit.

Tokens are also **erased on disconnect**, and when Intuit rejects a refresh. A
revoked token is useless to us but is still a credential-shaped secret that can
be leaked, and nothing reads those columns afterwards — reconnecting writes a
fresh pair.

A connection made before encryption existed is stored in the clear and still
opens; it re-seals on its next refresh, which for an active connection is
within the hour.
