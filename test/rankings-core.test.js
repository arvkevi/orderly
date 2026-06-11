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
