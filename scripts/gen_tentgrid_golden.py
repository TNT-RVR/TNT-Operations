"""
Regenerate the tentGrid golden-file fixtures.

Runs every REAL field json from the old beetent-maps app through its
`get_tent_positions()` and records the expected pin coordinates + NW-snake row
indices, plus which code path each field exercises. The TS port
(`src/domain/tentGrid.ts`) is asserted against this in `tentGrid.test.ts`.

This reads the old Python by absolute path and writes ONLY the fixture json in
this repo — it never modifies beetent-maps.

Usage:
    python scripts/gen_tentgrid_golden.py [BEETENT_MAPS_DIR]

Requires: the old repo's deps importable (numpy, utm). Python 3.10+.
"""
import sys, os, json, glob

BEE = sys.argv[1] if len(sys.argv) > 1 else r"C:\Users\tyler\beetent-maps"
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "src", "domain", "__fixtures__", "tentGrid.golden.json")

sys.path.insert(0, BEE)
import maketentgrid as M  # noqa: E402

FIELDS = os.path.join(BEE, "fields")


def is_real_field(path: str) -> bool:
    base = os.path.basename(path)
    if base.endswith("_map.json"):
        return False
    if base.endswith("_presets.json") or base.endswith("_prefs.json"):
        return False
    # config json (ats etc.) live directly in fields/, not under a company folder
    return os.path.basename(os.path.dirname(path)) != "fields"


def classify(fd: dict) -> str:
    mode = str(fd.get("shelter_mode") or "").strip().lower()
    if mode == "manual":
        return "manual"
    use_bays = fd.get("use_bays", True)
    if isinstance(use_bays, str):
        use_bays = use_bays.strip().lower() in ("1", "true", "yes", "y", "on")
    else:
        use_bays = bool(use_bays)
    planter = [p for p in (fd.get("planter_passes") or []) if p and len(p) >= 2]
    use_imported = bool(fd.get("use_imported_passes", True))
    user_spacing = bool(mode == "spacing" and str(fd.get("spacing") or "").strip())
    if use_imported and planter and not user_spacing and use_bays and mode != "spacing":
        return "pass_following"
    return "synthetic_grid"


def main() -> None:
    paths = sorted(p for p in glob.glob(os.path.join(FIELDS, "**", "*.json"), recursive=True)
                   if is_real_field(p))
    fixtures = []
    for p in paths:
        with open(p, "r", encoding="utf-8") as f:
            fd = json.load(f)
        rel = os.path.relpath(p, FIELDS).replace("\\", "/")
        pos, rows = M.get_tent_positions(fd, use_metric=True, return_rows=True)
        fixtures.append({
            "name": rel,
            "branch": classify(fd),
            "field": fd,
            "expected_positions": [[round(a, 8), round(b, 8)] for a, b in pos],
            "expected_rows": list(rows),
        })
        print(f"{len(pos):>5} pins | {classify(fd):16} | {rel}")

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(fixtures, f)
    print(f"\nwrote {len(fixtures)} fixtures -> {os.path.normpath(OUT)}")


if __name__ == "__main__":
    main()
