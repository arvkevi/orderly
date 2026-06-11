# Orderly: Rankings View — Design

**Date:** 2026-06-10
**Status:** Approved (pending spec review)

## Summary

Orderly currently has one game family: order events from **earliest to latest** by date,
filtered by category "modes" (Grab Bag, NBA, K-Pop, …). This design adds a **second game
family** — the **Rankings view** — where players order items by a *measurable attribute*
(population, height, calories, points scored…) instead of by time.

The two families share the same ordering engine, scoring, draw-more mechanic, drag/drop, and
results UI. They differ only in their data source, their sort axis, and a few labels.

A top-level switch toggles between **⏱ Time** and **📊 Rankings**. In the Rankings view the
existing mode dropdown instead lists the **5 top-level categories**, each presenting *today's
single puzzle* for that category — so "one puzzle from each top-level category per day."

## Goals

- A non-time-based way to play with the same core ordering premise.
- One puzzle per top-level category per day, each with its own daily streak.
- Maximum reuse of the existing engine (scoring, draw-more, hints, drag/drop, results).
- Backward compatible: the Time view and all its existing modes/URLs are unchanged.

## Non-goals (follow-ups)

- A Python generator for `rankings.json` analogous to `generate_events.py`. Noted, not built now.
- Allowing per-puzzle *reversed* sort direction. All puzzles sort ascending (low value at top).
- Cross-view "play everything today" streak/playlist. Each view keeps its own streaks.

## Top-level categories

The Rankings view has 5 categories. Each is one dropdown entry = today's single puzzle.

| Category               | Example topics                                                          |
|------------------------|-------------------------------------------------------------------------|
| Geography & Physical World | Countries by population/area/coastline; rivers by length; mountains by height; cities by latitude |
| Nature & Human-Scale   | Animals by top speed/weight/lifespan; foods by calories/scoville; buildings by height |
| Economics & Data       | Companies by market cap/employees; countries by GDP / GDP per capita; products by price |
| Language & Culture     | Words by frequency/Scrabble score; books by page count/copies sold; songs by duration |
| Sports                 | A given year's NBA scoring leaders (PPG); college football final AP poll; etc. — each pinned to a year in its title |

## Gameplay (full parity with the Time view)

A single ranking puzzle plays exactly like a date puzzle:

- **Draw-more-to-raise-stakes**: a puzzle ships a *pool* of items (>10) on one shared axis.
  The daily seed picks 10 → 5 active + 5 reserve. Drawing raises max score on the same n²
  curve.
- **Scoring**: unchanged. `scoreForDistance(n, distance)` and the n² max apply identically;
  "correct order" is the items sorted ascending by `value`.
- **Drag/drop**, desktop + touch: unchanged.
- **Results comparison** (Your Order vs Correct Order, connectors, share grid): unchanged,
  except each row shows a formatted **value** instead of a date.

### Hints

- **No hints in the Rankings view.** Both the Category hint (redundant — every item shares the
  same axis) and the Decade-style value hint are dropped, for a cleaner, purer ordering
  challenge. The hint row is simply not rendered for ranking cards, and there is no hint
  penalty term in Rankings scoring (`getHintPenalty()` returns 0 because nothing is revealable).
- The Time view keeps its Category + Decade hints unchanged.

## Data model — `rankings.json`

New file, sibling to `events.json`. A flat array of **topic** objects. Each topic holds a
*pool* of items larger than 10 so each day seed-picks a fresh subset (daily variety +
draw-more headroom).

```json
{
  "id": "countries-by-population",
  "category": "geography",
  "title": "Countries by population",
  "axis": { "lowLabel": "FEWEST", "highLabel": "MOST", "unit": "people", "format": "compact" },
  "items": [
    { "name": "Tuvalu",  "value": 11000 },
    { "name": "Iceland", "value": 375000 },
    { "name": "India",   "value": 1428000000 }
  ]
}
```

Field notes:

- `id` — stable slug, used in seeding and (optionally) storage debugging.
- `category` — one of: `geography`, `nature`, `economics`, `language`, `sports`.
- `title` — shown in the dropdown and puzzle header. For sports, include the year
  (e.g. `"2023 NBA scoring leaders"`).
- `axis.lowLabel` / `axis.highLabel` — replace the `EARLIEST` / `MOST RECENT` timeline caps.
  Examples: `FEWEST`/`MOST`, `SHORTEST`/`LONGEST`, `RANKED #1`/`LOWER`, `FEWEST PPG`/`MOST PPG`.
- `axis.unit` — appended in displays/results ("people", "m", "PPG", "AP rank").
- `axis.format` — number-formatting style: `compact` (1.4B → "1.4 billion"), `comma`
  ("8,849"), `decimal` ("33.1"), or `plain`. A small formatter maps these.
- `items[].value` — numeric; the sort key. Correct order = ascending by `value`.

A category may contain multiple topics. The daily seed picks one topic per category, then
seed-shuffles its `items` pool and takes the first 10.

