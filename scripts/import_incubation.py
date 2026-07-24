"""
Import the old bee-incubation SQLite DB into the TNT Operations Supabase schema.

Reads incubation.db and EMITS a .sql file of INSERT statements (no network, no
service-role secret) that you paste into the Supabase SQL editor. The editor runs
as postgres (bypasses RLS), so the data lands regardless of policies.

Old integer PKs are mapped to stable UUIDs (uuid5), so foreign keys are preserved
and re-running produces the same ids (safe to re-run with the ON CONFLICT guards).

Usage:
    python scripts/import_incubation.py "C:\\Users\\tyler\\My Drive\\BeeIncubation\\incubation.db"
    # → writes scripts/incubation_import.sql

Apply 0001 + 0002 + 0003 migrations FIRST, then paste the generated file.
Column names match supabase/migrations/0003_incubation_full.sql.
"""
import sys, os, sqlite3, uuid
from datetime import datetime

NS = uuid.UUID("6f1a0b3e-0000-4000-8000-746e74696e63")  # fixed namespace for this app


def uid(table: str, old_id) -> str:
    return str(uuid.uuid5(NS, f"{table}:{old_id}"))


def lit(v) -> str:
    """Python value → SQL literal."""
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return repr(v)
    return "'" + str(v).replace("'", "''") + "'"


def b(v) -> str:
    """SQLite 0/1 → SQL boolean."""
    return "NULL" if v is None else ("true" if int(v) else "false")


