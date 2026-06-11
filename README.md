# Orderly

Daily chronological ordering puzzle. Five events appear each day — arrange them from earliest to latest. Draw more events to raise the stakes.

**Live:** https://playorderly.app

## Local development

Serve the static files with any web server:

```bash
npx serve .
# or
python3 -m http.server 8080
```

Open http://localhost:8080 (or the port shown).

## Deployment (Cloudflare Pages)

### First-time setup

```bash
# Authenticate with Cloudflare (opens browser)
npx wrangler login

# Create the Pages project (only once)
npx wrangler pages project create orderly --production-branch main
```

### Deploy

```bash
./deploy.sh
# or manually:
npx wrangler pages deploy . --project-name orderly --branch main --commit-dirty=true
```

The site will be live at https://playorderly.app.

## Adding events

Events live in `events.json` — a flat JSON array of objects:

```json
{"event": "Apollo 11 lands on the Moon", "date": "1969-07-20", "category": "space"}
```

### Management script

```bash
# Show stats (category/decade breakdown)
python3 generate_events.py stats

# Validate dates and check for duplicates
python3 generate_events.py validate

# Remove duplicates
python3 generate_events.py dedup

# Merge events from another JSON file
python3 generate_events.py merge new_events.json

# Export a single category
python3 generate_events.py export --category sports

# Generate events with Claude API (requires: pip install anthropic)
python3 generate_events.py generate --category "90s movies" --count 100
```

### Bulk generation

```bash
# Generate events across 75+ categories (requires ANTHROPIC_API_KEY)
./bulk_generate.sh
```

## Rankings view

A second game family: order items by a measurable attribute instead of by date. One puzzle
per top-level category each day (Geography, Nature & Human-Scale, Economics & Data,
Language & Culture, Sports). Reachable at `#rankings/<category>` or via the 📊 Rankings toggle.
Each view keeps its own per-category daily streak; Rankings has no hints.

Data lives in `rankings.json` — an array of topic objects, each a pool of items sharing one
axis (the daily seed draws 10 from the pool):

```json
{
  "id": "mountains-by-height",
  "category": "geography",
  "title": "Mountains by height",
  "axis": { "lowLabel": "LOWEST", "highLabel": "HIGHEST", "unit": "m", "format": "comma" },
  "items": [ { "name": "Mount Everest", "value": 8849 } ]
}
```

`category` is one of `geography` | `nature` | `economics` | `language` | `sports`.
`axis.format` is one of `compact` | `comma` | `decimal` | `plain`. Items are ordered ascending
by `value`. Validate the file with:

```bash
node validate_rankings.js
```

The pure ordering logic (value formatting, seeded daily selection) lives in `rankings-core.js`
and is unit-tested:

```bash
node --test
```

## Project structure

```
index.html          Main page
style.css           Styles
app.js              Game logic (Time + Rankings views)
events.json         Date-puzzle data (~10k events)
rankings.json       Rankings-puzzle data (topics by measurable value)
rankings-core.js    Pure helpers shared by browser + Node tests
validate_rankings.js  rankings.json integrity validator / CLI
test/               Node --test unit tests
rabbit.svg          Logo icon
generate_events.py  Event management CLI
bulk_generate.sh    Bulk event generation script
deploy.sh           Cloudflare Pages deploy script
```