### Sports value conventions

- **Leaders** (scoring, rebounds, …): `value` = the stat (e.g. PPG 33.1). Ascending →
  fewest at top, most at bottom. `lowLabel: "FEWEST PPG"`, `highLabel: "MOST PPG"`.
- **Final poll/rank**: `value` = the rank number (1 = best). Ascending → #1 at top.
  `lowLabel: "RANKED #1"`, `highLabel: "LOWER RANK"`, `unit: "AP rank"`, `format: "plain"`.

## Engine generalization

The existing engine in `app.js` is date-specific in only three seams; generalize each:

1. **Correct order**: `sortByDate(events)` → a `sortByValue(items)` that sorts ascending by
   the active puzzle's sort key. In the Time view the key is `date`; in the Rankings view it
   is `value`. Implement as one `sortByKey(items, key)` (or a per-view comparator) so both
   views call the same path.
2. **Per-item display string**: Time shows `formatDate(date)`; Rankings shows
   `formatValue(value, axis)`. A new `formatValue` handles the `axis.format` styles and
   appends `axis.unit`. Used in event cards (when a value is revealed via hint) and in the
   results rows.
3. **Timeline caps**: the hard-coded `EARLIEST` / `MOST RECENT` cap labels become dynamic —
   driven by `axis.lowLabel` / `axis.highLabel` in Rankings, defaulting to the existing
   strings in Time.

Everything else — `scoreForDistance`, `calculateScore`, draw-more, drag/drop (desktop +
touch), the results comparison + SVG connectors, `seededShuffle`/`mulberry32`/`hashString` —
is reused unchanged.

### Puzzle-source abstraction

Introduce a thin "active puzzle" descriptor that both views populate, so the engine reads
from it instead of from globals tied to dates:

- `sortKey` — `"date"` or `"value"`.
- `axis` — `{ lowLabel, highLabel, unit, format }` (Time uses defaults `EARLIEST`/`MOST RECENT`).
- `formatItem(item)` — returns the display string (date or formatted value).
- `items` pool for the day (already shuffled into active/reserve).

This keeps the change additive rather than threading `view` checks through every function.

## View state, URLs, storage

- **View state**: a new `currentView` ∈ `{ "time", "rankings" }` alongside the existing
  `currentMode` / category.
- **Hash routing** (backward compatible):
  - Time view: `#` (Grab Bag), `#nba`, `#kpop`, … — unchanged.
  - Rankings view: `#rankings/<category>`, e.g. `#rankings/geography`. Bare `#rankings`
    defaults to the first category.
- **Storage keys**:
  - Time: `orderly`, `orderly-<mode>` — unchanged.
  - Rankings: `orderly-rank-<category>` — one independent daily streak per category, mirroring
    the existing per-mode storage pattern.
- **Puzzle number**: reuse the existing days-since-`BASE_DATE` counter for both views.

## Daily selection (Rankings)

For category `C` on date `D`:

1. `topicSeed = hash(D + "-rank-" + C)`; pick one topic whose `category === C` from the pool.
2. `itemSeed = hash(D + "-rank-" + C + "-items")`; seed-shuffle that topic's `items`, take 10.
3. `displaySeed = hash(D + "-rank-" + C + "-display")`; shuffle the 10 into 5 active + 5 reserve.

Mirrors `selectDailyEvents` / `startPuzzle` in the Time view.

## UI changes

- **`index.html`**: add the top-level view toggle (`⏱ Time` / `📊 Rankings`) above the mode
  dropdown. Timeline cap labels become spans populated at render time.
- **Mode dropdown** in Rankings: render the 5 categories with today's puzzle title as a
  subtitle, plus the existing ✓-completed + score badges.
- **Header / "How to Play"**: the tagline and help text adapt per view (order by *attribute*
  vs *date*). In Rankings the help omits the entire hints section, since Rankings has no hints.
- **Share text**: `📊 Orderly Rankings #<N> [<Category>]` + the same 🟩🟨🟧🟥 grid, so shared
  results are visually distinguishable from Time results (`⏱️ Orderly #<N>`).

## Files touched

- `app.js` — generalize the three engine seams; add view state, Rankings dropdown, daily
  selection, value formatter.
- `index.html` — view toggle; dynamic cap labels; per-view tagline/help.
- `style.css` — style the view toggle; reuse existing dropdown/card styles otherwise.
- `rankings.json` — **new**; seed topics across the 5 categories.
- `README.md` — document the Rankings view and `rankings.json`.

## Seed data plan

To make the Rankings view real and replayable from day one, seed **heavily**: each of the 5
categories gets **4–6 topics of ~20–25 items each** (pool ≫ 10 so daily variety + draw-more
both have plenty of headroom, and the same topic rarely repeats item sets day to day). That
is roughly 20–30 topics / 500+ items total across the five categories. Verifiable
ground-truth sources: REST Countries / World Bank (geography, economics), Wikidata
(everything), official league stat pages (sports).
