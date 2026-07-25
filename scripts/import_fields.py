"""
Import the real shelter-map fields from the old beetent-maps app into the TNT
Operations Supabase `shelter_fields` table.

Reads every real field json (beetent-maps/fields/<company>/<year>/<name>.json),
computes its live shelter count via the old engine (get_tent_positions), and
emits a SQL file of INSERTs — the FULL field dict goes into `data` (jsonb), so
the web app renders the real boundary + pivot + shelters exactly like the old app.

Deterministic UUIDs (uuid5) so re-runs are idempotent (on conflict do nothing).

Usage:
    python scripts/import_fields.py [BEETENT_MAPS_DIR]
    # → writes scripts/fields_import.sql  (gitignored)
Then paste that file into the Supabase SQL editor (correct project!).
"""
import sys, os, json, glob, uuid

BEE = sys.argv[1] if len(sys.argv) > 1 else r"C:\Users\tyler\beetent-maps"
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "fields_import.sql")
FIELDS = os.path.join(BEE, "fields")

sys.path.insert(0, BEE)
import maketentgrid as M  # noqa: E402

NS = uuid.UUID("6f1a0b3e-0000-4000-8000-746e74696e63")  # same namespace as other imports


def uid(rel: str) -> str:
    return str(uuid.uuid5(NS, f"shelter_fields:{rel}"))


def lit(v) -> str:
    if v is None:
        return "NULL"
    return "'" + str(v).replace("'", "''") + "'"


def is_real_field(path: str) -> bool:
    base = os.path.basename(path)
    if base.endswith("_map.json") or base.endswith("_presets.json") or base.endswith("_prefs.json"):
        return False
    return os.path.basename(os.path.dirname(path)) != "fields"  # skip top-level config json


def main() -> None:
    paths = sorted(p for p in glob.glob(os.path.join(FIELDS, "**", "*.json"), recursive=True)
                   if is_real_field(p))
    rows = []
    for p in paths:
        with open(p, "r", encoding="utf-8") as f:
            fd = json.load(f)
        rel = os.path.relpath(p, FIELDS).replace("\\", "/")
        parts = rel.split("/")
        company = fd.get("company") or (parts[0] if parts else "")
        name = fd.get("Name") or os.path.splitext(os.path.basename(p))[0]
        region = fd.get("lld") or fd.get("region") or ""
        shape = "polygon" if fd.get("boundary_polygon") else "pivot"
        try:
            count = len(M.get_tent_positions(fd, use_metric=True))
        except Exception:
            count = 0
        data_json = json.dumps(fd, default=str)
        rows.append(
            f"  ({lit(uid(rel))}, {lit(name)}, {lit(company)}, {lit(region)}, "
            f"'{shape}', {count}, {lit(data_json)}::jsonb)"
        )
        print(f"  {count:>4} shelters | {shape:7} | {company} / {name}")

    if not rows:
        print("No real field json found under", FIELDS)
        return

    sql = (
        "-- Real shelter-map fields imported from beetent-maps.\n"
        "-- Paste into the Supabase SQL editor (project pmqbkezevsuwkoryxief).\n"
        "insert into public.shelter_fields (id, name, client, region, shape_type, shelter_count, data) values\n"
        + ",\n".join(rows)
        + "\non conflict (id) do nothing;\n"
    )
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(sql)
    print(f"\nwrote {len(rows)} fields -> {os.path.normpath(OUT)}  ({os.path.getsize(OUT)//1024} KB)")


if __name__ == "__main__":
    main()
