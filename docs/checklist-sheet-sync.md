# Google Sheet sync — setup runbook

_The Overall Checklist is the first sheet through this. Adding the next one is
a small adapter, not another integration — see **Adding another sheet** below._

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

## 4. Apply the migrations — DONE 2026-08-19

`0039_field_checklist.sql` and `0040_field_checklist_sync.sql` are applied to the
live project. Re-run either with `node scripts/run-sql.mjs <file>` if a rebuild
is ever needed; both are idempotent.

## 5. Load the history you already have — DONE 2026-08-19

**191 marks are imported** (2026: 40 done + 1 planned; 2025: 40; 2024: 74; 2023:
33 notes) and all 14 of 2026's sheet names are linked to their mapped field. To
redo it from a fresh export:

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

## A new season makes its own tab

The first sync of a year the sheet has no tab for **creates it**, copying the
most recent season's header row so the columns this sync does not own (Gallons,
Structures, Image, Type) come along in your order. It lands at the far left,
because these workbooks read newest-first and a 2027 tab appearing past 2023 is
a tab nobody sees.

Fields are added to it as they get marks — a field mapped after the season
started, or one that never had a line, gets appended rather than being silently
un-syncable.

## Adding another sheet

The plumbing is shared, so a new sheet is an **adapter**, not another
integration. From `netlify/functions/lib/sheetSyncs.mjs`:

1. Write `lib/<thing>Sync.mjs` exporting `{ name, label, sheetIdEnv, run({year}) }`.
   `sheets.mjs` gives you the mechanics — grid with formatting, season tabs,
   appends, values, fills. Copy `checklistSync.mjs`; it is ~150 lines and most
   of that is this sheet's meaning, not machinery.
2. Register it in `SYNCS`.
3. Set its `sheetIdEnv` in Netlify and share that sheet with the **same service
   account**. One robot, many sheets — there is nothing new to create per sheet.

The half-hourly schedule picks it up automatically, and `sheet-sync-now` accepts
its `name` with no change. A sync with no sheet id set is skipped rather than
failing every half hour.

**What a new adapter should keep**, because these are what made the first one
survivable rather than a source of quiet data loss:

- store the agreement snapshot, so "which side changed" is knowable;
- find columns by header text, never by position;
- never write a column you do not own, and never delete a row;
- carry the formatting, if the sheet uses it to mean something.

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
- **Any tab but the season tabs.** A tab whose name is not four digits is never
  read, written, or used as the header source for a new year.

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