def fk(table: str, old_id) -> str:
    return "NULL" if old_id is None else "'" + uid(table, old_id) + "'"


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    db_path = sys.argv[1]
    if not os.path.exists(db_path):
        print(f"ERROR: no such file: {db_path}")
        sys.exit(1)

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    out: list[str] = []
    counts: dict[str, int] = {}

    def has(table: str) -> bool:
        return bool(conn.execute(
            "select 1 from sqlite_master where type='table' and name=?", (table,)).fetchone())

    def rows(table: str):
        return conn.execute(f'select * from "{table}"').fetchall() if has(table) else []

    def emit(table: str, cols: list[str], values_rows: list[list[str]]):
        counts[table] = len(values_rows)
        if not values_rows:
            out.append(f"-- {table}: no rows\n")
            return
        out.append(f"insert into public.{table} ({', '.join(cols)}) values")
        out.append(",\n".join("  (" + ", ".join(vr) + ")" for vr in values_rows))
        out.append("on conflict (id) do nothing;\n")

    # ── incubators ────────────────────────────────────────────────────────────
    emit("incubators",
         ["id", "name", "capacity", "govee_device_id", "govee_sku", "temp_mode",
          "temp_alerts_enabled", "humidity_min", "humidity_max", "sort_order", "is_hidden"],
         [[lit(uid("incubators", r["id"])), lit(r["name"]), lit(r["capacity"]),
           lit(r["govee_device_id"]), lit(r["govee_sku"]), lit(r["temp_mode"]),
           b(r["temp_alerts_enabled"]), lit(r["humidity_min"]), lit(r["humidity_max"]),
           lit(r["sort_order"]), b(r["is_hidden"])] for r in rows("incubators")])

    # ── samples ───────────────────────────────────────────────────────────────
    emit("samples",
         ["id", "name", "source", "lot_number", "xray_live_pct", "xray_parasite_pct",
          "xray_dead_pct", "total_volume_gal", "total_weight_lbs", "notes", "import_date"],
         [[lit(uid("samples", r["id"])), lit(r["name"]), lit(r["source"]), lit(r["lot_number"]),
           lit(r["xray_live_pct"]), lit(r["xray_parasite_pct"]), lit(r["xray_dead_pct"]),
           lit(r["total_volume_gal"]), lit(r["total_weight_lbs"]), lit(r["notes"]),
           lit(r["import_date"])] for r in rows("samples")])

    # ── incubation_batches ────────────────────────────────────────────────────
    emit("incubation_batches",
         ["id", "incubator_id", "sample_id", "name", "start_date", "vapona_in", "vapona_out",
          "air_out", "male_10pct_emergence", "earliest_cool", "estimated_release",
          "latest_release", "status", "notes"],
         [[lit(uid("incubation_batches", r["id"])), fk("incubators", r["incubator_id"]),
           fk("samples", r["sample_id"]), lit(r["name"]), lit(r["start_date"]), lit(r["vapona_in"]),
           lit(r["vapona_out"]), lit(r["air_out"]), lit(r["male_10pct_emergence"]),
           lit(r["earliest_cool"]), lit(r["estimated_release"]), lit(r["latest_release"]),
           lit(r["status"]), lit(r["notes"])] for r in rows("incubation_batches")])

    # ── trays ─────────────────────────────────────────────────────────────────
    emit("trays",
         ["id", "tray_number", "sample_id", "incubation_batch_id", "incubator_id", "weight_lbs",
          "live_count", "parasite_level_pct", "volume_gal", "in_date", "out_date", "status", "notes"],
         [[lit(uid("trays", r["id"])), lit(r["tray_number"]), fk("samples", r["sample_id"]),
           fk("incubation_batches", r["incubation_batch_id"]), fk("incubators", r["incubator_id"]),
           lit(r["weight_lbs"]), lit(r["live_count"]), lit(r["parasite_level_pct"]),
           lit(r["volume_gal"]), lit(r["in_date"]), lit(r["out_date"]), lit(r["status"]),
           lit(r["notes"])] for r in rows("trays")])

    # ── inspections (old rich schema → superset table) ────────────────────────
    emit("inspections",
         ["id", "incubator_id", "at", "period", "thermometer_temp_c", "govee_temp_c", "temp_diff_c",
          "temp_alert", "heat_pumps_ok", "parasites_emerging", "bees_emerging", "fans_ok",
          "black_lights_ok", "notes"],
         [[lit(uid("inspections", r["id"])), fk("incubators", r["incubator_id"]), lit(r["timestamp"]),
           lit(r["period"]), lit(r["thermometer_temp_c"]), lit(r["govee_temp_c"]), lit(r["temp_diff_c"]),
           b(r["temp_alert"]), b(r["heat_pumps_ok"]), b(r["parasites_emerging"]), b(r["bees_emerging"]),
           b(r["fans_ok"]), b(r["black_lights_ok"]), lit(r["notes"])] for r in rows("inspections")])

    # ── temp_humidity_readings → sensor_readings ──────────────────────────────
    emit("sensor_readings",
         ["id", "incubator_id", "at", "temp_c", "humidity_pct", "source"],
         [[lit(uid("temp_humidity_readings", r["id"])), fk("incubators", r["incubator_id"]),
           lit(r["timestamp"]), lit(r["temperature_c"]), lit(r["humidity_pct"]), "'govee'"]
          for r in rows("temp_humidity_readings")])

    # ── alerts ────────────────────────────────────────────────────────────────
    emit("alerts",
         ["id", "alert_type", "severity", "incubator_id", "tray_id", "batch_id", "message",
          "triggered_at", "acknowledged", "acknowledged_at", "dedup_key"],
         [[lit(uid("alerts", r["id"])), lit(r["alert_type"]), lit(r["severity"]),
           fk("incubators", r["incubator_id"]), fk("trays", r["tray_id"]),
           fk("incubation_batches", r["batch_id"]), lit(r["message"]), lit(r["triggered_at"]),
           b(r["acknowledged"]), lit(r["acknowledged_at"]),
           lit(r["dedup_key"] if "dedup_key" in r.keys() else None)] for r in rows("alerts")])

    # ── VOC: custom presets (built-ins are seeded by the migration) ───────────
    emit("presets",
         ["id", "chemical_name", "description", "low_alert_ppm", "low_warn_ppm", "high_warn_ppm",
          "high_alert_ppm", "confirmed", "is_builtin", "created_at", "updated_at"],
         [[lit(uid("presets", r["id"])), lit(r["chemical_name"]), lit(r["description"]),
           lit(r["low_alert_ppm"]), lit(r["low_warn_ppm"]), lit(r["high_warn_ppm"]),
           lit(r["high_alert_ppm"]), b(r["confirmed"]), b(r["is_builtin"]), lit(r["created_at"]),
           lit(r["updated_at"])] for r in rows("presets") if not r["is_builtin"]])

    emit("sensor_positions",
         ["id", "incubator_id", "position", "sensor_serial"],
         [[lit(uid("sensor_positions", r["id"])), fk("incubators", r["incubator_id"]),
           lit(r["position"]), lit(r["sensor_serial"])] for r in rows("sensor_positions")])

    emit("voc_runs",
         ["id", "incubator_id", "preset_id", "chemical_name", "preset_snapshot", "start_time",
          "end_time", "notes", "status"],
         [[lit(uid("voc_runs", r["id"])), fk("incubators", r["incubator_id"]),
           fk("presets", r["preset_id"]), lit(r["chemical_name"]), lit(r["preset_snapshot"]),
           lit(r["start_time"]), lit(r["end_time"]), lit(r["notes"]), lit(r["status"])]
          for r in rows("voc_runs")])

    emit("voc_readings",
         ["id", "incubator_id", "run_id", "position", "timestamp", "voc_ppm", "temp_c"],
         [[lit(uid("voc_readings", r["id"])), fk("incubators", r["incubator_id"]),
           fk("voc_runs", r["run_id"]), lit(r["position"]), lit(r["timestamp"]), lit(r["voc_ppm"]),
           lit(r["temp_c"])] for r in rows("voc_readings")])

    total = sum(counts.values())
    header = [
        "-- Generated by scripts/import_incubation.py",
        f"-- source: {db_path}",
        f"-- generated: {datetime.now().isoformat(timespec='seconds')}",
        f"-- total rows: {total}",
        "-- Apply AFTER migrations 0001–0003. Paste into the Supabase SQL editor.",
        "begin;",
        "",
    ]
    sql = "\n".join(header + out + ["", "commit;", ""])
    out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "incubation_import.sql")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(sql)

    print("Row counts:")
    for t, n in counts.items():
        print(f"  {n:>6}  {t}")
    print(f"\ntotal {total} rows -> {out_path}")
    if total == 0:
        print("(source DB has no operational data — the migrations already seed presets + settings.)")


if __name__ == "__main__":
    main()
