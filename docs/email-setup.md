# Branded auth email — setup runbook

Everything TNT Operations mails a person — invites, password resets, the
"link to the app" button on the Users screen — is sent by **Supabase**, not by
this app. There is no SMTP wiring in the code and there does not need to be.
So making that mail look official is a configuration job, done once.

**Today:** it goes out from `noreply@mail.app.supabase.io` on Supabase's shared
built-in sender, with their default templates. Two consequences:

- **It is rate-limited to a couple of messages an hour.** That is the 429 branch
  in `netlify/functions/invite-user.mjs`.
- **It lands in junk more often than not.** A shared sender with no relationship
  to `tntpollination.com` is exactly what spam filtering is built to distrust.

After this runbook: mail from your own domain, DKIM-signed, carrying the mark,
with a rate limit you set.

_Time: about 45 minutes, most of it waiting on DNS. Cost: $0 at TNT's volume._

---

## What was decided, and why

**SendGrid as the provider — because DNS for `tntpollination.com` is at Wix.**
Wix cannot create MX records on a subdomain. Resend was the first choice and had
to be abandoned for exactly that: it requires an MX record on a return-path
subdomain for bounce processing, so its domain verification can never complete
while Wix holds DNS. SendGrid's default **Automated Security** setup uses three
CNAME records and no MX at all, which fits inside Wix's limits.

Do not re-try Resend without first moving DNS somewhere else. Postmark (DKIM
TXT + return-path CNAME) is the other option that works on Wix, and is worth
paying for if deliverability ever becomes a problem.

**Authenticate the root domain, not a `mail.` subdomain.** With Automated
Security, SendGrid delegates SPF and DKIM through CNAMEs pointing at their
infrastructure — **nothing is added to the root's SPF TXT record**, so there is
no conflict with the Workspace SPF already there. That was the whole reason for
the subdomain plan, and CNAME delegation removes it. You get to send as
`noreply@tntpollination.com`, which reads better than `noreply@mail.…`.

**The templates are dark.** They match the app rather than the generic white
email, and solid `bgcolor` on tables is one of the few things every client
including Outlook renders faithfully. See `scripts/build_email_templates.py`
for why the markup looks the way it does.

---

## 1. Authenticate the domain (~20 min, plus DNS propagation)

1. Create a **SendGrid** account (sendgrid.com — it is a Twilio product). The
   free tier is 100 emails/day, against TNT's few dozen a year. Expect an
   account-verification step before it will send.
2. **Settings → Sender Authentication → Authenticate Your Domain.**
   - DNS host: **Other Host (Not Listed)** — Wix is not in their list.
   - Would you like to brand the links for this domain? **No.** (See the click
     tracking note below.)
   - Domain: **`tntpollination.com`**
   - Leave **Automated Security** ON. That is what makes this three CNAMEs
     instead of two TXT records and an MX — the MX being the thing Wix cannot do.
3. SendGrid shows **three CNAME records**, of the shape:

   | Host | Points to |
   | --- | --- |
   | `em####.tntpollination.com` | `u#####.wl###.sendgrid.net` |
   | `s1._domainkey.tntpollination.com` | `s1.domainkey.u#####.wl###.sendgrid.net` |
   | `s2._domainkey.tntpollination.com` | `s2.domainkey.u#####.wl###.sendgrid.net` |

   The numbers are yours — copy the exact values from the screen.
4. In **Wix → Domains → Advanced → Edit DNS records**, add all three as **CNAME**
   records. Wix supports CNAMEs on subdomains; it is only MX on a subdomain it
   refuses.
5. Back in SendGrid, click **Verify**. If it fails, wait — Wix can take an hour
   to publish — and try again before changing anything.
6. **Settings → Tracking → turn Click Tracking OFF** (and Open Tracking off).
   This matters more than it looks: click tracking rewrites every link to pass
   through SendGrid first, and corporate spam filters and link scanners
   pre-visit URLs they find in mail. These links are **single-use**, so a
   scanner can burn someone's invite or password reset before they ever click
   it. The rewritten hostname also makes a legitimate sign-in link look like
   phishing.
7. **Settings → API Keys → Create API Key.** Restricted Access with **Mail
   Send** only — nothing here needs more. It is shown once; put it somewhere
   safe. It is the SMTP password in step 2.
8. Add a **DMARC** record if the domain has none — TXT, host `_dmarc`, value
   `v=DMARC1; p=none; rua=mailto:tyler.torrie@tntpollination.com`. `p=none` only
   monitors; it cannot cause mail to be rejected. Gmail and Yahoo both expect a
   DMARC record from any domain sending them mail, so this is about whether
   invites arrive, not about strictness. DMARC inherits down subdomains — one
   record at `_dmarc` covers `_dmarc.em####` too, whatever SendGrid's checker
   says. If Workspace already put a DMARC record there, leave it alone.

> **Do not set up Link Branding.** It is a second entry under Sender
> Authentication, offered right after domain authentication, and it wants two
> more CNAMEs (`url####` and a numeric one). Its only purpose is branding the
> rewritten links that click tracking produces — and click tracking is off, for
> the reasons in step 6. If it was switched on by accident, the verifier
> complains about those two records forever; delete the Link Branding entry
> rather than adding them. Only **Domain Authentication** has to say Verified.

> **Do not touch the MX records on the root domain.** Those are Workspace mail.
> Everything above is CNAMEs on subdomains, plus one optional `_dmarc` TXT.

---

## 2. Point Supabase at it (~5 min)

Supabase dashboard → **Project Settings → Authentication → SMTP Settings** →
enable custom SMTP:

