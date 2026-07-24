"""
Import the old bee-incubation SQLite DB into the TNT Operations Supabase schema.

Reads incubation.db and EMITS a .sql file of INSERT statements (no network, no
service-role secret) that you paste into the Supabase SQL editor. The editor runs
as postgres (bypasses RLS), so the data lands regardless of policies.

Old integer PKs are mapped to stable UUIDs (uuid5), so foreign keys are preserved
and re-running produces the same ids (safe to re-run with the ON CONFLICT guards).

SECURITY: secret `settings` keys (API keys, SMTP password, tokens…) are NOT
exported — those belong in server env, not a table any signed-in user can read.

Usage:
    python scripts/import_incubation.py "G:\\My Drive\\TNT Pollination\\Incubation App\\incubation.db"
    # -> writes scripts/incubation_import.sql

Apply migrations 0001–0003 FIRST, then paste the generated file into the SQL
editor. Column names match supabase/migrations/0003_incubation_full.sql.

NOTE: the old app stored naive LOCAL (America/Edmonton) timestamps; they import
as-is (treated as UTC). A timezone normalization pass can follow later.
"""
import sys, os, sqlite3, uuid, re
from datetime import datetime

# A date/timestamp value must start YYYY-MM-DD; anything else (''/'none'/junk) -> NULL.
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}")

NS = uuid.UUID("6f1a0b3e-0000-4000-8000-746e74696e63")
BATCH = 1000  # rows per INSERT statement

# settings keys that are secrets — never export to a readable table
SECRET_KEYS = {
    "govee_api_key", "sensibo_api_key", "smtp_password", "smtp_username",
    "flask_secret", "mobile_passcode", "voc_ingest_token", "gcal_credentials_path",
}


def uid(table, old_id):
    return str(uuid.uuid5(NS, f"{table}:{old_id}"))


def lit(v):
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return repr(v)
    return "'" + str(v).replace("'", "''") + "'"


def dt(v):
    """Date/timestamp literal. Anything not starting with a real date -> NULL
    (handles ''/'none'/'null'/junk the old free-text date fields collected)."""
    if v is None:
        return "NULL"
    s = str(v).strip()
    if not _DATE_RE.match(s):
        return "NULL"
    return "'" + s.replace("'", "''") + "'"


def b(v):
    return "NULL" if v is None else ("true" if int(v) else "false")


def num(v):
    """Numeric literal; ''/non-numeric -> NULL (old free-text numeric fields)."""
    if v is None:
        return "NULL"
    if isinstance(v, (int, float)):
        return repr(v)
    s = str(v).strip()
    try:
        float(s)
        return s
    except ValueError:
        return "NULL"


