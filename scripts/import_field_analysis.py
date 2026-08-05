"""
Import the season analysis rows exported from the "Leaf Bee Insights" Base44 app
into the TNT Operations Supabase `field_analysis` table (migration 0014).

Reads the Base44 `Field` entity CSV export and emits a SQL file of upserts.

The whole point of this script is the CLEANING. Base44 stored nearly every
metric as text because the source spreadsheet carries "69.52%", "-" and blanks,
and then re-parsed it in each render. Here it is parsed ONCE, on the way in:

  "69.52%"   -> 69.52          percent columns land as numeric percent units
  "-" / ""   -> NULL           a blank is missing data, never a zero
  "6/25/2025"-> 2025-06-25     US M/D/YYYY, the spreadsheet's format
  "" (bool)  -> false          only 64 of 157 rows set the exclusion flags

Deterministic UUIDs (uuid5 over the natural key) so re-runs are idempotent, and
the upsert targets (field_name, year) — verified unique across the export — so
re-importing a corrected season UPDATES it rather than duplicating it.

Usage:
    python scripts/import_field_analysis.py [CSV_PATH]
    # -> writes scripts/field_analysis_import.sql  (gitignored)
Then paste that file into the Supabase SQL editor (correct project!).
"""
import csv
import os
import sys
import uuid
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
CSV_PATH = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    os.path.expanduser("~"), "Downloads", "Field_export.csv")
OUT = os.path.join(HERE, "field_analysis_import.sql")

# Same namespace as the other importers, so ids never collide across tables.
NS = uuid.UUID("6f1a0b3e-0000-4000-8000-746e74696e63")

# Percent columns: stored 0-100. The migration CHECKs this range, so a source
# file that switches to fractions fails loudly instead of skewing every chart.
PCT_COLS = [
    "live_prepupae", "immature_larvae", "dead_prepupae", "dead_larvae",
    "pollen_balls", "second_generation", "predators_and_pests", "parasites",
    "chalkbrood_sporulating", "chalkbrood_non_sporulating", "machine_damage",
    "sex_ratio_test_viability", "percent_female", "percent_male",
    "percent_return",
]

# Plain numbers (no % sign expected, but tolerated).
NUM_COLS = [
    "acres", "male_row_spacing", "female_row_spacing", "male_rows",
    "female_rows", "shelters_per_acre", "num_structures", "blocks_per_shelter",
    "sprayer_width", "seeding_angle", "gallons_put_out", "gallons_returned",
    "gals_per_acre", "pounds", "live_count", "clean_weight_yield",
    "yield_per_acre", "avg_for_variety",
]

COORD_COLS = ["lat", "lng"]

DATE_COLS = [
    "seeding_date", "predicted_flower_date", "actual_bee_release",
    "bees_brought_back_in",
]

TEXT_COLS = [
    "field_name", "year", "company", "crop", "field_id", "variety_code",
    "farmer_name", "planting_pattern", "notes",
]

BOOL_COLS = ["hail_damage", "bad_recording", "experimental"]

ALL_COLS = (["id"] + TEXT_COLS + COORD_COLS + NUM_COLS + PCT_COLS
            + DATE_COLS + BOOL_COLS)


def uid(field_name: str, year: str) -> str:
    return str(uuid.uuid5(NS, f"field_analysis:{field_name}|{year}"))


def clean(v) -> str:
    """
    Normalise one raw cell.

    Excel prefixes a text-formatted cell with an apostrophe, and the export
    carries it through verbatim — the missing-value marker reaches us as "'-"
    rather than "-" in 13 of the columns. Strip it before anything else looks
    at the value, or `field_id` and `variety_code` import the literal text
    "'-" as if it were data.
    """
    if v is None:
        return ""
    return str(v).strip().lstrip("'").strip()


def blank(v) -> bool:
    """A missing value. '-' is how the spreadsheet writes 'not measured'."""
    return clean(v) in ("", "-", "N/A", "n/a")


