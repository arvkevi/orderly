# Rankings View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second game family to Orderly — a **Rankings view** where players order items by a measurable attribute (population, height, points…) instead of by date, with one puzzle per top-level category each day.

**Architecture:** Extract the pure, view-agnostic logic (seeded PRNG, value formatting, daily ranking selection) into a new browser+Node-loadable file `rankings-core.js` so it can be unit-tested with `node --test`. Generalize the three date-specific seams in `app.js` (sort key, per-item display string, timeline cap labels) behind an "active puzzle" descriptor. Add `currentView` state, a `#rankings/<category>` hash route, a view toggle, and per-category storage. Rankings data lives in a new `rankings.json`, validated by a Node integrity script.

**Tech Stack:** Vanilla browser JS (IIFE in `app.js`), plain `<script>` tags (no bundler), Node 22 built-in test runner (`node --test`, no dependencies), Cloudflare Pages static hosting.

**Reference spec:** `docs/superpowers/specs/2026-06-10-rankings-view-design.md`

---

## File Structure

- **`rankings-core.js`** *(new)* — pure, side-effect-free helpers, exported for both browser (`window.RankingsCore`) and Node (`module.exports`): `mulberry32`, `hashString`, `seededShuffle` (moved here from `app.js`), `formatValue`, `pickDailyTopic`, `pickDailyItems`. This is the testable core.
- **`test/rankings-core.test.js`** *(new)* — `node --test` unit tests for `rankings-core.js`.
- **`validate_rankings.js`** *(new)* — Node script that validates `rankings.json` integrity (schema, categories, min item counts, numeric values, unique names). Run via `node validate_rankings.js`. Also exercised by a test.
- **`test/rankings-data.test.js`** *(new)* — `node --test` that runs the validator against the real `rankings.json` and fails on any integrity error.
- **`rankings.json`** *(new)* — the ranking topics across the 5 categories.
- **`app.js`** *(modify)* — consume `RankingsCore`; add view state, hash routing, ranking dropdown, daily ranking puzzle start, value display in cards/results, share text; generalize sort + caps.
- **`index.html`** *(modify)* — add view toggle; make timeline cap labels dynamic; per-view tagline.
- **`style.css`** *(modify)* — style the view toggle.
- **`README.md`** *(modify)* — document the Rankings view, `rankings.json`, and the validator.

---

## Task 1: Pure core module `rankings-core.js` (formatter + PRNG)

Extract the seeded PRNG out of `app.js` into a shared, testable module and add the value formatter. Start with the formatter under TDD, then move the PRNG.

**Files:**
- Create: `rankings-core.js`
- Test: `test/rankings-core.test.js`

- [ ] **Step 1: Write the failing test for `formatValue`**

Create `test/rankings-core.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { formatValue } = require('../rankings-core.js');

test('formatValue compact uses word magnitudes', () => {
  assert.equal(formatValue(1428000000, { format: 'compact', unit: 'people' }), '1.4 billion people');
  assert.equal(formatValue(375000, { format: 'compact', unit: 'people' }), '375 thousand people');
  assert.equal(formatValue(2500000000000, { format: 'compact', unit: '' }), '2.5 trillion');
  assert.equal(formatValue(840, { format: 'compact', unit: '' }), '840');
});

test('formatValue comma groups thousands', () => {
  assert.equal(formatValue(8849, { format: 'comma', unit: 'm' }), '8,849 m');
  assert.equal(formatValue(17098242, { format: 'comma', unit: 'km²' }), '17,098,242 km²');
});

test('formatValue decimal keeps one place', () => {
  assert.equal(formatValue(33.14, { format: 'decimal', unit: 'PPG' }), '33.1 PPG');
});

test('formatValue plain passes through, empty unit adds no suffix', () => {
  assert.equal(formatValue(3, { format: 'plain', unit: '' }), '3');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/rankings-core.test.js`
Expected: FAIL — `Cannot find module '../rankings-core.js'`.

- [ ] **Step 3: Create `rankings-core.js` with `formatValue` and UMD export**

