const { test } = require('node:test');
const assert = require('node:assert');
const { formatValue } = require('../rankings-core.js');

test('formatValue compact uses word magnitudes', () => {
  assert.equal(formatValue(1428000000, { format: 'compact', unit: 'people' }), '1.4 billion people');
  assert.equal(formatValue(375000, { format: 'compact', unit: 'people' }), '375 thousand people');
  assert.equal(formatValue(2500000000000, { format: 'compact', unit: '' }), '2.5 trillion');
  assert.equal(formatValue(840, { format: 'compact', unit: '' }), '840');
  assert.equal(formatValue(999.9, { format: 'compact', unit: 'km' }), '1 thousand km');
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
  assert.deepEqual([...out1].sort((a, b) => a - b), src);
  assert.deepEqual(src, [1, 2, 3, 4, 5]); // input not mutated
});

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