| Field | Value |
| --- | --- |
| Host | `smtp.sendgrid.net` |
| Port | `587` |
| Username | `apikey` |
| Password | the SendGrid API key from step 1 |
| Sender email | `noreply@tntpollination.com` |
| Sender name | `TNT Pollination` |

**The username is the literal word `apikey`** — not your account name, not the
key. That trips up nearly everyone once.

Save, then go to **Authentication → Rate Limits** and raise **"Rate limit for
sending emails"** — it is throttled hard for the built-in sender and has no
reason to be now. 100/hour is plenty, and stays under the free tier's 100/day.

> **There is no Reply-To field in Supabase's SMTP settings.** Replies to
> `noreply@…` go nowhere, which is why every template's footer carries
> `tyler.torrie@tntpollination.com` as a real address to write to. If that
> address changes, change it in `src/config/contact.ts` **and** in
> `scripts/build_email_templates.py`, then rebuild.

---

## 3. Paste the templates (~15 min)

**Authentication → Emails → Templates.** Each tab takes a subject line and one
HTML blob. Paste the file contents whole — they are self-contained.

| Supabase template | File | Subject |
| --- | --- | --- |
| Invite user | `supabase/email-templates/invite.html` | You've been added to TNT Operations |
| Magic Link | `supabase/email-templates/magic-link.html` | Your link to TNT Operations |
| Reset Password | `supabase/email-templates/reset-password.html` | Reset your TNT Operations password |
| Confirm signup | `supabase/email-templates/confirm-signup.html` | Confirm your email address |
| Change Email Address | `supabase/email-templates/change-email.html` | Confirm your new email address |
| Reauthentication | `supabase/email-templates/reauthentication.html` | Your TNT Operations confirmation code |

Two of these are the ones people actually see: **Invite user** (new staff) and
**Magic Link** (the link button next to each person on the Users screen, and the
re-send for anyone who never accepted their invite).

**Never edit the `{{ .ConfirmationURL }}`, `{{ .Token }}` or `{{ .NewEmail }}`
placeholders.** They are how Supabase injects the link; a broken one produces a
mail that looks perfect and does nothing.

To change wording or colour, edit `scripts/build_email_templates.py`, run
`python scripts/build_email_templates.py`, and re-paste whichever files changed.
Editing the HTML directly works until the next rebuild overwrites it.

---

## 4. Verify

1. On the Users screen, use the link button next to your own row. The mail
   should arrive from `noreply@tntpollination.com`, dark, with the mark.
2. In Gmail: **⋮ → Show original**. You want **SPF: PASS**, **DKIM: PASS**,
   **DMARC: PASS**.
3. Check it did not land in junk — from a Gmail account and, if you can, an
   Outlook one.
4. Invite a throwaway address end to end and confirm the link signs in.

Images are off by default in Outlook and often in Gmail's preview. The mark's
`alt` is deliberately empty so a blocked image leaves clean whitespace rather
than a broken-image label next to the wordmark, which is real text.

---

## 5. Optional but recommended: the app's own domain

A branded mail whose button points at `tntoperations.netlify.app` undercuts the
whole exercise. When you're ready:

1. Netlify → Domain management → add `app.tntpollination.com`, add the CNAME it
   asks for (Wix does CNAMEs fine), and **set it as the primary domain**.
2. Supabase → Authentication → URL Configuration: set **Site URL** to
   `https://app.tntpollination.com` and add it to **Redirect URLs**.
3. Rebuild the templates against the new origin so the logo loads from it, and
   re-paste all six:
   ```
   python scripts/build_email_templates.py --origin https://app.tntpollination.com
   ```

The Netlify functions need no change: they read `process.env.URL`, which follows
the primary domain automatically. `docs/google-calendar-setup.md` also notes
that Google's verification is a stronger application against a real domain — if
you're going to move, moving before that review saves doing it twice.

---

## Troubleshooting

**"Supabase email rate limit hit"** in the app — SMTP is not configured yet, or
the rate limit in step 2 was never raised.

**`535 "Authentication failed: Bad username / password"`** (seen in Supabase →
Logs → Auth Logs) — SMTP credentials refused. Three causes, all producing the
same 535:

- the username is not the literal string `apikey` (it is never your account
  name or the key itself);
- the key is missing the **Mail Send** scope. A Restricted Access key with
  nothing enabled fails at *authentication*, not with a permissions error —
  SMTP auth requires `mail.send`, so an unscoped key looks exactly like a wrong
  password;
- the key is truncated or carries whitespace. It starts `SG.`, runs ~69
  characters, and is shown in full only once.

Quickest resolution is a fresh **Full Access** key, username re-typed by hand,
then tighten to Restricted + Mail Send once it is known to work.

**"Expected CNAME record for url####/######## to match sendgrid.net"** — those
are Link Branding records, not domain authentication. Delete the Link Branding
entry; see the note in step 1.

**Domain won't verify** — check the CNAMEs resolve before touching them:
`nslookup -type=cname s1._domainkey.tntpollination.com`. Wix sometimes appends
the domain to a host you already typed in full; if the record shows up as
`s1._domainkey.tntpollination.com.tntpollination.com`, that is the cause.

**Mail arrives but the link 404s or bounces to the wrong host** — Site URL /
Redirect URLs in Supabase don't match where the app actually lives.

**Nothing arrives at all** — check SendGrid's **Activity Feed** first. A message
that never reached SendGrid is a Supabase SMTP misconfiguration; one that
reached SendGrid and bounced is a recipient or DNS problem.

---

## What this unlocks

`app_notification_prefs` has an `email` toggle with no sender behind it — the
"Email reports" gap in `CLAUDE.md`. Once SMTP exists, that key is also what a
Netlify function would use to send digests, so the notification system can
finally honour the switch it already shows.
