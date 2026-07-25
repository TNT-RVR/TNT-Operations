# Bee Tent Maps — Complete Product & Functionality Specification

**Purpose of this document:** a single, self-contained spec so a *different* Claude
Code chat can rebuild this system from the ground up (web-based), combined with
another app, **without losing the nuance, formulas, defaults, reasoning, or
features**. Everything here is drawn from the working code (`beetent_app.py`,
`maketentgrid.py`, `tablet/`, `web/`, `supabase_sync.py`) and is authoritative.

Companion docs in the repo: `CLAUDE.md` (architecture notes), `HANDOFF_UNFINISHED.md`
(what's not done). This file is the *what and why of everything*.

---

## PART 1 — THE BUSINESS & THE "WHY"

### 1.1 What the company does
This is field-ops software for a **commercial leafcutter-bee pollination business**.
The company is hired **under contract** by seed/agriculture companies —
**BASF, Bayer, Hytech, Nutrien / Proven Seeds, and Corteva** — to pollinate their
**hybrid canola (and some carrot) seed-production fields**. Fields are typically
**centre-pivot irrigated circles** (or drawn polygon boundaries).

The crop is planted in a **male/female bay pattern**: strips of *female* (seed-bearing)
rows separated by strips of *male* (pollen-donor) rows. The bees must move pollen
from the male rows onto the female rows. To do that efficiently, the company places
**bee shelters** (small field structures holding the bees) at calculated positions —
one shelter per male bay, spaced down the field — so the bees fan out and pollinate.

### 1.2 The end-to-end system we are building (the vision)
A **fully integrated ecosystem** with four connected layers:

1. **Plan (office / desktop-or-web):** Take the fields we're contracted to
   pollinate → build **custom, editable satellite maps** loaded with information
   (boundaries, pivots, bays, calculated shelter positions, sprayer/planter passes,
   exclusion zones, crew routes, entrance/parking). Export GPS files + PDF maps.

2. **Execute (field / tablet + phone app):** That plan **feeds to the field crews**
   through a **tablet/phone PWA** that acts as a **live GPS + mapping system** —
   crews drive to each shelter position, place shelters, scan QR codes on
   shelters/trays, and calibrate the grid to real-world GPS.

3. **Back-feed (live, two-way):** As crews work, the app **feeds data back to the
   main software with live updates** — **where each crew is** (live GPS pins) and
   **how much they've done** (shelters placed, % complete, per-field progress),
   plus crew **calibration corrections** that nudge the planned grid to reality.

4. **Analyze (financial + operational):** All of it flows into **financial analysis
   and summaries** — cost/profit per field and per season computed from **bee costs,
   tray costs, shelter/block/flag costs, chemical, fuel, and labour (wages)**,
   against the **contract $/acre revenue**.

### 1.3 The full "product ecosystem" goal (data lineage)
Beyond a single season's map, we want a **connected chain of records** so physical
inventory can be traced through the whole year to improve **efficiency, systems, and
safety**:

```
Nesting blocks  →  Shelters  →  Trays  →  Incubators  →  (season timeline)
   (bees live       (hold the    (hold the   (where bees
    in the           blocks in    bee cocoons  are warmed/
    blocks)          the field)   / larvae)    emerged)
```

- **Nesting block data** is tied to **shelter data** (which blocks went in which
  shelter, where).
- **Shelter data** is tied to **tray data** (how many trays / how many bees per
  shelter).
- **Tray data** is tied to **incubator data** (which trays were incubated where and
  when for emergence timing).
- That chain **follows through the year** so we can answer: which bees/blocks went
  where, how they performed, where losses happened, and how to improve next season.

Today the app captures pieces of this (shelter QR scans → tray QR scans → field
placement, with GPS + crew + timestamp). The rebuild should make the **full lineage
first-class** (blocks ↔ shelters ↔ trays ↔ incubators ↔ season).

### 1.4 The three surfaces (current implementation)
| Surface | Who | Tech today | Role |
|---|---|---|---|
| **Desktop planner** (`beetent_app.py`, ~9k lines) | Office / agronomy operator (Tyler) | Windows, Python + customtkinter + tkintermapview | Authoritative authoring: plan fields, place shelters, cost/profit, exports |
| **Tablet/phone crew app** (`tablet/`) | Field crews | PWA, HTML/JS + MapLibre GL | In-field GPS + map, scan QR, mark placed, calibrate, offline |
| **Web app** (`web/`) | Anyone, browser | HTML/JS + MapLibre + Supabase | (In progress) read-only field viewer; will become the full web planner |

For the **rebuild**, the target is a **unified web-based system** covering all three
roles (plan + execute + analyze) with one codebase and a real backend (Supabase /
Postgres), while preserving every formula and option below.

---

## PART 2 — LEAFCUTTER BEES (critical domain knowledge)

**WE USE ALFALFA LEAFCUTTER BEES (*Megachile rotundata*), NOT HONEY BEES.** This
matters throughout the design — the biology drives the whole shelter/tray/block
system.

### 2.1 How leafcutter bees differ from honey bees
| | **Leafcutter bee** (what we use) | Honey bee |
|---|---|---|
| Social structure | **Solitary** — every female is fertile and nests alone; no queen, no hive, no colony | Eusocial — one queen, workers, a colony |
| Nesting | In **tunnels/cavities** — we provide **nesting blocks** (boards/polystyrene with rows of holes/tunnels) | Wax comb in hives |
| Brood cells | Female lines a tunnel with **cut leaf pieces** (hence "leafcutter"), lays an egg on a pollen/nectar loaf, seals a cell, repeats | Larvae raised communally in comb |
| Overwintering | Larvae/prepupae rest inside **cocoons** through winter; deliberately **incubated** in spring to time emergence to bloom | Colony overwinters as a cluster |
| Management unit | **Cocoons / larvae are handled loosely and measured by volume (gallons) and in trays** | Measured in colonies/hives |
| Honey | **Does not make honey** | Makes honey |
| Pollination | Extremely efficient **per-bee** pollinator for alfalfa/canola seed; belly-carries pollen (not corbiculae) | Efficient but different behaviour |
| Range | **Short foraging range** (tens of metres) → must be **distributed densely** across the field (one shelter per male bay), which is exactly why shelter placement geometry matters | Longer range |

### 2.2 Why this drives the app
Because leafcutter bees are **solitary, short-range, and managed by volume/trays**:
- We measure bee quantity in **gallons of loose cells** and **trays**, not hives.
  (`gals_per_acre`, `gals_per_tray` — see formulas.)
- Bees live in **nesting blocks** placed inside **shelters**; **X blocks per shelter**.
- Because range is short, shelters must be **spread across the whole field, one per
  male bay** — the placement geometry (Part 5) exists to get bees within range of
  every female row.
- Spring **incubation** timing (trays → incubators) syncs emergence to bloom.
- After bloom, shelters/blocks/trays are **collected**, cocoons harvested, and the
  cycle repeats — hence the year-long lineage (Part 1.3).

Never conflate with honey bees, hives, or colonies anywhere in the rebuild.

---

## PART 3 — CORE DOMAIN CONCEPTS

- **Field** — one contracted parcel to pollinate. Has a company, year, name, LLD
  (legal land description, e.g. `NW-1-20-15-W4`), a **pivot point** (centre of the
  irrigation circle), and either a **boundary polygon** or a radius.
- **Pivot / pivot point (PP)** — centre of the centre-pivot irrigation system
  (lat/lon). Some fields have **two pivots**.
- **Pivot tracks** — the ruts the pivot wheels carve (concentric circles at given
  radii). Shelters must avoid them (± an exclusion buffer).
- **Bays** — the planting pattern across the field, made of **rows**:
  - **Female bay** — a strip of `num_female_rows` seed rows.
  - **Male bay** — a strip of `num_male_rows` pollen rows.
  - Rows are `row_spacing_in` inches apart. A repeating unit tiles the planter.
- **Planter pass** — one full width of the planter/implement = `total_rows × row_spacing`.
  Passes tile the field; the pattern **snakes** (every other pass mirrored).
- **Shelter** — the field structure holding the bees; placed **one per male bay**,
  offset a few feet to the west of the male bay so its opening faces into the bay.
- **Sprayer passes / sprayer width** — spray equipment path; used for exclusion
  zones and pass overlays.
- **Trays / blocks / gallons** — bee inventory units (Part 2).
- **Crew** — a team in the field; a field can have multiple crews working it.

---

## PART 4 — THE FIELD DATA MODEL (every key + default)

The `current_field` dict is the whole state of a field, saved as JSON at
`fields/<Company>/<Year>/<Name>.json` and mirrored to Supabase (`fields` table:
`company, year, name, data jsonb, updated_at`; unique on company+year+name).

**`blank_field()` defaults (exact):**

| Key | Default | Meaning |
|---|---|---|
| `Name` | `""` | field name (no `#` or `/` — breaks folders + John Deere upload) |
| `company` | `""` | contracting company (BASF, Bayer, Hytech, Proven Seeds/Nutrien, Corteva…) |
| `year` | `""` | pollination year |
| `lld` | `""` | legal land description |
| `PP_Latitude`, `PP_Longitude` | `""` | pivot point |
| `Planting_angle` | `""` | planting direction, degrees (0 = N–S) |
| `Spray_angle` | `""` | spray direction, degrees (falls back to planting angle) |
| `Sprayer_width` | `"133"` | ft — sprayer boom width (used for pass overlay + column spacing) |
| `shelter_mode` | `"trays_2"` | how shelter count is derived (see §7) |
| `num_structures` | `""` | target shelter count (when `shelter_mode="total"`) |
| `shelters_per_acre` | `""` | (mode `per_acre`) |
| `acres_per_shelter` | `""` | (mode `acres_per_shelter`) |
| `spacing` | `""` | along-row shelter spacing override (mode `spacing`) |
| `shelter_spacing` | `""` | lateral shelter spacing override |
| `directional_offset` | `""` | |
| `row_spacing_in` | `"22"` | **inches between planter rows** |
| `num_female_rows` | `"8"` | female rows per bay unit |
| `num_male_rows` | `"2"` | male rows per bay unit |
| `bay_gap_in` | `"0"` | **extra unplanted gap (in) at each male/female bay edge**; 0 = none |
| `total_rows` | `"20"` | rows on the planter (may exceed nf+nm if the unit repeats) |
| `row_layout` | `"centered"` | `"outer"` \| `"centered"` \| `"custom"` |
| `custom_row_mask` | `""` | e.g. `"FFFMMMFFF"` (only when layout=custom) |
| `use_bays` | `True` | `False` = blanket-planted crop, no bay constraint |
| `shelters_in_outside_pass` | `"Yes"` | allow shelters in the outermost pass |
| `track_exclusion_ft` | `"10"` | ft buffer each side of a pivot track (no shelters) |
| `spray_both_ways` | `False` | square grid sprayable at 0° AND 90° (rare) |
| `pass_edge_buffer_ft` | `"25"` | ft a shelter may intrude into a pass from its edge |
| `tire_width_ft` | `"14"` | ft drive/tire width shown down each pass centre (red zone) |
| `shelter_buffer_m` | `"1.524"` | 5 ft — radius of the shelter buffer circle (section-control) |
| `planter_passes` | `None` | imported JD planter path polylines `[[(lat,lon),…],…]` |
| `use_imported_passes` | `True` | use imported passes if present, else synthetic grid |
| `sprayer_passes` | `None` | uploaded GPS sprayer tracks |
| `gals_per_acre` | `"3"` | **gallons of bees per acre** |
| `acres` | `""` | field acres (auto from boundary unless `acres_manual`) |
| `acres_manual` | `False` | user typed acres, don't auto-calc |
| `gals_per_tray` | `"2"` | **gallons per tray** |
| `tray_distribution` | `"even"` | how trays spread across shelters |
| `boundary_polygon` | `None` | `[[lat,lon],…]` field boundary |
| `pivot_tracks` | `[]` | list of track radii (metres) |
| `corner_arms` | `[]` | corner-arm paths (extra reach beyond the circle) |
| `two_pivots` | `False` | field served by two pivots |
| `PP2_Latitude/Longitude` | `""` | second pivot |
| `pivot_tracks2` | `[]` | second pivot's track radii |
| `Radius2` | `""` | second pivot circle radius (no-boundary fields) |
| `boundary_inner` | `[]` | inner exclusion polygons (JD "interior boundaries") |
| `access_road_boundary` | `[]` | pivot access road(s) — exclusion, labelled separately |
| `wet_zones` | `[]` | informational wet-spot polygons (NOT exclusions) |
| `entrance_pin` | `None` | `[lat,lon]` where the crew enters the field |
| `parking_pin` | `None` | `[lat,lon]` where trucks park |
| `crew_route_override` | `None` | manually-edited crew travel line |
| `sprayer_routes_around_inner` | `True` | sprayer lines break around inner boundaries |
| `bays_through_inner` | `False` | draw bays through inner boundaries vs clip |
| `shelter_at_pivot` | `False` | allow a shelter at the pivot centre |
| `manual_shelter_pins` | `[]` | user-added extra shelters (kept if mode switches) |
| `shelter_overrides` | `{}` | `{idx: [lat,lon]}` manual drags; `{idx: None}` = deleted |
| `tray_overrides` | `{}` | `{idx: count}` manual per-shelter tray counts |
| `adjust_by_combo` | `{}` | overrides stored **per settings combo** (see §5.7) |
| `bay_shift_e_m`, `bay_shift_n_m` | 0 | lateral bay/flag shift from crew calibration (metres) |
| `computed_shelters` | (web only) | `[[lat,lon],…]` grid the desktop pushes to Supabase for the web |
| `home_to_parking_km/min`, `home_coords_used` | | cached Google road dist/time home→parking (financial) |

Unit constants used everywhere: **1 inch = 0.0254 m**, **1 ft = 0.3048 m**,
**4 ft = 1.2192 m**, **5 ft = 1.524 m**.

---

## PART 5 — THE PLACEMENT ENGINE (`maketentgrid.py`) — every formula

This is the **crown jewel** — a pure module (no GUI) that computes shelter
positions. Port it faithfully. Every field-geometry bug the app ever hit lived
here, so it now has a **113-test suite + golden regression baseline** (Part 12).

### 5.1 Coordinate frame
- **ENU (East-North-Up) metres** relative to the pivot, via a UTM-style projection
  (`utmish.from_lonlat`). `latlon_to_enu(lat,lon,plat,plon)` → (e,n) metres.
- A **rotation** by the planting angle turns ENU into a **(lateral, along)** frame:
  `rot = radians((180 - angle) % 360 - 180)`, lateral unit `(cos,sin)`, travel unit
  `(-sin,cos)`. "Lateral" = across passes (+x ≈ east); "along" = down the pass.

### 5.2 Row mask (which rows are male vs female)
`resolve_row_mask(nf, nm, layout, custom, total_rows)` → a string of `M`/`F`,
length `total_rows`:
- **centered:** unit = `F×(nf//2)` + `M×nm` + `F×(nf-nf//2)`, e.g. 6F/3M →
  `FFFMMMFFF`. Tiled/truncated to `total_rows`.
- **outer:** unit = `M×(nm//2)` + `F×nf` + `M×(nm-nm//2)` (male on the edges).
- **custom:** the user's `MF` string verbatim (its length wins over `total_rows`).

`mask_runs(mask, 'M')` → list of `(start, end_exclusive)` contiguous male runs.

### 5.3 Gap-aware bay tiling — `bay_slot_lefts(mask, rs_m, gap_m)`  **(critical)**
Returns `(lefts, pass_w)`:
- `lefts[k]` = lateral left-edge (m) of row slot `k`.
- Build cumulatively: start 0; each next slot adds `rs_m`, **plus `gap_m` whenever
  the mask character changes** (a male/female boundary). So the gap is inserted
  **between bays**, never inside a male run.
- `pass_w = lefts[-1] + rs_m` (+ one wrap `gap_m` only if the mask's two ends differ).
- **`gap_m = 0` reproduces the old uniform tiling exactly** (`lefts[k] = k·rs_m`,
  `pass_w = len(mask)·rs_m`) — so gap-free fields never move.
- A male run `(s,e)` then spans `lefts[s] .. lefts[e-1] + rs_m` = **exactly
  `(e-s)·rs_m` wide** (its own rows), with the gaps landing OUTSIDE it.
- **Why this exists:** `bay_gap_in` used to be *subtracted from* the male band, so a
  gap ≥ half the bay collapsed the band to zero width (the Wordmans/Carrots
  "hairlines on one side" bug — a 3-row 66″ male bay with 33″ gap each side = 0).
  The gap is a real *inter-bay* gap, so it must be inserted between bays.

### 5.4 Shelter lateral positions — `male_bay_shelter_laterals(...)`
One shelter row **per male bay**, placed **`MALE_BAY_OFFSET_FT = 5 ft` (1.524 m)
WEST of each male bay's west edge** so the shelter's east-facing opening points into
the male bay:
- Compute `lefts_fwd, pass_w = bay_slot_lefts(mask, rs_m, gap_m)` and
  `lefts_rev` from the reversed mask. `half = pass_w/2`.
- `n_pass = int(radius / pass_w) + 2`. Pivot sits on a pass boundary (no pass on the
  pivot).
- For each pass `i` in `[-n_pass … n_pass]`, `xc = (i+0.5)·pass_w`. The planter
  **snakes**: even passes use `runs`+`lefts_fwd`, odd passes use `runs_rev`+`lefts_rev`
  (parity flipped by `phase = 1 if pass_phase_swap else 0`). For each male run `(s,e)`:
  `x = xc + lefts_i[s] - half - offset_m`  (male-bay west edge − 5 ft).
- Returns sorted, de-duplicated lateral positions. Edge male runs (touching a pass
  boundary) pair with the neighbouring mirrored pass's edge run to form a full
  `nm`-row bay — this is why split masks still yield full bays.

### 5.5 `get_tent_positions(field_dict, use_metric=True) → [(lat,lon), …]`
The main entry. Returns shelters in **NW-snake order** (numbered from the NW corner,
snaking S then N through columns). Key logic:
- **Blanket-planted** (`use_bays=False`): uniform grid at `sprayer_width` spacing,
  `lat_offset = 0`.
- **Bay-aware (primary):** column spacing `tent_row_width = sprayer_width`,
  `lat_offset = 0`, and each column **snapped to the nearest `male_bay_shelter_laterals`
  position** (so columns land on male bays). Uses the boom width for column density
  so N–S spacing fills the field evenly.
- **Fallback** (empty/odd mask): `tent_row_width = (nf+1)·rs_m + (nm+1)·rs_m + 2·gap_m`,
  `lat_offset = 1.2192` (4 ft), old female+male period, no bay snap.
- **Along-pass (N–S) spacing** priority:
  1. user-given `spacing` → use as-is, do **not** trim to count;
  2. `num_structures` (no spacing) → `find_exact_spacing()` then trim to the target;
  3. neither → `calculate_spacing()` auto.
- **Exclusions applied while placing:** outside the boundary (or pivot circle union
  for two-pivot no-boundary fields); inside inner/access-road polygons; within
  `track_exclusion_ft` of a pivot track (checked against the **nearest** pivot);
  inner no-shelter zone at the pivot; outside-pass rule (`shelters_in_outside_pass`);
  `pass_edge_buffer_ft` intrusion allowance. Point-in-polygon over the (often
  hundreds-of-vertex) boundary is the perf hot spot → the app memoises + runs it
  **off the main thread** (`_ensure_tents`).

### 5.6 Crew route — `crew_route(field_dict, use_metric, shelters=None) → (route_latlon, total_m)`
A snake driven down the **centre of the male bays that have shelters**, mirroring the
bay overlay: group shelters by nearest male-bay centre, snake column to column. Each
pass runs the **full length to the field boundary**; consecutive passes are joined by
following the **boundary perimeter (headland)** — never across the crop. If a
`parking_pin` is set the route **starts and ends there**. Length is computed in the
rotated metric frame (shift-invariant). A `crew_route_override` polyline, if present,
replaces the computed route.

### 5.7 Manual overrides, scoped per "combo"
Manual shelter drags/deletes (`shelter_overrides`) and tray counts (`tray_overrides`)
are stored **per settings combo** in `adjust_by_combo`. `_combo_key()` = shelter mode
+ its count + `shelters_in_outside_pass` + `spray_both_ways`. Changing a setting that
changes the base grid swaps to that combo's saved override set (so old moves don't
mis-apply). **Rule for the rebuild:** any new setting that changes which grid indices
are valid must be part of the combo key. **"Reflow to Grid"** clears the current
combo's overrides so shelters re-snap to the recomputed grid (used after a geometry
change; keeps manually-added pins).