def num(v, *, pct: bool = False):
    """Parse a spreadsheet number. Returns None for blanks, never 0."""
    if blank(v):
        return None
    s = clean(v).replace(",", "").replace("$", "")
    had_pct = s.endswith("%")
    s = s.rstrip("%").strip()
    try:
        n = float(s)
    except ValueError:
        return None
    # A percent column written as a fraction ("0.6952" with no % sign) would
    # otherwise import as 0.7%. Flag it rather than guess — with 0-1 values
    # being legitimately possible for low-incidence metrics, silently scaling
    # would corrupt the honest small numbers.
    if pct and not had_pct and 0 < n <= 1:
        AMBIGUOUS.append((v, n))
    return n


def date(v):
    """The spreadsheet writes US M/D/YYYY. ISO is accepted too, just in case."""
    if blank(v):
        return None
    s = clean(v)
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%m/%d/%y", "%d/%m/%Y"):
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            continue
    UNPARSED_DATES.append(s)
    return None


def boolean(v) -> str:
    """Blank means 'not flagged' — 91 of 157 rows leave these empty."""
    if blank(v):
        return "false"
    return "true" if clean(v).lower() in ("true", "1", "yes", "y") else "false"


def lit(v) -> str:
    if v is None:
        return "NULL"
    return "'" + str(v).replace("'", "''") + "'"


def numlit(v) -> str:
    return "NULL" if v is None else repr(v)


AMBIGUOUS = []
UNPARSED_DATES = []


def main() -> None:
    if not os.path.exists(CSV_PATH):
        sys.exit(f"CSV not found: {CSV_PATH}")

    with open(CSV_PATH, "r", encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))

    seen = set()
    values = []
    skipped = 0

    for r in rows:
        name = clean(r.get("field_name"))
        year = clean(r.get("year"))
        if not name or not year:
            skipped += 1
            continue
        key = (name, year)
        if key in seen:
            # The natural key is unique in the export; a repeat means the file
            # changed shape. Refuse it rather than let one row silently win.
            sys.exit(f"Duplicate (field_name, year): {name} / {year}")
        seen.add(key)

        vals = [lit(uid(name, year))]
        for c in TEXT_COLS:
            raw = r.get(c)
            vals.append(lit("" if blank(raw) else clean(raw)))
        for c in COORD_COLS:
            vals.append(numlit(num(r.get(c))))
        for c in NUM_COLS:
            vals.append(numlit(num(r.get(c))))
        for c in PCT_COLS:
            vals.append(numlit(num(r.get(c), pct=True)))
        for c in DATE_COLS:
            vals.append(lit(date(r.get(c))))
        for c in BOOL_COLS:
            vals.append(boolean(r.get(c)))

        values.append("  (" + ", ".join(vals) + ")")

    # Every column except the key is refreshed, so a corrected export overwrites
    # cleanly. shelter_field_id is deliberately NOT touched — it is set by the
    # matching pass and must survive a re-import.
    updatable = [c for c in ALL_COLS if c not in ("id", "field_name", "year")]
    update_set = ",\n    ".join(f"{c} = excluded.{c}" for c in updatable)

    sql = f"""-- Generated by scripts/import_field_analysis.py — do not edit by hand.
-- Source: {os.path.basename(CSV_PATH)}  ({len(values)} rows)
-- Target: public.field_analysis (migration 0014)

insert into public.field_analysis ({", ".join(ALL_COLS)})
values
{",\n".join(values)}
on conflict (field_name, year) do update set
    {update_set},
    updated_at = now();
"""

    with open(OUT, "w", encoding="utf-8") as f:
        f.write(sql)

    print(f"wrote {OUT}")
    print(f"  rows:    {len(values)}")
    if skipped:
        print(f"  skipped: {skipped} (no field_name or year)")
    if UNPARSED_DATES:
        print(f"  WARNING: {len(UNPARSED_DATES)} unparseable dates -> NULL: "
              f"{sorted(set(UNPARSED_DATES))[:5]}")
    if AMBIGUOUS:
        print(f"  WARNING: {len(AMBIGUOUS)} percent values in 0-1 with no '%' "
              f"sign. If these are fractions the import is 100x low: "
              f"{AMBIGUOUS[:5]}")


if __name__ == "__main__":
    main()
