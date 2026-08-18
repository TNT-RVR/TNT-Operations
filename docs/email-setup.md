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

_Time: about an hour, most of it waiting on DNS. Cost: $0 at TNT's volume._

---

## What was decided, and why

**Send from a subdomain — `mail.tntpollination.com`, not the root.** The root
domain carries your real correspondence with growers. Keeping the app's
automated mail on its own subdomain means its sending reputation is separate,
and the SPF record on the root (your Workspace mail) is never touched. This is
the standard split, and it is much easier to do now than to unpick later.

**Resend as the provider.** Free tier is 3,000 messages/month, 100/day — TNT
sends a few dozen a year. Postmark or SES would work equally well; Resend is
the fastest to stand up and gives SMTP credentials Supabase can use directly.

**The templates are dark.** They match the app rather than the generic white
email, and solid `bgcolor` on tables is one of the few things every client
including Outlook renders faithfully. See `scripts/build_email_templates.py`
for why the markup looks the way it does.

---

## 1. Sending domain (~20 min, plus DNS propagation)

1. Create an account at **resend.com** and add the domain (Domains → Add Domain).
   The form has more on it than you need:

   | Field | Value | Why |
   | --- | --- | --- |
   | Name | `mail.tntpollination.com` | The **sending subdomain goes here**, not the root. |
   | Region | North Virginia (us-east-1) | Default; fine. |
   | Custom Return-Path | `send` | Default; leave it. |
   | Enable click tracking | **off** | See below. |
   | Enable open tracking | off | Default. |
   | Tracking Subdomain | leave empty | Only used by tracking, which is off. |

   **Turn click tracking OFF.** It rewrites every link so it passes through a
   Resend tracking domain first. On marketing mail that is the point; on auth
   mail it is actively harmful — corporate spam filters and link scanners
   pre-visit URLs they find, and these links are **single-use**, so a scanner
   can burn someone's invite or reset before they ever click it. The rewritten
   hostname also makes a legitimate sign-in link look like phishing.

   With tracking off, the Tracking Subdomain field is unused — clearing it
   clears the validation error.

   > **Why the subdomain rather than `tntpollination.com` itself:** a domain may
   > only carry ONE SPF TXT record. The root already has one for Workspace, and
   > adding a second silently breaks both — they would have to be merged into a
   > single record with both includes. Sending from `mail.` keeps the two
   > entirely separate, and keeps automated mail's reputation off the domain you
   > write to growers from.

2. Resend shows three or four DNS records. Add them **exactly as shown** at
   whoever hosts DNS for `tntpollination.com`. They will be, in shape:
   - an **MX** record on the sending subdomain (bounce handling),
   - a **TXT** SPF record on the sending subdomain,
   - a **TXT** DKIM record at `resend._domainkey.…`.
3. Add a **DMARC** record if there isn't one — TXT at `_dmarc.tntpollination.com`,
   value `v=DMARC1; p=none; rua=mailto:tyler.torrie@tntpollination.com`.
   `p=none` only monitors; it cannot cause mail to be rejected.
4. Wait for Resend to show the domain **Verified** (usually minutes).
5. Create an **API key** (Full access). It is the SMTP password in step 2 and is
   shown once — put it somewhere safe.

> **Do not touch the MX record on the root domain.** That is Workspace mail. The
> records above all live on the `mail.` subdomain or on `_dmarc`.

---

## 2. Point Supabase at it (~5 min)

Supabase dashboard → **Project Settings → Authentication → SMTP Settings** →
enable custom SMTP:

| Field | Value |
| --- | --- |
| Host | `smtp.resend.com` |
| Port | `587` |
| Username | `resend` |
| Password | the Resend API key from step 1 |
| Sender email | `noreply@mail.tntpollination.com` |
| Sender name | `TNT Pollination` |

Save, then go to **Authentication → Rate Limits** and raise **"Rate limit for
sending emails"** — it is throttled hard for the built-in sender and has no
reason to be now. 100/hour is plenty.

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
   should arrive from `noreply@mail.tntpollination.com`, dark, with the mark.
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
   asks for, and **set it as the primary domain**.
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

**Mail arrives but the link 404s or bounces to the wrong host** — Site URL /
Redirect URLs in Supabase don't match where the app actually lives.

**DKIM fails** — the DKIM TXT record is usually wrapped or truncated on paste.
Re-copy it from Resend in one piece.

**Nothing arrives at all** — check Resend's Logs tab first. A message that never
reached Resend is a Supabase SMTP misconfiguration; one that reached Resend and
bounced is a recipient or DNS problem.

---

## What this unlocks

`app_notification_prefs` has an `email` toggle with no sender behind it — the
"Email reports" gap in `CLAUDE.md`. Once Resend exists, that key is also what a
Netlify function would use to send digests, so the notification system can
finally honour the switch it already shows.
