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
