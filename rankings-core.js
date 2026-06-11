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
        const rounded = Math.round(n * 10) / 10;
        const numStr = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
        return `${numStr} ${word}`;
      }
    }
    return String(Math.round(value));
  }

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

  return { formatValue, mulberry32, hashString, seededShuffle };
});
