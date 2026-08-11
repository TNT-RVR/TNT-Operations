#!/usr/bin/env python3
"""
Build `public/ats-townships.bin` from the Alberta Township System survey data.

── Why this exists ──────────────────────────────────────────────────────────

A legal land description is a position in a SURVEY, not in a formula. Township
and range lines were walked in the field; the ranges are re-set at correction
lines every four townships, and 66-foot road allowances are cut inside each
township. So a regular grid drifts, and — worse — it drifts in OPPOSITE
directions either side of a correction line. Measured against real fields, the
grid alone was ~290 m out and visibly wrong on the map.

The old desktop app solved this by shipping every one of the 255,004 surveyed
Alberta sections (`fields/ats_sections.bin`, 5.1 MB). That is too much to hand
a browser for a search box.

── What this ships instead ──────────────────────────────────────────────────

The jogs happen BETWEEN townships. Inside one, the 6×6 section grid is regular
to within a few metres. So this collapses 255,004 sections to 7,196 townships,
each stored as an origin plus a section step, and lets the section and quarter
be computed from that.

Measured over every complete township in the source data, predicting a section
centre this way is out by a median of 10 m and an RMS of 35 m — against a
quarter section 800 m across. The file is ~113 KiB, or about 2% of the source.

Townships outside the data (Saskatchewan, Manitoba, W1–W3) are not in the file
at all; `ats.ts` falls back to its fitted grid for those, which is why the
fallback stays.

── Usage ────────────────────────────────────────────────────────────────────

    python scripts/build_ats_townships.py [path/to/ats_sections.bin]

Defaults to the old app's copy. Writes public/ats-townships.bin and prints the
accuracy it measured, which is the number quoted in ats.ts.
"""
from __future__ import annotations

import math
import struct
import sys
from collections import defaultdict
from pathlib import Path

DEFAULT_SRC = Path(r'C:/Users/tyler/beetent-maps/fields/ats_sections.bin')
OUT = Path(__file__).resolve().parent.parent / 'public' / 'ats-townships.bin'

# Output format. Must match `parseTownshipTable` in src/domain/ats.ts.
MAGIC = b'ATT1'
# mer, twp, rng, pad, south, east, pitchLat, pitchLon, sizeLat, sizeLon
REC = struct.Struct('<BBBxiiHHHH')
assert REC.size == 20

# Fixed-point scales. Latitude at 1e-7° is ~1 cm; the section step at 1e-6° is
# ~11 cm, and it is multiplied by at most 6, so quantising it costs under a
# metre. Both comfortably below the 35 m the model itself carries.
DEG = 1e7
STEP = 1e6


def sec_pos(sec: int) -> tuple[int, int]:
    """Serpentine section numbering → (row from south, column from EAST).

    Section 1 is the south-east corner; 1–6 run east→west along the bottom,
    7–12 run back west→east, and so on to 36 in the north-east.
    """
    idx = sec - 1
    row = idx // 6
    return row, (idx % 6) if row % 2 == 0 else (5 - idx % 6)


def median(xs: list[float]) -> float:
    s = sorted(xs)
    n = len(s)
    return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2


def fit_line(xs: list[float], ys: list[float], fallback_slope: float) -> tuple[float, float]:
    """Least-squares `y = intercept + slope*x`.

    Used to recover a township's origin and its section PITCH at the same time.
    Pitch is not the same as section size: the survey cuts a 66-foot road
    allowance between sections, so the spacing between two section edges is a
    mile PLUS the allowance. Deriving the pitch from a section's own height
    under-counts it by that allowance every row, which walks the prediction
    across the township — the first version of this script did exactly that and
    measured four times the error it should have.

    A township with sections in only one row cannot show a slope; those take the
    fallback, which is the median pitch over townships that could.
    """
    n = len(xs)
    mx = sum(xs) / n
    my = sum(ys) / n
    denom = sum((x - mx) ** 2 for x in xs)
    if denom == 0:
        return my - fallback_slope * mx, fallback_slope
    slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / denom
    return my - slope * mx, slope