### 5.8 Save-time validation — `field_warnings(field_dict) → [str]`
Pure checker surfaced as a "Possible field issues" prompt on save. Flags: no male
rows; row spacing 0; `total_rows` < one bay unit; custom-mask length ≠ `total_rows`;
`bay_gap_in` as wide as the female bay; <3 boundary points. The GUI adds compute-based
checks: **zero shelters placed**, and **pivot far from the boundary**.

---

## PART 6 — DESKTOP PLANNER UI: every menu, tool, action, toggle

The desktop app's map screen has three toolbar rows over the satellite map:
**LAYERS** (visibility chips), **TOOL** (which layer is "active" — pulls its tools
into a side strip), and **ACTIONS** (the active layer's actions). There is also a
collapsible **Layers/legend inset** (top-left) and a collapsible **side tool strip**
(right edge), each with a disclosure arrow.

The six layers/tools and their actions (label → what it does):

### 6.1 🎯 Pivot  (visibility var drives `show_pivot`, `show_tracks`, `show_corner_arms`)
- **Set Pivot Point** — click to place the pivot (red draggable marker).
- **Set 2nd Pivot Point** / **Toggle Two Pivots** — rare dual-pivot fields (orange
  2nd pivot; each pivot keeps independent tracks + radius).
- **Add Pivot Track** / drag handles / **Delete Track** — concentric orange track
  circles at radii (metres); each draws two circles at radius ± `track_exclusion_ft`.
- **Set Field Radius** (no-boundary fields).

### 6.2 ⭕ Boundary  (`show_boundary`)
- **Draw / Edit Boundary** — the field polygon (`#00CED1` cyan). Vertex drag handles.
- **Upload Boundary** — `.shp` / `.kml` / `.kmz` import.
- **Add / Edit / Delete Inner Boundary** — interior exclusion polygons (orange).
- **Add / Edit / Delete Access Road** — pivot access road exclusion (pink `#FF2D95`).
- **Add / Edit / Delete Wet Zone** + **Toggle Wet Zones** — informational wet spots
  (cyan fill; NOT exclusions; shown to crews).
- **Set Entrance Pin** (green "E") / **Set Parking Pin** (amber "P") /
  **Set Home Pin (depot)** (blue "H", **global**, stored in cost prefs not the field) /
  **Delete Entrance/Parking**.
- **Toggle Field Info** — show/hide the entrance/parking/home markers.

### 6.3 ⋰⋮⋱ Sprayer  (`show_passes`, `show_pass_buffer_overlay`)
- **Shift** — nudge sprayer passes laterally (a `sprayer_shift`).
- **Import Sprayer Data** / **Toggle Uploaded Paths** / **Clear Uploaded Paths** —
  uploaded GPS sprayer tracks (`#FF8C00`).
- **Set Edge Zone & Tire Width** — sets `pass_edge_buffer_ft` (default 25) and
  `tire_width_ft` (default 14).
- **Toggle Tire & Edge Zone** — draws the tire zone (`#FF2A2A` down each pass centre)
  and edge zone (`#22E048` at pass edges); shelter section-control aid.
- **Toggle Pass Through Inner** — sprayer pass lines break around inner boundaries or
  run through (`sprayer_routes_around_inner`).
- Always-drawn: the **outer sprayer limit** — one sprayer-width inside the boundary
  (`inset_polygon_enu`), bright green line, not gated by the passes toggle.

### 6.4 🌱 Planter  (`show_bays`, `show_planter_numbers`, `show_planter_passes`)
- **Shift** — lateral **bay shift** (`bay_shift_e_m/n_m`); moves bays + flags together.
- **Toggle Male Bays** — the blue (`#2E9BF0`) male-bay bands (see §5.3 geometry).
- **Import Planter Data** — imported JD planter path polylines (`planter_passes`).
- **Number Planter Passes** — numbered pass overlay (`#FFB000` lines + numbers); passes
  numbered outward from the pivot (west +, east −; the pivot pass is #0 if ≥5 ft inside).
- **Clear Planter Data**.
- **Toggle Bays Through Inner** — bays draw through inner boundaries vs clip
  (`bays_through_inner`).

### 6.5 🐝 Shelters  (`show_shelters`)
- **Add Shelter Pin** — add a manual extra shelter (`manual_shelter_pins`).
- **Add Test Shelter Pin** — a blue test shelter (`#1E90FF`), counted separately.
- **Toggle Alignment Lines** — the ideal triangular guide mesh (near-black `#101010`)
  the crew keeps flags straight to. **Fitted to the pins actually on screen** (applies
  `shelter_overrides` before fitting the lattice; genuinely off-grid pins are excluded
  from the fit).
- **Reflow to Grid** — clear the current combo's overrides so shelters re-snap to the
  recomputed grid (keeps manually-added pins). See §5.7.
- **Show Planned / Actual** — switch between planned pins and scanned actual placements.
- **Numbers: Tray count / Shelter # / Off** — pin labels.
- **Toggle Shelter Buffer Zone** + **Set Shelter Buffer Size** — the 5 ft (1.524 m)
  buffer square around each shelter (`shelter_buffer_m`; blue outline) for section
  control.
- **Set gals for all test shelters / Test shelters count in total / Test gals count in
  total** — test-shelter accounting toggles.
- **Import Actual Shelter Pins (CSV)**.

### 6.6 🚜 Crews  (`show_crews`)
- **Show driving distance** — total crew-route km on the status line.
- **Edit Crew Route** / **Reset Crew Route** — drop draggable vertices to hand-edit
  the travel line (`crew_route_override`), or clear it. Purple (`#A855F7`).

### 6.7 Global map tools (side strip top + top bar)
- **📏 Measure** (+ unit toggle ft↔in / m↔cm), **↶ Reset Move** (bulk-clear shelter
  moves), **↶ Undo / ↷ Redo** (whole-field, Ctrl+Z / Ctrl+Y — §9), **☁ Refresh/Sync**
  (git pull/push), **Field Summary PDF**, **Find by LLD**.

### 6.8 Legend
A dynamic key inside the Layers inset listing **only the overlays currently on**, each
row keyed to its exact draw gate, with a swatch matching the real stroke/fill:
**pin** = the actual map marker shape; **line** = a horizontal stroke of the real
colour + pixel width; **ring** = a hollow square (buffer zones); **box** = filled
swatch (male bay / wet / tire / edge zones).

---

## PART 7 — SHELTER COUNT MODES + BEE/TRAY DISTRIBUTION (formulas)

### 7.1 Shelter-count modes (`shelter_mode`)
| Mode | Key | Count formula |
|---|---|---|
| `total` | `num_structures` | user's exact number |
| `per_acre` | `shelters_per_acre` | `ceil(shelters_per_acre × acres)` |
| `acres_per_shelter` | `acres_per_shelter` | `ceil(acres / acres_per_shelter)` |
| `spacing` | `spacing` | derived from along-row spacing (engine trims to fit) |
| `trays_1` | derived | `ceil(total_trays / 1)` bee-derived |
| `trays_2` (**default**) | derived | `ceil(total_trays / 2)` |
| `manual` | `manual_shelter_pins` | count of manual pins |

### 7.2 Bees, gallons, trays
- `total_gals = gals_per_acre × acres`  (default gals/acre = 3)
- `math_trays = ceil(total_gals / gals_per_tray)`  (default gals/tray = 2)
- `total_trays = max(math_trays, num_shelters)`  (never fewer trays than shelters)
- **Tray distribution across shelters** (`_compute_bee_distribution`): base per
  shelter = `total_trays // num_shelters`; the remainder
  `extras = total_trays % num_shelters` shelters each get +1 tray. `tray_distribution`
  = `"even"` (default) spreads the extras; other modes weight them.
- Per-shelter tray counts can be overridden (`tray_overrides`).

---

## PART 8 — FINANCIAL VIEW / COST ESTIMATOR (every input, default, formula)

The Financial View has four tabs: **General Information**, **Cost Estimator**,
**Profitability**, **Seasons**. **Everything is stored PER PRICING YEAR** (a year
dropdown swaps the whole form; missing years carry forward from the most recent
earlier year). Persisted to `cost_prefs.json` under `by_year`. The Google Maps API
key + the **global home/depot pin** live here (not per year).

### 8.1 Inputs & defaults (General Information)
Items (each with **unit cost** + **depreciation life in years**; amortized cost =
`unit_cost ÷ life ÷` … see below): shelters, trays, nesting blocks (with
`blocks_per_shelter`), flags, and **bees** (`cost_per_gal_bee`, 1-yr life — full cost
every year). Plus:

| Input | Default | Meaning |
|---|---|---|
| `chem_cost_per_acre` | — | chemical $/acre |
| `fuel_l_per_km` | **0.35** | equipment fuel use (L/km) |
| `fuel_cost_per_l` | — | $/L |
| `pay_per_hour` | — | average wage $/hr |
| `drive_speed_kmh` | **15** | in-field driving speed between shelters |
| `crews_setup / crews_bees / crews_removal` | — | number of crews per task |
| `emp_per_crew_setup/bees/removal` | **1 / 1 / 1** | employees per crew |
| `time_setup_min / time_bees_min / time_removal_min` | — | handling min per shelter/tray/shelter |
| `load_setup_min_per_shelter` / `load_bees_min_per_tray` / `load_removal_min_per_shelter` | — | truck loading min per unit |
| Contract **$/acre** per company | — | revenue rate (Contracts card) |
| Home/depot pin (`home_lat/lon`) | — | **global** depot for travel |

### 8.2 `_field_cost(f, c)` — per-field cost (exact)
Let `n` = shelters, `trays`, `gallons`, `acres`, `pay = pay_per_hour`.

**Amortized item costs** (unit ÷ life-years; `life()` returns 1 if ≤0):
```
shelter  = n     × cost_per_shelter / shelter_life_yr
bee      = gallons × cost_per_gal_bee            # 1-yr life (full cost each year)
tray     = trays × cost_per_tray    / tray_life_yr
block    = n × blocks_per_shelter × cost_per_block / block_life_yr
flag     = n     × cost_per_flag    / flag_life_yr
items    = shelter + bee + tray + block + flag
chemical = acres × chem_cost_per_acre
```

**Travel cache** (per field, filled by the "↻ Update travel times" Google Distance
Matrix call): `rt_km`, `rt_min` = one-way home→parking road km/min;
`rt_h = rt_min/60 × 2` (round trip hours).

**Per task** (`task` runs for setup / bees / removal; `crews`, `epc` = emp/crew,
`people = crews × epc`, `mins` = handling min/unit, `route_km` = in-field crew-route
km, `speed = drive_speed_kmh or 15`):
```
work_h       = n × mins / 60                       # total handling person-hours
load_h       = units × load_min / 60               # units = n (setup/removal) or trays (bees)
drive_h      = route_km / crews / speed            # in-field driving (shared across crews)
dur_h        = (work_h + load_h)/people + drive_h  # wall-clock DURATION
drive_labour = people × drive_h × pay
field_labour = work_h × pay + drive_labour         # handling + in-field driving (paid)
load_labour  = load_h × pay
travel       = people × rt_h × pay                 # home↔field round trip, paid
fuel_km      = rt_km × 2 × crews + route_km        # each crew drives the round trip; route shared once
fuel         = fuel_km × fuel_l_per_km × fuel_cost_per_l
task_labour  = field_labour + load_labour + travel
```
**Key reasoning:** *work* (handling + loading) is **crew-count invariant** (total
person-hours split across people); *travel + fuel* **scale with crews**; adding crews
shortens the wall-clock `dur_h` but not the work cost.

**Totals:**
```
labour_total = Σ task_labour (setup+bees+removal)
fuel_total   = Σ task fuel
total        = items + chemical + fuel_total + labour_total
cost_per_acre = total / acres
```
**Revenue / profit** (attached by `_cost_compute`): `contract_value = contract_rate ×
acres`; `net_profit = contract_value − total`; `profit_per_acre = net_profit / acres`.

### 8.3 Tabs
- **Cost Estimator** — company/year scope + per-field checkboxes → per-field cards +
  CSV + landscape PDF (to `~/Downloads`, archived to the output library). Hero shows
  Cost/ac, Profit/ac, and (when a rate is set) Contract value / Total cost / Net
  profit. Breakdown grouped: Items, Bees, Chemical, Fuel, Labour (loading / on-field /
  travel sub-lines). **PDF caveat:** fpdf core fonts are latin-1 — dynamic text must go
  through a latin-1 sanitiser or em-dash/→ raise UnicodeEncodeError.
- **Profitability** — live ranking (no compute button); ranks companies AND fields by
  **profit/acre** high→low; a red ❗ flags fields missing acreage / shelters / contract
  rate / travel. Each field costed with **its own year's** prices/rate.
- **Seasons** (new) — aggregates every field by **year**: fields, acres, cost, revenue,
  profit, cost/acre, profit/acre, with a **▲/▼ $X/ac vs previous season · ±N acres**
  delta per row, profit/acre **trend bars** (green/red), and a **by-company** split
  within each year. Company scope + ↻ Refresh; result cached.

---

## PART 9 — DESKTOP: OTHER SYSTEM BEHAVIOURS

- **Undo/redo** (whole-field, Ctrl+Z / Ctrl+Y, + buttons) — built on the autosave
  change-detector: when a change commits, the snapshot it replaced is pushed to the
  undo stack. Edits within one 2.5 s autosave tick **coalesce** (a whole drag = one
  undo). Per-field stacks, capped 40; a new edit clears redo; Ctrl+Z in a text entry
  stays with the entry.
- **Field search / recents / persisted UI state** — search box filters the field list
  by name/company/year/LLD; "RECENT" chips (newest-first, ≤6, pruned to existing
  fields); `fields/ui_prefs.json` (device-local, gitignored) remembers collapsed
  insets + the active layer.
- **Autosave** — every 2.5 s on change, persists the field, exports the tablet
  GeoJSON, git-pushes, and mirrors to Supabase. Anti-gutting guard: never let an
  auto-save wipe on-disk geometry with a blank snapshot.
- **Git auto-sync** — pull on startup; add/commit/push on save/delete; a Stop hook
  commits everything each turn. Field data + code live in the repo.
- **Validation on save** — "Possible field issues" prompt (§5.8); invalid name/company
  chars blocked (`#`, `/`, etc.).

---

## PART 10 — TABLET / PHONE CREW APP (`tablet/`) — every screen & feature

A touch-first, outdoor-legible **PWA** for crews. Light "field kit" shell over a dark
satellite MapLibre map. Offline-capable (cached tiles + IndexedDB). Three screens via
a top segmented control: **Work · Map · System**.

### 10.1 Work mode (the centrepiece — one field, GPS-locked)
- **Map** full-bleed satellite; shelter **scan-pins** (yellow `#FFCE3A` filled + dark
  outline when placed; hollow when not), the crew's **GPS follow marker** (blue),
  and toggleable overlays.
- **Top bar:** field switcher (name + `N / M placed`), Work/Map/System switch,
  **GPS pill** (RTK ±ft/m vs coarse), **Sync now**, More (crew name, units, high-contrast,
  legend, manage fields/sync).
- **Bottom action bar:** **Layers**, **Calibrate**, **Direction**, **Scan**,
  **Checklist**, a **Placement readout** (`N / M` + progress bar), **Mark placed**.
- **Floaters:** on-map **legend**, **2D/3D** toggle (native MapLibre pitch ~56° +
  heading-up), **Recenter/Follow-me** FAB, arrival banner (geofence within ~10 ft of a
  shelter → "You're at Shelter N", Set trays), "field updated" refresh banner.
- **Layer slide-over:** locked always-on scan-pins row + toggles (Boundaries, Pivot
  tracks, Male bays, Alignment, Sprayer passes, Tire & edge, Wet zones, Planter passes,
  Crew route). Per-device persistence. Defaults: Boundaries + Pivot tracks ON, rest OFF.

### 10.2 Map mode — all synced fields; pivot-circle markers coloured by status
(green done / orange in-progress / grey not started); a bottom card rail (progress,
company · LLD). Tap a card/marker → Work mode.

### 10.3 System mode — design-system reference (need not ship).

### 10.4 Crew tasks
- **QR scanning** — hardware keyboard-wedge scanner (over the field http network) or
  the device camera (https only). Two modes: **Shelter** (drops a green actual-placement
  pin at the crew's GPS + records shelter QR) and **Trays** (pick a shelter, then scan
  each tray going into it → **shelter↔tray lineage**). Offline-first: saved to IndexedDB,
  pushed to Firebase when online.
- **Checklist** — before-leaving / in-field / after-task lists; counts fill from the
  field's shelter count; per-field state in IndexedDB.
- **Mark placed** — one-tap mark the nearest/current shelter placed.
- **Calibrate** — crew drives to the most-centred male bay and taps Calibrate; the app
  computes a **bay_shift** so the estimated grid lands on their real GPS; only bays +
  flags move (tracks/zones stay). RTK-fix required (confirm dialog) vs a "need a better
  GPS fix" dialog. Flows back to the desktop (Firebase `calibration/<field>`).
- **Other crews (live)** — the tablet subscribes to the same `crews/<id>` feed it
  publishes; shows **other crews as teal pins with name + placed/total** (Work mode =
  same field only; Map mode = all). Stale (>90 s) / bad-coord nodes dropped.

### 10.5 Offline + position source
Position comes from the ESP32/"globe" RTK receiver over WebSocket (field) or the
tablet's own GPS (fallback / https). Tiles + fields cached for offline. Placement +
calibration are **queued and pushed when connectivity returns**.

---

## PART 11 — LIVE SYNC ECOSYSTEM (how data flows)

- **Git** — field JSON + code sync across devices via GitHub (`origin/master`).
- **Firebase Realtime DB relay** — the live channel: `crews/<id>` (position, name,
  field, placed/total; `onDisconnect` cleanup), `scans/<field>/{shelters,trays}/<qr>`
  (persistent), `calibration/<field>`, `direction/<field>`. Drives the desktop
  **Monitor** view (all crews on the map) and the tablet's crew-to-crew awareness.
- **Supabase (Postgres)** — the desktop dual-writes every field save to the `fields`
  table (`supabase_sync.py`, service-role key, background best-effort) **including the
  computed shelter grid** (`_with_computed_shelters` runs `get_tent_positions`). The
  **web app** reads this. This is the seed of the modern backend.
- **Tablet GeoJSON export** — on every field save the desktop bakes a GeoJSON of all
  overlays (`_export_tablet_geojson` / `field_geojson.build_feature_collection`) for
  the tablet to draw without recomputing.

**Single-source-of-truth principle (target):** the desktop's Python
(`maketentgrid.py`) is the ONE place placement is computed; the tablet and web draw
what they're handed. A **JS↔Python drift guard** test exists because the tablet still
hand-ports the calibration/rotation math.

---

## PART 12 — TESTS (the safety net — carry these over)

`python -m pytest` (~80 s, 113 tests):
- `tests/test_geometry.py` — property/unit tests for `resolve_row_mask`, `mask_runs`,
  `bay_slot_lefts` (incl. the gap-aware regression), `male_bay_shelter_laterals`,
  `field_warnings`; per-field checks (finite/deterministic/metric+imperial); a
  **golden regression** vs `tests/baseline_positions.json` (shelter count + position
  hash per field). Regenerate intentionally: `python tests/_gen_baseline.py`.
- `tests/test_js_python_parity.py` — runs the tablet's JS math in Node, asserts it
  equals the Python to sub-mm (mutation-tested).
- `tests/test_tablet_crews.py` — the tablet "other crews" logic in Node.

**Any rebuild must keep an equivalent geometry test suite + golden baseline.**

---

## PART 13 — OVERLAY COLOURS (canonical design-system palette)

Tuned to pop over dark satellite; **keep identical across all surfaces** so a crew and
an operator literally see the same colours.

| Element | Colour | Style |
|---|---|---|
| Shelter pin (placed) | `#FFCE3A` fill + `#1A1A1A` outline | filled dot |
| Shelter pin (not placed) | hollow | `#FFCE3A` ring |
| Test shelter | `#1E90FF` / `#0A3D7A` | dot |
| Actual (scanned) placement | `#19E36B` / `#04361B` | dot |
| Pivot point | `#F5453D` | marker (2nd pivot `#FF7A00`) |
| Pivot track | `#FF8A2B` | dashed circles |
| Male bay | `#2E9BF0` | thick dashed / filled band |
| Alignment lines | `#86E0FF` (tablet) / `#101010` (desktop guide mesh) | thin lines |
| Sprayer limit / passes | `#FF5A52` (tablet) / `#33FF66` (desktop) dashed | line |
| Tire & edge zones | `#E0951F` (tablet) / tire `#FF2A2A` + edge `#22E048` (desktop) | fill |
| Wet zone | `#39B7D6` | translucent fill |
| Planter pass / number | `#8FBE3C` (tablet) / `#FFB000` (desktop numbers) | dashed / labels |
| Imported planter path | `#1E90FF` | line |
| Crew route | `#A06BFF` (tablet) / `#A855F7` (desktop) | solid polyline |
| Boundary | `#00CED1` (desktop) / `#E9F4D6` (tablet) | line |
| Inner boundary / access road | `#FF6600` / `#FF2D95` | line |
| Home/depot | `#2F7FE6` "H" | marker |
| Entrance / Parking | `#16A34A` "E" / `#F59E0B` "P" | markers |

**Interface (light "field kit" shell):** paper `#F4F1EA`, surface `#FFFFFF`, honey
accent `#B87514` (primary/active only), tint `#FBF1DD`, ink `#221F1A`, positive
`#1E8A45`, danger `#C4433B`, RTK teal `#127C77`. System sans, tabular figures for
numbers. Touch targets ≥56 px on the tablet.

---

## PART 14 — EXPORTS

- **KML** (shelter pins), **GeoJSON** (tablet + web), **AgGPS**, **John Deere shelter
  buffer zones**, **boundary files**, **PDF maps** (field map + cost estimates), and a
  **Field Summary PDF**. Outputs archived to an in-app output library
  (Files view: Output Files / Reference Files / Overview).

---

## PART 15 — WHAT TO BUILD (rebuild priorities)

The unified web build should preserve **all of the above** and finish these threads
(from `HANDOFF_UNFINISHED.md`):
1. **Supabase schema + RLS + roles** (crews vs staff; anon read gated by RLS;
   last-write-wins on `updated_at`).
2. **In-browser editing** of fields (currently read-only web viewer).
3. **The full bee lineage** (blocks ↔ shelters ↔ trays ↔ incubators ↔ season) as
   first-class linked records — the biggest *new* value vs today.
4. **Live crew tracking + progress** surfaced in the web app (already in Firebase).
5. Keep the **placement engine as the single source of truth** (port `maketentgrid.py`
   once; everything draws what it computes) and keep the **test suite + golden
   baseline + drift guard**.

**Non-negotiables to preserve:** leafcutter-bee model (not honey bees); contract
customers (BASF, Bayer, Hytech, Nutrien/Proven Seeds, Corteva); the exact placement
geometry + formulas (Part 5); the cost/profit formulas + per-year pricing (Part 8);
the overlay colour parity (Part 13); offline-capable field app; two-way live sync
(plan → execute → back-feed → analyze).