```js
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RankingsCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function formatValue(value, axis) {
    const fmt = (axis && axis.format) || 'plain';
    const unit = (axis && axis.unit) || '';
    let str;
    if (fmt === 'compact') {
      str = compact(value);
    } else if (fmt === 'comma') {
      str = Math.round(value).toLocaleString('en-US');
    } else if (fmt === 'decimal') {
      str = (Math.round(value * 10) / 10).toFixed(1);
    } else {
      str = String(value);
    }
    return unit ? `${str} ${unit}` : str;
  }

  function compact(value) {
    const abs = Math.abs(value);
    const tiers = [
      [1e12, 'trillion'],
      [1e9, 'billion'],
      [1e6, 'million'],
      [1e3, 'thousand'],
    ];
    for (const [base, word] of tiers) {
      if (abs >= base) {
        const n = value / base;
        // 1 decimal place, but drop a trailing ".0"
        const rounded = Math.round(n * 10) / 10;
        const numStr = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
        return `${numStr} ${word}`;
      }
    }
    return String(Math.round(value));
  }

  return { formatValue };
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/rankings-core.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Move the PRNG helpers into the core module**

In `app.js`, the functions `mulberry32` (lines ~45-53), `hashString` (~55-62), and `seededShuffle` (~64-71) currently live inside the IIFE. Cut them from `app.js`. Add them to `rankings-core.js` inside the factory, before `return`, and include them in the returned object:

```js
  function mulberry32(seed) {
    return function () {
      seed |= 0;
      seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function hashString(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) - h) + str.charCodeAt(i);
      h |= 0;
    }
    return h;
  }

  function seededShuffle(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
```

Change the `return` line to: `return { formatValue, mulberry32, hashString, seededShuffle };`

- [ ] **Step 6: Wire `app.js` to use the shared PRNG**

In `app.js`, immediately inside the IIFE (after `'use strict';`), add:

```js
  const { mulberry32, hashString, seededShuffle } = window.RankingsCore;
```

This replaces the three definitions you just removed; all existing call sites (`selectDailyEvents`, `startPuzzle`) keep working unchanged.

- [ ] **Step 7: Load the core before `app.js` in the page**

In `index.html`, change the script tag at the bottom from:

```html
  <script src="app.js"></script>
```

to:

```html
  <script src="rankings-core.js"></script>
  <script src="app.js"></script>
```

- [ ] **Step 8: Add PRNG determinism tests**

Append to `test/rankings-core.test.js`:

```js
const { mulberry32, hashString, seededShuffle } = require('../rankings-core.js');

test('hashString + mulberry32 are deterministic', () => {
  const a = mulberry32(hashString('2026-06-10-x'))();
  const b = mulberry32(hashString('2026-06-10-x'))();
  assert.equal(a, b);
});

test('seededShuffle is a permutation and deterministic for a fixed rng seed', () => {
  const src = [1, 2, 3, 4, 5];
  const out1 = seededShuffle(src, mulberry32(123));
  const out2 = seededShuffle(src, mulberry32(123));
  assert.deepEqual(out1, out2);
  assert.deepEqual([...out1].sort(), src);
  assert.deepEqual(src, [1, 2, 3, 4, 5]); // input not mutated
});
```

- [ ] **Step 9: Run the full core test file**

Run: `node --test test/rankings-core.test.js`
Expected: PASS (6 tests).

- [ ] **Step 10: Manually verify the Time view still works**

Run: `python3 -m http.server 8080` and open `http://localhost:8080`.
Expected: today's date puzzle loads, drag/drop works, submit shows results — i.e. moving the PRNG didn't break anything.

- [ ] **Step 11: Commit**

```bash
git add rankings-core.js test/rankings-core.test.js app.js index.html
git commit -m "feat: extract pure core (PRNG + value formatter) into rankings-core.js"
```

---

## Task 2: Daily ranking selection in `rankings-core.js`

Add the two pure selection helpers the Rankings view needs.

**Files:**
- Modify: `rankings-core.js`
- Test: `test/rankings-core.test.js`

- [ ] **Step 1: Write failing tests for `pickDailyTopic` / `pickDailyItems`**

Append to `test/rankings-core.test.js`:

```js
const { pickDailyTopic, pickDailyItems } = require('../rankings-core.js');

const TOPICS = [
  { id: 'geo-area', category: 'geography', title: 'Countries by area',
    axis: { lowLabel: 'SMALLEST', highLabel: 'LARGEST', unit: 'km²', format: 'comma' },
    items: Array.from({ length: 20 }, (_, i) => ({ name: 'C' + i, value: i + 1 })) },
  { id: 'geo-mtn', category: 'geography', title: 'Mountains by height',
    axis: { lowLabel: 'LOWEST', highLabel: 'HIGHEST', unit: 'm', format: 'comma' },
    items: Array.from({ length: 20 }, (_, i) => ({ name: 'M' + i, value: i + 100 })) },
  { id: 'sport-x', category: 'sports', title: '2023 leaders',
    axis: { lowLabel: 'FEWEST', highLabel: 'MOST', unit: 'PPG', format: 'decimal' },
    items: Array.from({ length: 20 }, (_, i) => ({ name: 'P' + i, value: i + 0.5 })) },
];

test('pickDailyTopic returns a topic from the requested category, deterministically', () => {
  const t1 = pickDailyTopic(TOPICS, 'geography', '2026-06-10');
  const t2 = pickDailyTopic(TOPICS, 'geography', '2026-06-10');
  assert.equal(t1.id, t2.id);
  assert.equal(t1.category, 'geography');
  assert.equal(pickDailyTopic(TOPICS, 'sports', '2026-06-10').id, 'sport-x');
});

test('pickDailyTopic returns null when category has no topics', () => {
  assert.equal(pickDailyTopic(TOPICS, 'language', '2026-06-10'), null);
});

test('pickDailyItems returns N items from the topic pool, deterministically', () => {
  const topic = TOPICS[0];
  const a = pickDailyItems(topic, '2026-06-10', 10);
  const b = pickDailyItems(topic, '2026-06-10', 10);
  assert.equal(a.length, 10);
  assert.deepEqual(a, b);
  a.forEach(it => assert.ok(topic.items.some(p => p.name === it.name)));
});

test('pickDailyItems gives different sets on different dates (usually)', () => {
  const topic = TOPICS[0];
  const a = pickDailyItems(topic, '2026-06-10', 10).map(i => i.name).join();
  const b = pickDailyItems(topic, '2026-07-15', 10).map(i => i.name).join();
  assert.notEqual(a, b);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/rankings-core.test.js`
Expected: FAIL — `pickDailyTopic is not a function`.

- [ ] **Step 3: Implement the selectors in `rankings-core.js`**

Inside the factory, before `return`:

```js
  function pickDailyTopic(topics, category, dateStr) {
    const inCat = topics.filter(t => t.category === category);
    if (inCat.length === 0) return null;
    const rng = mulberry32(hashString(dateStr + '-rank-' + category));
    return seededShuffle(inCat, rng)[0];
  }

  function pickDailyItems(topic, dateStr, count) {
    const rng = mulberry32(hashString(dateStr + '-rank-' + topic.category + '-items'));
    return seededShuffle(topic.items, rng).slice(0, count);
  }
```

Add both to the returned object:
`return { formatValue, mulberry32, hashString, seededShuffle, pickDailyTopic, pickDailyItems };`

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/rankings-core.test.js`
Expected: PASS (10 tests total).

- [ ] **Step 5: Commit**

```bash
git add rankings-core.js test/rankings-core.test.js
git commit -m "feat: add daily ranking topic/item selection to core"
```

---

## Task 3: Ranking data schema, validator, and seed data

Define `rankings.json` and a validator that enforces structure and minimum volume. Seed with **verified** topics; the validator gates the heavy fill.

**Files:**
- Create: `validate_rankings.js`
- Create: `rankings.json`
- Test: `test/rankings-data.test.js`

- [ ] **Step 1: Write the validator with a pure `validateRankings` function**

Create `validate_rankings.js`:

```js
'use strict';
const VALID_CATEGORIES = ['geography', 'nature', 'economics', 'language', 'sports'];
const MIN_ITEMS = 12;     // pool must exceed the 10 drawn per day
const MIN_TOPICS_PER_CATEGORY = 1;

function validateRankings(topics) {
  const errors = [];
  if (!Array.isArray(topics)) return ['rankings.json must be a JSON array'];

  const seenIds = new Set();
  const countByCategory = {};

  topics.forEach((t, i) => {
    const where = `topic[${i}]${t && t.id ? ` (${t.id})` : ''}`;
    if (!t || typeof t !== 'object') { errors.push(`${where}: not an object`); return; }
    if (!t.id || typeof t.id !== 'string') errors.push(`${where}: missing string id`);
    else if (seenIds.has(t.id)) errors.push(`${where}: duplicate id`);
    else seenIds.add(t.id);

    if (!VALID_CATEGORIES.includes(t.category))
      errors.push(`${where}: category "${t.category}" not in ${VALID_CATEGORIES.join('/')}`);
    else countByCategory[t.category] = (countByCategory[t.category] || 0) + 1;

    if (!t.title || typeof t.title !== 'string') errors.push(`${where}: missing string title`);

    const ax = t.axis;
    if (!ax || typeof ax !== 'object') errors.push(`${where}: missing axis`);
    else {
      ['lowLabel', 'highLabel', 'unit', 'format'].forEach(k => {
        if (typeof ax[k] !== 'string') errors.push(`${where}: axis.${k} must be a string`);
      });
      if (!['compact', 'comma', 'decimal', 'plain'].includes(ax.format))
        errors.push(`${where}: axis.format "${ax.format}" invalid`);
    }

    if (!Array.isArray(t.items) || t.items.length < MIN_ITEMS)
      errors.push(`${where}: needs >= ${MIN_ITEMS} items, has ${t.items ? t.items.length : 0}`);
    else {
      const names = new Set();
      t.items.forEach((it, j) => {
        if (!it || typeof it.name !== 'string') errors.push(`${where}.items[${j}]: missing name`);
        else if (names.has(it.name)) errors.push(`${where}.items[${j}]: duplicate name "${it.name}"`);
        else names.add(it.name);
        if (typeof it.value !== 'number' || Number.isNaN(it.value))
          errors.push(`${where}.items[${j}] (${it && it.name}): value must be a number`);
      });
    }
  });

  VALID_CATEGORIES.forEach(c => {
    if ((countByCategory[c] || 0) < MIN_TOPICS_PER_CATEGORY)
      errors.push(`category "${c}": needs >= ${MIN_TOPICS_PER_CATEGORY} topic(s), has ${countByCategory[c] || 0}`);
  });

  return errors;
}

module.exports = { validateRankings, VALID_CATEGORIES, MIN_ITEMS };

// CLI entrypoint: `node validate_rankings.js`
if (require.main === module) {
  const fs = require('fs');
  const data = JSON.parse(fs.readFileSync(__dirname + '/rankings.json', 'utf8'));
  const errors = validateRankings(data);
  if (errors.length) {
    console.error(`rankings.json: ${errors.length} error(s):`);
    errors.forEach(e => console.error('  - ' + e));
    process.exit(1);
  }
  const byCat = {};
  data.forEach(t => { byCat[t.category] = (byCat[t.category] || 0) + 1; });
  console.log(`rankings.json OK — ${data.length} topics:`, byCat);
}
```

- [ ] **Step 2: Write the data test (initially red — no `rankings.json` yet)**

Create `test/rankings-data.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { validateRankings } = require('../validate_rankings.js');

test('rankings.json passes integrity validation', () => {
  const data = JSON.parse(fs.readFileSync(__dirname + '/../rankings.json', 'utf8'));
  const errors = validateRankings(data);
  assert.deepEqual(errors, [], 'expected no validation errors:\n' + errors.join('\n'));
});

test('validateRankings catches a bad topic', () => {
  const errors = validateRankings([{ id: 'x', category: 'bogus', title: 't', axis: {}, items: [] }]);
  assert.ok(errors.length > 0);
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `node --test test/rankings-data.test.js`
Expected: FAIL — cannot read `rankings.json`.

- [ ] **Step 4: Create `rankings.json` with verified starter topics**

Create `rankings.json` as a JSON array. Seed **at least one fully-verified topic per category** to go green; values below are stable, well-known orderings. (Volume is expanded in Step 6.)

```json
[
  {
    "id": "countries-by-area",
    "category": "geography",
    "title": "Countries by land area",
    "axis": { "lowLabel": "SMALLEST", "highLabel": "LARGEST", "unit": "km²", "format": "comma" },
    "items": [
      { "name": "Russia", "value": 17098242 },
      { "name": "Canada", "value": 9984670 },
      { "name": "United States", "value": 9833517 },
      { "name": "China", "value": 9596960 },
      { "name": "Brazil", "value": 8515767 },
      { "name": "Australia", "value": 7692024 },
      { "name": "India", "value": 3287263 },
      { "name": "Argentina", "value": 2780400 },
      { "name": "Kazakhstan", "value": 2724900 },
      { "name": "Algeria", "value": 2381741 },
      { "name": "Mexico", "value": 1964375 },
      { "name": "Indonesia", "value": 1904569 },
      { "name": "Egypt", "value": 1002450 },
      { "name": "France", "value": 551695 },
      { "name": "Japan", "value": 377975 }
    ]
  },
  {
    "id": "mountains-by-height",
    "category": "geography",
    "title": "Mountains by height",
    "axis": { "lowLabel": "LOWEST", "highLabel": "HIGHEST", "unit": "m", "format": "comma" },
    "items": [
      { "name": "Mount Everest", "value": 8849 },
      { "name": "K2", "value": 8611 },
      { "name": "Kangchenjunga", "value": 8586 },
      { "name": "Lhotse", "value": 8516 },
      { "name": "Makalu", "value": 8485 },
      { "name": "Cho Oyu", "value": 8188 },
      { "name": "Dhaulagiri I", "value": 8167 },
      { "name": "Manaslu", "value": 8163 },
      { "name": "Nanga Parbat", "value": 8126 },
      { "name": "Annapurna I", "value": 8091 },
      { "name": "Mont Blanc", "value": 4808 },
      { "name": "Matterhorn", "value": 4478 },
      { "name": "Mount Rainier", "value": 4392 },
      { "name": "Mount Fuji", "value": 3776 },
      { "name": "Ben Nevis", "value": 1345 }
    ]
  },
  {
    "id": "animals-by-top-speed",
    "category": "nature",
    "title": "Animals by top speed",
    "axis": { "lowLabel": "SLOWEST", "highLabel": "FASTEST", "unit": "mph", "format": "comma" },
    "items": [
      { "name": "Cheetah", "value": 70 },
      { "name": "Pronghorn antelope", "value": 55 },
      { "name": "Springbok", "value": 55 },
      { "name": "Lion", "value": 50 },
      { "name": "Wildebeest", "value": 50 },
      { "name": "Greyhound", "value": 45 },
      { "name": "Jackrabbit", "value": 45 },
      { "name": "Kangaroo", "value": 44 },
      { "name": "Horse", "value": 43 },
      { "name": "Zebra", "value": 40 },
      { "name": "Giraffe", "value": 37 },
      { "name": "Usain Bolt (human)", "value": 28 },
      { "name": "Elephant", "value": 25 },
      { "name": "Squirrel", "value": 12 },
      { "name": "Tortoise", "value": 1 }
    ]
  },
  {
    "id": "us-cities-by-population",
    "category": "economics",
    "title": "US cities by population",
    "axis": { "lowLabel": "FEWEST", "highLabel": "MOST", "unit": "people", "format": "compact" },
    "items": [
      { "name": "New York City", "value": 8478000 },
      { "name": "Los Angeles", "value": 3878000 },
      { "name": "Chicago", "value": 2721000 },
      { "name": "Houston", "value": 2320000 },
      { "name": "Phoenix", "value": 1673000 },
      { "name": "Philadelphia", "value": 1550000 },
      { "name": "San Antonio", "value": 1495000 },
      { "name": "San Diego", "value": 1389000 },
      { "name": "Dallas", "value": 1303000 },
      { "name": "Austin", "value": 979000 },
      { "name": "San Francisco", "value": 827000 },
      { "name": "Seattle", "value": 780000 },
      { "name": "Denver", "value": 716000 },
      { "name": "Boston", "value": 654000 },
      { "name": "Miami", "value": 456000 }
    ]
  },
  {
    "id": "words-by-scrabble-score",
    "category": "language",
    "title": "Words by Scrabble tile score",
    "axis": { "lowLabel": "LOWEST", "highLabel": "HIGHEST", "unit": "points", "format": "comma" },
    "items": [
      { "name": "QUIZ", "value": 22 },
      { "name": "JAZZY", "value": 33 },
      { "name": "BUZZ", "value": 16 },
      { "name": "FIZZ", "value": 25 },
      { "name": "WAXY", "value": 13 },
      { "name": "CRANE", "value": 7 },
      { "name": "HOUSE", "value": 8 },
      { "name": "TRAIN", "value": 5 },
      { "name": "AUDIO", "value": 6 },
      { "name": "QUEEN", "value": 14 },
      { "name": "PIZZA", "value": 25 },
      { "name": "FOXY", "value": 14 },
      { "name": "JUMBO", "value": 14 },
      { "name": "VODKA", "value": 12 }
    ]
  },
  {
    "id": "nba-scoring-2023",
    "category": "sports",
    "title": "2022-23 NBA scoring leaders",
    "axis": { "lowLabel": "FEWEST", "highLabel": "MOST", "unit": "PPG", "format": "decimal" },
    "items": [
      { "name": "Joel Embiid", "value": 33.1 },
      { "name": "Luka Dončić", "value": 32.4 },
      { "name": "Damian Lillard", "value": 32.2 },
      { "name": "Shai Gilgeous-Alexander", "value": 31.4 },
      { "name": "Giannis Antetokounmpo", "value": 31.1 },
      { "name": "Jayson Tatum", "value": 30.1 },
      { "name": "Stephen Curry", "value": 29.4 },
      { "name": "Kevin Durant", "value": 29.1 },
      { "name": "De'Aaron Fox", "value": 25.0 },
      { "name": "LeBron James", "value": 28.9 },
      { "name": "Donovan Mitchell", "value": 28.3 },
      { "name": "Anthony Edwards", "value": 24.6 },
      { "name": "Devin Booker", "value": 27.8 }
    ]
  }
]
```

- [ ] **Step 5: Run validator + data test to verify green**

Run: `node validate_rankings.js`
Expected: `rankings.json OK — 6 topics: { geography: 2, nature: 1, economics: 1, language: 1, sports: 1 }`

Run: `node --test test/rankings-data.test.js`
Expected: PASS (2 tests).

- [ ] **Step 6: Expand to heavy volume (gated by the validator)**

Per the spec, target **4–6 topics per category, ~20–25 items each**. Add topics by sourcing verified data:
- Geography: rivers by length, lakes by area, countries by population, cities by latitude (REST Countries / Wikidata).
- Nature: animals by weight / lifespan / gestation, foods by calories / scoville (USDA / Wikidata).
- Economics: countries by GDP per capita, products by price, companies by employees — **pin volatile figures to a year in the title** like the sports topics (World Bank / company filings).
- Language: words by frequency, books by page count, songs by duration (corpora / Wikidata).
- Sports: more season leaderboards (rebounds, assists), a college football final AP poll for a year (value = rank, `format: "plain"`, `unit: ""`, `lowLabel: "RANKED #1"`, `highLabel: "LOWER"`).

Expand **every** topic's `items` pool to **>= 20** entries with correct values — including the
six seed topics from Step 4 (which ship with 13–15 items and must be grown to 20+).

Once every category has its topics, **make the heavy target test-enforced**: in
`validate_rankings.js` change `const MIN_TOPICS_PER_CATEGORY = 1;` to
`const MIN_TOPICS_PER_CATEGORY = 4;` and bump `const MIN_ITEMS = 12;` to
`const MIN_ITEMS = 20;`. Now `node --test test/rankings-data.test.js` fails until every
category has >= 4 topics of >= 20 items.

**Acceptance:** `node validate_rankings.js` exits 0 and reports `>= 4` topics for every
category. (The validator enforces counts/types/uniqueness; you are responsible for the
factual ordering — spot-check each topic's sorted order against its source before committing.)

- [ ] **Step 7: Re-run validator and commit**

Run: `node validate_rankings.js`
Expected: every category shows `>= 4` topics, exit 0.

```bash
git add rankings.json validate_rankings.js test/rankings-data.test.js
git commit -m "feat: add rankings.json data, integrity validator, and tests"
```

---

## Task 4: View state, hash routing, and the active-puzzle descriptor in `app.js`

Introduce `currentView`, the `#rankings/<category>` route, ranking categories, and a descriptor the engine reads from. No UI yet — this task wires state and generalizes the sort + caps, keeping Time behavior identical.

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Add ranking categories, view state, and data globals**

After the `MODES` array in `app.js` (ends ~line 31), add:

```js
  // --- Ranking categories (one daily puzzle each) ---
  const RANK_CATEGORIES = [
    { id: 'geography', label: 'Geography' },
    { id: 'nature', label: 'Nature & Human-Scale' },
    { id: 'economics', label: 'Economics & Data' },
    { id: 'language', label: 'Language & Culture' },
    { id: 'sports', label: 'Sports' },
  ];
```

In the `// --- State ---` block (~line 33), add:

```js
  let currentView = 'time';        // 'time' | 'rankings'
  let allTopics = [];              // loaded from rankings.json
  let currentRankCategory = RANK_CATEGORIES[0].id;
  let activePuzzle = null;         // descriptor for the current ranking puzzle
```

- [ ] **Step 2: Add the active-puzzle descriptor helpers**

Add near the other helpers (after `getModeById`, ~line 108):

```js
  // The engine reads ordering/labels/formatting through this descriptor so the
  // same code path serves both the Time view and the Rankings view.
  function timePuzzleAxis() {
    return { lowLabel: 'EARLIEST', highLabel: 'MOST RECENT' };
  }

  function itemDisplayString(item) {
    if (currentView === 'rankings' && activePuzzle) {
      return window.RankingsCore.formatValue(item.value, activePuzzle.axis);
    }
    return formatDate(item.date);
  }

  function currentAxis() {
    if (currentView === 'rankings' && activePuzzle) return activePuzzle.axis;
    return timePuzzleAxis();
  }

  function sortByActiveKey(items) {
    const key = currentView === 'rankings' ? 'value' : 'date';
    return items.slice().sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0));
  }
```

- [ ] **Step 3: Replace `sortByDate` usages with `sortByActiveKey`**

`sortByDate` is called in `submit` (~line 657) and `restorePreviousResult` (~line 884). Replace both call sites with `sortByActiveKey`. Delete the now-unused `sortByDate` function (~lines 175-181).

- [ ] **Step 4: Generalize hash routing**

**Add** these two functions next to `getModeFromHash` (~line 124). Do **not** delete
`getModeFromHash` yet — `init` still calls it until Task 6 rewires `init`. Keeping it avoids a
mid-plan breakage:

```js
  // Returns { view, mode, rankCategory } parsed from the URL hash.
  // Time:     ''  | '#nba' | '#kpop' ...
  // Rankings: '#rankings' | '#rankings/geography'
  function parseHash() {
    const hash = window.location.hash.replace(/^#/, '');
    if (hash === 'rankings' || hash.startsWith('rankings/')) {
      const cat = hash.split('/')[1];
      const valid = RANK_CATEGORIES.some(c => c.id === cat);
      return { view: 'rankings', mode: 'all', rankCategory: valid ? cat : RANK_CATEGORIES[0].id };
    }
    const mode = MODES.some(m => m.id === hash) ? hash : 'all';
    return { view: 'time', mode, rankCategory: RANK_CATEGORIES[0].id };
  }

  function writeHash() {
    if (currentView === 'rankings') {
      window.location.hash = 'rankings/' + currentRankCategory;
    } else {
      window.location.hash = currentMode === 'all' ? '' : currentMode;
    }
  }
```

- [ ] **Step 5: Make storage keys view-aware**

Replace `getStorageKey` (~lines 110-112) with:

```js
  function getStorageKey() {
    if (currentView === 'rankings') return STORAGE_KEY + '-rank-' + currentRankCategory;
    return STORAGE_KEY + (currentMode === 'all' ? '' : '-' + currentMode);
  }
```

- [ ] **Step 6: Syntax-check and verify Time view unchanged**

The Rankings view isn't reachable from the UI until Task 6, so first confirm `app.js` still
parses after the refactor:

Run: `node --check app.js`
Expected: no output, exit 0.

Then serve and confirm Time is intact: `python3 -m http.server 8080`, open
`http://localhost:8080` and `http://localhost:8080/#nba`.
Expected: Time puzzles load and submit correctly; date results still show formatted dates.
(`#rankings` is wired in Task 6.)

- [ ] **Step 7: Commit**

```bash
git add app.js
git commit -m "feat: add view state, hash routing, and active-puzzle descriptor"
```

---

## Task 5: Daily ranking puzzle loading and start flow in `app.js`

Load `rankings.json` and add a `startRankingPuzzle` that mirrors `startPuzzle`.

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Load `rankings.json` in `init`**

In `init` (~lines 919-928), after `allEvents = await resp.json();`, add a second fetch (failure here should not block the Time view):

```js
    try {
      const rResp = await fetch('rankings.json');
      if (rResp.ok) allTopics = await rResp.json();
    } catch (e) {
      allTopics = [];
    }
```

- [ ] **Step 2: Add `startRankingPuzzle`**

Add after `startPuzzle` (~line 916):

```js
  function startRankingPuzzle() {
    const dateStr = getTodayString();
    const core = window.RankingsCore;
    const topic = core.pickDailyTopic(allTopics, currentRankCategory, dateStr);

    if (!topic) {
      document.getElementById('loading').textContent =
        'No puzzle available for this category yet.';
      document.getElementById('loading').classList.remove('hidden');
      return;
    }

    activePuzzle = { topicId: topic.id, title: topic.title, axis: topic.axis };
    renderPuzzleInfo(dateStr);

    if (restorePreviousResult(dateStr)) return;

    const pool = core.pickDailyItems(topic, dateStr, TOTAL_POOL);
    const rng = core.mulberry32(core.hashString(dateStr + '-rank-' + currentRankCategory + '-display'));
    const shuffled = core.seededShuffle(pool, rng);
    activeEvents = shuffled.slice(0, INITIAL_EVENTS);
    reserveEvents = shuffled.slice(INITIAL_EVENTS, TOTAL_POOL);

    document.getElementById('loading').classList.add('hidden');
    document.getElementById('game').classList.remove('hidden');
    renderEventList();
  }
```

Note: ranking items use `{ name, value }`. The engine keys cards off `ev.event`; add a normalization so cards/results work unchanged — in `pickDailyItems` results, map each item to also carry an `event` alias. Do this inside `startRankingPuzzle` right after `pool` is built:

```js
    pool.forEach(it => { if (it.event === undefined) it.event = it.name; });
```

This makes `ev.event` (used as the card label and the identity key in `calculateScore` / results) resolve to the item name, while `ev.value` drives sorting and display.

- [ ] **Step 3: Route start through the active view**

Add a dispatcher and use it wherever `startPuzzle()` is called from view-switching code:

```js
  function startActivePuzzle() {
    if (currentView === 'rankings') startRankingPuzzle();
    else startPuzzle();
  }
```

- [ ] **Step 4: Fix `restorePreviousResult` to rebuild the ranking pool**

In `restorePreviousResult` (~line 881), the line `const pool = selectDailyEvents(dateStr);` only handles Time. Make it view-aware:

```js
    let pool;
    if (currentView === 'rankings') {
      const topic = window.RankingsCore.pickDailyTopic(allTopics, currentRankCategory, getTodayString());
      pool = topic ? window.RankingsCore.pickDailyItems(topic, getTodayString(), TOTAL_POOL) : [];
      pool.forEach(it => { if (it.event === undefined) it.event = it.name; });
    } else {
      pool = selectDailyEvents(dateStr);
    }
```

- [ ] **Step 5: Syntax-check and verify data loads**

The toggle UI lands in Task 6, so verify at the syntax + data level here.

Run: `node --check app.js`
Expected: no output, exit 0.

Then serve (`python3 -m http.server 8080`), open the page, and in the browser console run:

```js
fetch('rankings.json').then(r => r.json()).then(d => console.log('topics:', d.length));
```

Expected: logs the topic count, no errors; the Time view still plays normally.

- [ ] **Step 6: Commit**

```bash
git add app.js
git commit -m "feat: load rankings.json and add ranking puzzle start flow"
```

---

## Task 6: View toggle + Rankings dropdown UI

Add the `⏱ Time` / `📊 Rankings` toggle and make the dropdown render ranking categories when in the Rankings view.

**Files:**
- Modify: `index.html`, `app.js`, `style.css`

- [ ] **Step 1: Add the view toggle markup**

In `index.html`, immediately above `<div id="mode-selector">` (~line 57), add:

```html
    <div id="view-toggle" role="tablist" aria-label="Game mode">
      <button id="view-time" class="view-btn active" role="tab">⏱ Time</button>
      <button id="view-rankings" class="view-btn" role="tab">📊 Rankings</button>
    </div>
```

- [ ] **Step 2: Make timeline cap labels dynamic**

In `index.html`, the caps (~lines 87-97) hard-code `EARLIEST` / `MOST RECENT`. Give the label spans ids:

Change `<span class="timeline-cap-label">EARLIEST</span>` to
`<span class="timeline-cap-label" id="cap-low">EARLIEST</span>`, and
`<span class="timeline-cap-label">MOST RECENT</span>` to
`<span class="timeline-cap-label" id="cap-high">MOST RECENT</span>`.

- [ ] **Step 3: Update cap labels at render time**

In `app.js`, inside `renderEventList` (~line 338), after `list.innerHTML = '';` add:

```js
    const axis = currentAxis();
    const lowEl = document.getElementById('cap-low');
    const highEl = document.getElementById('cap-high');
    if (lowEl) lowEl.textContent = axis.lowLabel;
    if (highEl) highEl.textContent = axis.highLabel;
```

- [ ] **Step 4: Generalize the dropdown to render ranking categories**

In `renderModeSelector` (~line 229), branch on the view. Replace the `MODES.forEach(...)` body so it iterates the right list. Add this helper above `renderModeSelector`:

```js
  function currentMenuEntries() {
    if (currentView === 'rankings') {
      return RANK_CATEGORIES.map(c => {
        const topic = window.RankingsCore.pickDailyTopic(allTopics, c.id, getTodayString());
        return { id: c.id, label: c.label, subtitle: topic ? topic.title : '—' };
      });
    }
    return MODES.map(m => ({ id: m.id, label: m.label, subtitle: null }));
  }
```

Then rewrite the menu-building loop in `renderModeSelector` to use `currentMenuEntries()` and the view-aware completion check. Replace the body from `menu.innerHTML = '';` through the end of the `MODES.forEach(...)` loop with:

```js
    menu.innerHTML = '';
    const activeId = currentView === 'rankings' ? currentRankCategory : currentMode;
    currentMenuEntries().forEach(entry => {
      const done = isEntryCompleted(entry.id);
      const result = getEntryScore(entry.id);
      const item = document.createElement('button');
      item.className = 'mode-menu-item' +
        (entry.id === activeId ? ' active' : '') + (done ? ' completed' : '');
      const scoreText = result
        ? `<span class="mode-score">${result.score}/${result.maxScore}</span>` : '';
      const subtitle = entry.subtitle
        ? `<span class="mode-item-subtitle">${escapeHtml(entry.subtitle)}</span>` : '';
      item.innerHTML =
        `<span class="mode-item-label">${done ? '✓ ' : ''}${escapeHtml(entry.label)}${subtitle}</span>${scoreText}`;
      item.addEventListener('click', () => {
        menu.classList.add('hidden');
        selectEntry(entry.id);
      });
      menu.appendChild(item);
    });
```

And update the current-label line near the top of `renderModeSelector` (~line 233-237):

```js
    const currentLabel = currentView === 'rankings'
      ? (RANK_CATEGORIES.find(c => c.id === currentRankCategory) || RANK_CATEGORIES[0]).label
      : getModeById(currentMode).label;
    const completed = isEntryCompleted(activeIdForLabel());
    label.textContent = (completed ? '✓ ' : '') + currentLabel;
    toggle.classList.toggle('completed', completed);
```

Add helpers (above `renderModeSelector`):

```js
  function activeIdForLabel() {
    return currentView === 'rankings' ? currentRankCategory : currentMode;
  }
  function storageKeyFor(id) {
    if (currentView === 'rankings') return STORAGE_KEY + '-rank-' + id;
    return STORAGE_KEY + (id === 'all' ? '' : '-' + id);
  }
  function isEntryCompleted(id) {
    const data = JSON.parse(localStorage.getItem(storageKeyFor(id)) || '{}');
    return !!data[getTodayString()];
  }
  function getEntryScore(id) {
    const data = JSON.parse(localStorage.getItem(storageKeyFor(id)) || '{}');
    return data[getTodayString()] || null;
  }
```

Delete the now-superseded `isModeCompleted` and `getModeScore` (~lines 216-227); the new helpers replace them.

- [ ] **Step 5: Add `selectEntry` and refactor `switchMode`**

Replace `switchMode` (~lines 275-283) with view-aware switching:

```js
  function selectEntry(id) {
    if (currentView === 'rankings') {
      if (id === currentRankCategory) return;
      currentRankCategory = id;
    } else {
      if (id === currentMode) return;
      currentMode = id;
      filterEventsByMode();
    }
    writeHash();
    resetGameState();
    renderModeSelector();
    startActivePuzzle();
  }

  function switchView(view) {
    if (view === currentView) return;
    currentView = view;
    document.getElementById('view-time').classList.toggle('active', view === 'time');
    document.getElementById('view-rankings').classList.toggle('active', view === 'rankings');
    document.body.classList.toggle('rankings-view', view === 'rankings');
    if (view === 'time') filterEventsByMode();
    writeHash();
    resetGameState();
    renderModeSelector();
    startActivePuzzle();
  }
```

- [ ] **Step 6: Wire toggle buttons and hashchange in `init`**

In `init`, replace the existing `currentMode = getModeFromHash();` block (~line 937) and the `hashchange` listener (~lines 950-953) with:

```js
    const parsed = parseHash();
    currentView = parsed.view;
    currentMode = parsed.mode;
    currentRankCategory = parsed.rankCategory;
    document.getElementById('view-time').classList.toggle('active', currentView === 'time');
    document.getElementById('view-rankings').classList.toggle('active', currentView === 'rankings');
    document.body.classList.toggle('rankings-view', currentView === 'rankings');
    filterEventsByMode();
    renderModeSelector();
    startActivePuzzle();
    attachListDropFallback();

    document.getElementById('view-time').addEventListener('click', () => switchView('time'));
    document.getElementById('view-rankings').addEventListener('click', () => switchView('rankings'));
```

Replace the old `hashchange` handler with:

```js
    window.addEventListener('hashchange', () => {
      const p = parseHash();
      if (p.view !== currentView) { switchView(p.view); return; }
      const targetId = p.view === 'rankings' ? p.rankCategory : p.mode;
      const activeId = p.view === 'rankings' ? currentRankCategory : currentMode;
      if (targetId !== activeId) selectEntry(targetId);
    });
```

Note: `startPuzzle()` is still called directly at the end of the old `init`; ensure it is now `startActivePuzzle()` (covered above) and the old direct `startPuzzle()` line is removed.

- [ ] **Step 7: Style the view toggle**

In `style.css`, append:

```css
#view-toggle {
  display: flex;
  gap: 6px;
  justify-content: center;
  margin: 0 auto 12px;
}
.view-btn {
  padding: 8px 18px;
  border: 1px solid var(--border, #d0d0d0);
  background: transparent;
  border-radius: 999px;
  cursor: pointer;
  font: inherit;
  font-weight: 600;
  opacity: 0.6;
}
.view-btn.active {
  opacity: 1;
  background: var(--accent, #2d2d2d);
  color: #fff;
  border-color: transparent;
}
.mode-item-subtitle {
  display: block;
  font-size: 0.8em;
  opacity: 0.6;
  font-weight: 400;
}
```

(If `style.css` already defines `--accent` / `--border`, the fallbacks are ignored; otherwise the literals apply.)

- [ ] **Step 8: Manual verification — full Rankings flow**

Run: `python3 -m http.server 8080`, open `http://localhost:8080`.
- Click **📊 Rankings** → dropdown lists the 5 categories, each with today's puzzle title as a subtitle; caps read e.g. `SMALLEST` / `LARGEST`.
- Play a category: drag to order, **Draw Event** adds reserves, **Submit** scores.
- Switch categories from the dropdown → a new puzzle loads.
- Click **⏱ Time** → returns to the date game unchanged; URL drops to `#` or `#<mode>`.
- Reload on `#rankings/sports` → deep-links straight into that category.

Expected: all of the above behave correctly with no console errors.

- [ ] **Step 9: Commit**

```bash
git add index.html app.js style.css
git commit -m "feat: add view toggle and rankings category dropdown"
```

---

## Task 7: Results value display, share text, and per-view copy

Show formatted values (not dates) in ranking results, distinguish shared results, and adapt the header/help text. Also ensure no hint row renders in Rankings.

**Files:**
- Modify: `app.js`, `index.html`

- [ ] **Step 1: Use `itemDisplayString` in results rows**

In `showResults`, the `rowHTML` helper (~lines 713-730) renders `formatDate(ev.date)` inside `.row-date`. Replace that with `itemDisplayString(ev)` so Time shows dates and Rankings shows formatted values:

Change `<span class="row-date">${formatDate(ev.date)}</span>` to
`<span class="row-date">${escapeHtml(itemDisplayString(ev))}</span>`.

- [ ] **Step 2: Suppress hints on ranking cards**

In `createEventCard` (~lines 348-405), the hint row renders a decade button always and a category button when `currentMode === 'all'`. Gate the entire hints row on the Time view. Set near the top of `createEventCard`:

```js
    const showHints = currentView === 'time';
    const showCatHint = currentView === 'time' && currentMode === 'all';
```

Wrap the `.card-hints-row` block so it only renders when `showHints` is true (when false, render an empty string for that row), and guard the decade-button event listener with `if (showHints) { ... }` so `card.querySelector('.hint-decade-btn')` is not called when absent.

- [ ] **Step 3: Ensure `getHintPenalty` is zero in Rankings**

`getHintPenalty` (~lines 100-103) sums `revealedCategories` / `revealedDecades`, both empty in Rankings (no hint UI), so it already returns 0. No change needed — verify by reading the function. (Documented here so the implementer doesn't add a redundant guard.)

- [ ] **Step 4: View-aware puzzle header**

In `renderPuzzleInfo` (~lines 300-307), branch the label:

```js
  function renderPuzzleInfo(dateStr) {
    const num = getPuzzleNumber(dateStr);
    const displayDate = formatDate(dateStr);
    let label;
    if (currentView === 'rankings') {
      const cat = RANK_CATEGORIES.find(c => c.id === currentRankCategory);
      label = ` · ${cat ? cat.label : ''}${activePuzzle ? ' — ' + activePuzzle.title : ''}`;
    } else {
      const mode = getModeById(currentMode);
      label = currentMode === 'all' ? '' : ` · ${mode.label}`;
    }
    document.getElementById('puzzle-info').textContent =
      `Puzzle #${num}${label} — ${displayDate}`;
  }
```

- [ ] **Step 5: View-aware share text**

In `shareResults` (~lines 841-851), branch the header line:

```js
    let header;
    if (currentView === 'rankings') {
      const cat = RANK_CATEGORIES.find(c => c.id === currentRankCategory);
      header = `📊 Orderly Rankings #${num} [${cat ? cat.label : ''}]`;
    } else {
      const mode = getModeById(currentMode);
      const modeLabel = currentMode === 'all' ? '' : ` [${mode.label}]`;
      header = `⏱️ Orderly #${num}${modeLabel}`;
    }
    const text = `${header}\nScore: ${result.score}/${result.maxScore} (${result.attempted} events)\n${emoji}`;
```

(Remove the old `const text = ...` and `modeLabel` lines this replaces.)

- [ ] **Step 6: Per-view tagline**

In `index.html`, give the tagline an id: change `<p class="tagline">…</p>` (~line 16) to `<p class="tagline" id="tagline">…</p>`. In `app.js`, set it per view — add to `switchView` and the `init` setup, a call to:

```js
  function updateTagline() {
    const el = document.getElementById('tagline');
    if (!el) return;
    if (currentView === 'rankings') {
      el.innerHTML = 'Arrange items from <strong>least</strong> (top) to <strong>most</strong> (bottom)';
    } else {
      el.innerHTML = 'Arrange events from <strong>earliest</strong> (top) to <strong>latest</strong> (bottom)';
    }
  }
```

Call `updateTagline()` at the end of `switchView` and once in `init` after the view is set.

- [ ] **Step 7: Manual verification — results + share + copy**

Run: `python3 -m http.server 8080`, open the page, play a Rankings puzzle to completion.
- Results columns show **formatted values** (e.g. "17,098,242 km²", "33.1 PPG"), not dates.
- No hint buttons appear on ranking cards.
- **Copy Results** → clipboard reads `📊 Orderly Rankings #N [Geography]` etc.
- Switch to Time, play a date puzzle → still shows dates and `⏱️ Orderly #N`.
- Tagline reads "least … most" in Rankings, "earliest … latest" in Time.

Expected: all correct, no console errors.

- [ ] **Step 8: Commit**

```bash
git add app.js index.html
git commit -m "feat: ranking results value display, share text, and per-view copy"
```

---

## Task 8: How-to-play copy, README, and final verification

**Files:**
- Modify: `index.html`, `README.md`

- [ ] **Step 1: Add a Rankings note to How-to-Play**

In `index.html`'s `#how-to-play` block (~lines 19-54), add one paragraph after the intro that explains the Rankings view:

```html
        <p><strong>Two ways to play.</strong> In <strong>Time</strong>, order events from earliest to latest. In <strong>Rankings</strong>, order items by a measurable attribute (population, height, points…) — one puzzle from each category every day. Rankings has no hints.</p>
```

- [ ] **Step 2: Document the Rankings view in the README**

In `README.md`, add a section after "Adding events":

````markdown
## Rankings view

A second game family: order items by a measurable attribute instead of by date. One puzzle
per top-level category each day (Geography, Nature & Human-Scale, Economics & Data,
Language & Culture, Sports). Reachable at `#rankings/<category>` or via the 📊 Rankings toggle.

Data lives in `rankings.json` — an array of topic objects:

```json
{
  "id": "mountains-by-height",
  "category": "geography",
  "title": "Mountains by height",
  "axis": { "lowLabel": "LOWEST", "highLabel": "HIGHEST", "unit": "m", "format": "comma" },
  "items": [ { "name": "Mount Everest", "value": 8849 } ]
}
```

`axis.format` is one of `compact` | `comma` | `decimal` | `plain`. Items are ordered ascending
by `value`. Validate the file with:

```bash
node validate_rankings.js
```
````

- [ ] **Step 3: Run the whole test suite**

Run: `node --test`
Expected: all tests across `test/rankings-core.test.js` and `test/rankings-data.test.js` PASS.

- [ ] **Step 4: Run the data validator**

Run: `node validate_rankings.js`
Expected: exit 0, every category `>= 4` topics.

- [ ] **Step 5: Final cross-view manual smoke test**

Run: `python3 -m http.server 8080`. Verify in one sitting:
- Time view: a mode puzzle plays, scores, shares as `⏱️ Orderly`.
- Rankings view: each of the 5 categories loads a distinct puzzle, plays, scores, shares as `📊 Orderly Rankings`.
- Deep links: `#nba` and `#rankings/sports` both load directly.
- Completed badges (✓ + score) persist per category after a reload.

- [ ] **Step 6: Commit**

```bash
git add index.html README.md
git commit -m "docs: document rankings view in help text and README"
```

---

## Self-Review notes (for the implementer)

- **Spec coverage:** view switch (Task 6), 5 categories incl. Sports (Tasks 3,4,6), full-parity mechanics reused (Tasks 4,5), **no hints** (Task 7 Step 2-3), `rankings.json` model + heavy seed (Task 3), ascending sort + dynamic caps (Tasks 4,6), `#rankings/<category>` routing + per-category storage (Tasks 4,6), distinct share text (Task 7), README (Task 8) — all mapped.
- **Identity key caveat:** the engine identifies items by `ev.event`. Ranking items are normalized so `ev.event === ev.name` (Task 5 Step 2 / Step 4). Two items in one puzzle must have **unique names** — enforced by the validator (Task 3).
- **Equal values:** ties (e.g. two animals at 55 mph) sort stably; either order scores as "correct vs correct" only if they land in their sorted slots. Acceptable for v1; if undesirable, dedupe values within a topic during data authoring.