def metres(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371008.8
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def main() -> int:
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_SRC
    if not src.exists():
        print(f'source not found: {src}', file=sys.stderr)
        print('Pass the path to the old app\'s ats_sections.bin.', file=sys.stderr)
        return 1

    raw = src.read_bytes()
    if raw[:4] != b'ATS1':
        print(f'not an ATS1 file: {src}', file=sys.stderr)
        return 1
    count = struct.unpack_from('<I', raw, 4)[0]
    rec_in = struct.Struct('<BBBBffff')
    print(f'reading {count:,} sections from {src}')

    townships: dict[tuple[int, int, int], dict[int, tuple[float, float, float, float]]] = defaultdict(dict)
    for i in range(count):
        mer, twp, rng, sec, la0, la1, lo0, lo1 = rec_in.unpack_from(raw, 8 + i * 20)
        if not (1 <= sec <= 36):
            continue
        townships[(mer, twp, rng)][sec] = (la0, la1, lo0, lo1)

    # ── Fit each township from the sections it has ──────────────────────────
    #
    # Taking the bounding box of the sections would work only for the 6,922
    # complete townships; the other 274 are clipped by a river, a lake or the
    # provincial border, and their bbox is not the township. Fitting an origin
    # and a step from each section INDIVIDUALLY, then taking the median, gives
    # the same answer where the township is complete and the right answer where
    # it is not — and the median ignores a section the survey chopped up.
    # Typical pitch, for the handful of townships too sparse to show a slope.
    all_lat_pitch: list[float] = []
    all_lon_pitch: list[float] = []
    for secs in townships.values():
        if len(secs) < 12:
            continue
        rows = [sec_pos(s)[0] for s in secs]
        cols = [sec_pos(s)[1] for s in secs]
        if len(set(rows)) > 1:
            all_lat_pitch.append(fit_line(rows, [b[0] for b in secs.values()], 0)[1])
        if len(set(cols)) > 1:
            all_lon_pitch.append(-fit_line(cols, [b[3] for b in secs.values()], 0)[1])
    fb_lat = median(all_lat_pitch)
    fb_lon = median(all_lon_pitch)
    print(f'typical section pitch: {fb_lat:.6f}° lat, {fb_lon:.6f}° lon')

    fitted: list[tuple[int, int, int, float, float, float, float, float, float]] = []
    for (mer, twp, rng), secs in sorted(townships.items()):
        rows = [sec_pos(s)[0] for s in secs]
        cols = [sec_pos(s)[1] for s in secs]
        south, pitch_lat = fit_line(rows, [b[0] for b in secs.values()], fb_lat)
        # Columns count from the EAST, so east longitude DEcreases with column;
        # negate to keep the stored pitch positive.
        east, neg = fit_line(cols, [b[3] for b in secs.values()], -fb_lon)
        pitch_lon = -neg
        # Section size is the surveyed parcel itself, without the road
        # allowance the pitch includes — so the box drawn is the section.
        size_lat = median([b[1] - b[0] for b in secs.values()])
        size_lon = median([b[3] - b[2] for b in secs.values()])
        fitted.append((mer, twp, rng, south, east, pitch_lat, pitch_lon, size_lat, size_lon))

    # ── Measure what the fit costs, before quantising and after ─────────────
    def predict(t: tuple[float, ...], sec: int) -> tuple[float, float]:
        south, east, p_lat, p_lon, s_lat, s_lon = t
        row, col = sec_pos(sec)
        return south + row * p_lat + s_lat / 2, east - col * p_lon - s_lon / 2

    errs_fit: list[float] = []
    errs_q: list[float] = []
    for mer, twp, rng, south, east, p_lat, p_lon, s_lat, s_lon in fitted:
        exact = (south, east, p_lat, p_lon, s_lat, s_lon)
        quant = (
            round(south * DEG) / DEG, round(east * DEG) / DEG,
            round(p_lat * STEP) / STEP, round(p_lon * STEP) / STEP,
            round(s_lat * STEP) / STEP, round(s_lon * STEP) / STEP,
        )
        for sec, b in townships[(mer, twp, rng)].items():
            t_lat, t_lon = (b[0] + b[1]) / 2, (b[2] + b[3]) / 2
            la, lo = predict(exact, sec)
            errs_fit.append(metres(la, lo, t_lat, t_lon))
            la, lo = predict(quant, sec)
            errs_q.append(metres(la, lo, t_lat, t_lon))

    def report(name: str, errs: list[float]) -> None:
        errs.sort()
        rms = math.sqrt(sum(e * e for e in errs) / len(errs))
        pick = lambda p: errs[min(len(errs) - 1, int(len(errs) * p / 100))]  # noqa: E731
        print(
            f'  {name:<12} n={len(errs):,}  median {pick(50):5.1f} m  '
            f'p90 {pick(90):5.1f} m  p99 {pick(99):6.1f} m  rms {rms:5.1f} m'
        )

    print('\nsection-centre error vs the surveyed section:')
    report('fitted', errs_fit)
    report('quantised', errs_q)

    # ── Write ───────────────────────────────────────────────────────────────
    #
    # Sorted by (meridian, township, range) so the reader can binary-search and
    # so the file is byte-stable across rebuilds.
    out = bytearray(MAGIC + struct.pack('<I', len(fitted)))
    for mer, twp, rng, south, east, p_lat, p_lon, s_lat, s_lon in fitted:
        out += REC.pack(
            mer, twp, rng,
            round(south * DEG), round(east * DEG),
            round(p_lat * STEP), round(p_lon * STEP),
            round(s_lat * STEP), round(s_lon * STEP),
        )

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_bytes(bytes(out))
    print(
        f'\nwrote {OUT} — {len(fitted):,} townships, {len(out) / 1024:.0f} KiB '
        f'({len(out) / len(raw):.1%} of the source)'
    )
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
