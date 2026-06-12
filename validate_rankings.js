'use strict';
const VALID_CATEGORIES = ['geography', 'nature', 'economics', 'language', 'sports'];
const MIN_ITEMS = 20;     // pool must comfortably exceed the 10 drawn per day
const MIN_TOPICS_PER_CATEGORY = 4;

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