def fk(table, old_id):
    return "NULL" if old_id is None else "'" + uid(table, old_id) + "'"


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    db_path = sys.argv[1]
    if not os.path.exists(db_path):
        print(f"ERROR: no such file: {db_path}")
        sys.exit(1)

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    out = []
    counts = {}

    def has(t):
        return bool(conn.execute(
            "select 1 from sqlite_master where type='table' and name=?", (t,)).fetchone())

    def rows(t):
        return conn.execute(f'select * from "{t}"').fetchall() if has(t) else []

    def emit(table, cols, value_rows, conflict="(id) do nothing"):
        counts[table] = len(value_rows)
        if not value_rows:
            out.append(f"-- {table}: no rows\n")
            return
        collist = ", ".join(cols)
        for i in range(0, len(value_rows), BATCH):
            chunk = value_rows[i:i + BATCH]
            out.append(f"insert into public.{table} ({collist}) values")
            out.append(",\n".join("  (" + ", ".join(vr) + ")" for vr in chunk))
            out.append(f"on conflict {conflict};\n")

    # ── incubators ────────────────────────────────────────────────────────────
    emit("incubators",
         ["id", "name", "capacity", "govee_device_id", "govee_sku", "temp_mode",
          "temp_alerts_enabled", "humidity_min", "humidity_max", "sort_order",
          "is_hidden", "sensibo_device_id", "incubation_start"],
         [[lit(uid("incubators", r["id"])), lit(r["name"]), lit(r["capacity"]),
           lit(r["govee_device_id"]), lit(r["govee_sku"]), lit(r["temp_mode"]),
           b(r["temp_alerts_enabled"]), num(r["humidity_min"]), num(r["humidity_max"]),
           num(r["sort_order"]), b(r["is_hidden"]), lit(r["sensibo_device_id"]),
           dt(r["incubation_start"])] for r in rows("incubators")])

    # ── samples ───────────────────────────────────────────────────────────────
    emit("samples",
         ["id", "name", "source", "lot_number", "xray_live_pct", "xray_parasite_pct",
          "xray_dead_pct", "total_volume_gal", "total_weight_lbs", "notes", "import_date",
          "total_weight_kg", "live_bees_per_lb", "live_bees_per_kg", "parasites",
          "chalkbrood", "kg_per_2gal", "lbs_per_2gal", "total_trays", "incubator_space"],
         [[lit(uid("samples", r["id"])), lit(r["name"]), lit(r["source"]), lit(r["lot_number"]),
           num(r["xray_live_pct"]), num(r["xray_parasite_pct"]), num(r["xray_dead_pct"]),
           num(r["total_volume_gal"]), num(r["total_weight_lbs"]), lit(r["notes"]),
           dt(r["import_date"]), num(r["total_weight_kg"]), num(r["live_bees_per_lb"]),
           num(r["live_bees_per_kg"]), num(r["parasites"]), num(r["chalkbrood"]),
           num(r["kg_per_2gal"]), num(r["lbs_per_2gal"]), num(r["total_trays"]),
           num(r["incubator_space"])] for r in rows("samples")])

    # ── incubation_batches ────────────────────────────────────────────────────
    emit("incubation_batches",
         ["id", "incubator_id", "sample_id", "name", "start_date", "vapona_in", "vapona_out",
          "air_out", "male_10pct_emergence", "earliest_cool", "estimated_release",
          "latest_release", "status", "notes"],
         [[lit(uid("incubation_batches", r["id"])), fk("incubators", r["incubator_id"]),
           fk("samples", r["sample_id"]), lit(r["name"]), dt(r["start_date"]), dt(r["vapona_in"]),
           dt(r["vapona_out"]), dt(r["air_out"]), dt(r["male_10pct_emergence"]),
           dt(r["earliest_cool"]), dt(r["estimated_release"]), dt(r["latest_release"]),
           lit(r["status"]), lit(r["notes"])] for r in rows("incubation_batches")])

    # ── trays ─────────────────────────────────────────────────────────────────
    emit("trays",
         ["id", "tray_number", "sample_id", "incubation_batch_id", "incubator_id", "weight_lbs",
          "live_count", "parasite_level_pct", "volume_gal", "in_date", "out_date", "cool_date",
          "status", "notes"],
         [[lit(uid("trays", r["id"])), lit(r["tray_number"]), fk("samples", r["sample_id"]),
           fk("incubation_batches", r["incubation_batch_id"]), fk("incubators", r["incubator_id"]),
           lit(r["weight_lbs"]), lit(r["live_count"]), lit(r["parasite_level_pct"]),
           lit(r["volume_gal"]), dt(r["in_date"]), dt(r["out_date"]), dt(r["cool_date"]),
           lit(r["status"]), lit(r["notes"])] for r in rows("trays")])

    # ── inspections (old rich schema → superset table) ────────────────────────
    emit("inspections",
         ["id", "incubator_id", "at", "period", "thermometer_temp_c", "govee_temp_c", "temp_diff_c",
          "temp_alert", "heat_pumps_ok", "parasites_emerging", "bees_emerging", "fans_ok",
          "black_lights_ok", "notes"],
         [[lit(uid("inspections", r["id"])), fk("incubators", r["incubator_id"]), dt(r["timestamp"]),
           lit(r["period"]), lit(r["thermometer_temp_c"]), lit(r["govee_temp_c"]), lit(r["temp_diff_c"]),
           b(r["temp_alert"]), b(r["heat_pumps_ok"]), b(r["parasites_emerging"]), b(r["bees_emerging"]),
           b(r["fans_ok"]), b(r["black_lights_ok"]), lit(r["notes"])] for r in rows("inspections")])

    # ── tray_inspections ──────────────────────────────────────────────────────
    emit("tray_inspections",
         ["id", "inspection_id", "tray_id", "tray_number", "incubator_id", "timestamp",
          "stack_position", "depth_position", "cells_opened", "dev_stage", "notes"],
         [[lit(uid("tray_inspections", r["id"])), fk("inspections", r["inspection_id"]),
           fk("trays", r["tray_id"]), lit(r["tray_number"]), fk("incubators", r["incubator_id"]),
           dt(r["timestamp"]), lit(r["stack_position"]), lit(r["depth_position"]),
           lit(r["cells_opened"]), lit(r["dev_stage"]), lit(r["notes"])]
          for r in rows("tray_inspections")])

    # ── temp_humidity_readings -> sensor_readings ─────────────────────────────
    emit("sensor_readings",
         ["id", "incubator_id", "at", "temp_c", "humidity_pct", "source"],
         [[lit(uid("temp_humidity_readings", r["id"])), fk("incubators", r["incubator_id"]),
           dt(r["timestamp"]), lit(r["temperature_c"]), lit(r["humidity_pct"]), "'govee'"]
          for r in rows("temp_humidity_readings")])

    # ── alerts ────────────────────────────────────────────────────────────────
    emit("alerts",
         ["id", "alert_type", "severity", "incubator_id", "tray_id", "batch_id", "message",
          "triggered_at", "acknowledged", "acknowledged_at", "dedup_key", "notified"],
         [[lit(uid("alerts", r["id"])), lit(r["alert_type"]), lit(r["severity"]),
           fk("incubators", r["incubator_id"]), fk("trays", r["tray_id"]),
           fk("incubation_batches", r["batch_id"]), lit(r["message"]), dt(r["triggered_at"]),
           b(r["acknowledged"]), dt(r["acknowledged_at"]), lit(r["dedup_key"]), b(r["notified"])]
          for r in rows("alerts")])

    # ── settings (non-secret keys only; upsert over the seeded defaults) ──────
    emit("settings", ["key", "value"],
         [[lit(r["key"]), lit(r["value"])] for r in rows("settings")
          if r["key"] not in SECRET_KEYS],
         conflict="(key) do update set value = excluded.value")

    # ── VOC: custom presets (built-ins are seeded by the migration) ───────────
    emit("presets",
         ["id", "chemical_name", "description", "low_alert_ppm", "low_warn_ppm", "high_warn_ppm",
          "high_alert_ppm", "confirmed", "is_builtin", "created_at", "updated_at"],
         [[lit(uid("presets", r["id"])), lit(r["chemical_name"]), lit(r["description"]),
           lit(r["low_alert_ppm"]), lit(r["low_warn_ppm"]), lit(r["high_warn_ppm"]),
           lit(r["high_alert_ppm"]), b(r["confirmed"]), b(r["is_builtin"]), dt(r["created_at"]),
           dt(r["updated_at"])] for r in rows("presets") if not r["is_builtin"]],
         conflict="(chemical_name) do nothing")

    emit("sensor_positions",
         ["id", "incubator_id", "position", "sensor_serial"],
         [[lit(uid("sensor_positions", r["id"])), fk("incubators", r["incubator_id"]),
           lit(r["position"]), lit(r["sensor_serial"])] for r in rows("sensor_positions")])

    emit("voc_runs",
         ["id", "incubator_id", "preset_id", "chemical_name", "preset_snapshot", "start_time",
          "end_time", "notes", "status"],
         [[lit(uid("voc_runs", r["id"])), fk("incubators", r["incubator_id"]),
           fk("presets", r["preset_id"]), lit(r["chemical_name"]), lit(r["preset_snapshot"]),
           dt(r["start_time"]), dt(r["end_time"]), lit(r["notes"]), lit(r["status"])]
          for r in rows("voc_runs")])

    emit("voc_readings",
         ["id", "incubator_id", "run_id", "position", "timestamp", "voc_ppm", "temp_c"],
         [[lit(uid("voc_readings", r["id"])), fk("incubators", r["incubator_id"]),
           fk("voc_runs", r["run_id"]), lit(r["position"]), dt(r["timestamp"]), lit(r["voc_ppm"]),
           lit(r["temp_c"])] for r in rows("voc_readings")])

    emit("voc_alert_events",
         ["id", "incubator_id", "run_id", "position", "ppm", "zone", "message", "timestamp",
          "acknowledged"],
         [[lit(uid("voc_alert_events", r["id"])), fk("incubators", r["incubator_id"]),
           fk("voc_runs", r["run_id"]), lit(r["position"]), lit(r["ppm"]), lit(r["zone"]),
           lit(r["message"]), dt(r["timestamp"]), b(r["acknowledged"])]
          for r in rows("voc_alert_events")])

    total = sum(counts.values())
    header = [
        "-- Generated by scripts/import_incubation.py",
        f"-- source: {db_path}",
        f"-- generated: {datetime.now().isoformat(timespec='seconds')}",
        f"-- total rows: {total}",
        "-- Apply AFTER migrations 0001-0003. Paste into the Supabase SQL editor.",
        "-- (secret settings keys are intentionally excluded)",
        "begin;",
        "",
    ]
    sql = "\n".join(header + out + ["", "commit;", ""])
    out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "incubation_import.sql")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(sql)

    print("Row counts:")
    for t, n in counts.items():
        print(f"  {n:>7}  {t}")
    size_mb = os.path.getsize(out_path) / 1_048_576
    print(f"\ntotal {total} rows -> {out_path}  ({size_mb:.1f} MB)")
    if total == 0:
        print("(source DB has no operational data.)")


if __name__ == "__main__":
    main()
