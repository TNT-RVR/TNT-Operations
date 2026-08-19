# Overall Checklist ↔ Google Sheet — setup runbook

The Overall Checklist (`/tasks/overall`) syncs both ways with the **"Checklist"**
Google Sheet — the one TNT has kept since 2023, a tab per season. Edit a cell in
either place and the other follows.

**On a true conflict the app wins** (decided 2026-08-19). See _How it decides_
below for what counts as a conflict, because it is narrower than it sounds.

_Setup: ~20 minutes, all of it in Google Cloud and Netlify. Cost: nothing._

---

## 1. A service account (~10 min)

A service account is a robot with its own identity. You share the one
spreadsheet with it, and it can reach that and nothing else in your Drive — no
consent screen, no refresh token to lose, and no path to the rest of your files.
(The app's other Google integration, Calendar, uses a personal OAuth flow that
is half-built and disabled. Do not wire this to that.)

1. [console.cloud.google.com](https://console.cloud.google.com) → create a
   project (or reuse one), e.g. `tnt-operations`.
2. **APIs & Services → Library → Google Sheets API → Enable.**
   The Drive API is *not* needed: this reads and writes one sheet by id.
3. **IAM & Admin → Service Accounts → Create service account.**
   Name it `tnt-checklist-sync`. No roles are needed — its access comes from the
   sheet being shared with it, not from project IAM.
4. Open it → **Keys → Add key → Create new key → JSON**. A file downloads. It
   contains a private key; treat it like a password.
5. Copy the `client_email` out of that JSON — it looks like
   `tnt-checklist-sync@tnt-operations.iam.gserviceaccount.com`.

## 2. Share the sheet with it (~1 min)

Open the **Checklist** sheet → **Share** → paste the `client_email` → give it
**Editor** → uncheck "Notify people" (a robot has no inbox) → Share.

> Skipping this is the single most common failure. It surfaces as
> `The service account cannot open that sheet` — the credentials are fine, the
> robot simply has not been invited.

## 3. Netlify environment (~5 min)

Site configuration → Environment variables:

| Variable | Value |
| --- | --- |
| `GOOGLE_SERVICE_ACCOUNT` | the **entire** downloaded JSON, pasted as one value |
| `CHECKLIST_SHEET_ID` | `1rtyXCdsur6_qcSbUDZaM60icpqsKMzFbdcAMsJCAXtw` |
| `SUPABASE_SERVICE_ROLE` | already set if the Govee poller works |

The sheet id is the long string in its URL between `/d/` and `/edit`.

Paste the JSON whole — the code repairs the one thing dashboards reliably break
(turning the private key's real newlines into the two characters `\` and `n`).

## 4. Apply the migrations

In the Supabase SQL editor, in order:

- `supabase/migrations/0039_field_checklist.sql` — the table
- `supabase/migrations/0040_field_checklist_sync.sql` — the agreement snapshot

## 5. Load the history you already have

The first sync imports whatever is in the sheet, but only for tabs it syncs.
To load every season at once from the file:

```
python scripts/import_checklist.py "C:/Users/tyler/Downloads/Checklist (1).xlsx"
```

Then paste `scripts/checklist_import.sql` into the SQL editor. It is idempotent
— re-running corrects rows rather than duplicating them. Over the current file
that is **191 marks**: 2026 (40 done, 1 planned), 2025 (40), 2024 (74), and 2023
as 33 notes, because that season's cells hold prose like "Most in June 29th"
rather than dates, and inventing a date from that would record something nobody
said.

## 6. Check it

Open **Tasks → Overall Checklist** and press **Sync sheet**. It reports how many
marks moved each way. Then:

- tick a step in the app, press Sync, and watch the cell go blue in the sheet;
- type a date into an empty cell in the sheet, press Sync, and watch it appear
  as *planned* in the app.

After that it runs itself, every 30 minutes.

---

## How it decides

Each mark stores what the two sides **agreed on at the end of the last sync**.
That is what makes "the app wins" narrower — and more useful — than it sounds:

| Since last sync | Result |
| --- | --- |
| only the sheet changed | the sheet wins — your edit flows into the app |
| only the app changed | the app wins — pushed out to the sheet |
| **both changed** | **the app wins**, the sheet's version is overwritten |
| neither | nothing happens |

Without that snapshot, "the app wins" would have to mean "the app always wins",
and nothing typed into the sheet would ever come back — which is half of what
this is for. On the very first sync there is no snapshot and the app is empty,
so the sheet is treated as the changed side and its history flows in.

**A blue cell is what makes a step done.** A date on white is a plan; the same
date on blue is a completion. That is TNT's own convention and the sync both
reads and writes it, so a synced cell is indistinguishable from a hand-marked
one.

## What it will not touch

- **Columns it does not own.** Gallons, Structures, Image, Type and 2023's
  Blocks are read past and left alone. Steps are found by their header text, not
  by position, so an inserted column cannot make it write into the wrong one.
- **Rows.** A field dropped from a season's map keeps its row in the sheet: the
  sheet is also TNT's history, and a row vanishing from a 2024 tab would be
  indistinguishable from a bug.
- **Any sheet but the season tabs.** A tab whose name is not four digits is
  skipped; a season with no tab is not an error, just nothing to do.

## Troubleshooting

**`Not configured (CHECKLIST_SHEET_ID)` / `(GOOGLE_SERVICE_ACCOUNT)`** — the
function answers 501 rather than failing loudly, so an unconfigured site is
quiet rather than noisy. Set the variables in step 3.

**`The service account cannot open that sheet`** — step 2 was skipped, or the
sheet was shared with your own address instead of the robot's.

**`Google refused the service account`** — the key JSON is wrong or truncated.
Re-paste the whole file.

**A step column is being ignored** — its header no longer matches. The sync
looks for exactly: Flag, Structures In, Mouse Poison, Bees In, Structures Out.
Rename it back, or add the new spelling to `SHEET_COLUMNS` in
`netlify/functions/lib/checklistSheet.mjs`.

**Dates land a day off** — that is the Sheets serial epoch (1899-12-30) and it
is covered by tests; if it ever happens, `netlify/tests/checklistSheet.test.mjs`
is where to prove it.
