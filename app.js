(function () {
  'use strict';

  const { mulberry32, hashString, seededShuffle } = window.RankingsCore;

  // --- Config ---
  const BASE_DATE = '2026-03-31';
  const INITIAL_EVENTS = 5;
  const RESERVE_EVENTS = 5;
  const TOTAL_POOL = INITIAL_EVENTS + RESERVE_EVENTS;
  const MIN_EVENTS = 3;
  const STORAGE_KEY = 'orderly';
  const CATEGORY_HINT_COST = 1;
  function getDecadeHintCost() {
    return Math.max(0, activeEvents.length - 3);
  }

  // --- Modes ---
  const MODES = [
    { id: 'all', label: 'Grab Bag', categories: null },
    { id: 'history', label: 'History', categories: ['history', 'politics'] },
    { id: 'kpop', label: 'K-Pop', categories: ['kpop'] },
    { id: 'miffy', label: 'Miffy', categories: ['miffy'] },
    { id: 'movies-tv', label: 'Movies & TV', categories: ['movies', 'tv'] },
    { id: 'music', label: 'Music', categories: ['music'] },
    { id: 'nba', label: 'NBA', categories: ['nba'] },
    { id: 'nfl', label: 'NFL', categories: ['nfl'] },
    { id: 'pop-culture', label: 'Pop Culture', categories: ['pop culture', 'celebrity', 'viral', 'fashion', 'food', 'social media'] },
    { id: 'science-space', label: 'Science & Space', categories: ['science', 'space', 'medicine', 'disaster'] },
    { id: 'sports', label: 'Sports', categories: ['sports'] },
    { id: 'tech-gaming', label: 'Tech & Gaming', categories: ['tech', 'gaming', 'internet'] },
    { id: 'us-history', label: 'United States History', categories: ['us history'] },
  ];

  // --- Ranking categories (one daily puzzle each) ---
  const RANK_CATEGORIES = [
    { id: 'geography', label: 'Geography' },
    { id: 'nature', label: 'Nature & Human-Scale' },
    { id: 'economics', label: 'Economics & Data' },
    { id: 'language', label: 'Language & Culture' },
    { id: 'sports', label: 'Sports' },
  ];

  // --- State ---
  let allEvents = [];
  let currentMode = 'all';
  let modeEvents = [];         // events filtered to current mode
  let activeEvents = [];
  let reserveEvents = [];
  let revealedCategories = new Set();
  let revealedDecades = new Set();
  let drawnEvents = [];
  let submitted = false;
  let currentView = 'time';        // 'time' | 'rankings'
  let allTopics = [];              // loaded from rankings.json
  let currentRankCategory = RANK_CATEGORIES[0].id;
  let activePuzzle = null;         // descriptor for the current ranking puzzle

  // --- Date helpers ---
  function getTodayString() {
    const now = new Date();
    return now.getFullYear() + '-' +
      String(now.getMonth() + 1).padStart(2, '0') + '-' +
      String(now.getDate()).padStart(2, '0');
  }

  function getPuzzleNumber(dateStr) {
    const base = new Date(BASE_DATE + 'T00:00:00');
    const today = new Date(dateStr + 'T00:00:00');
    return Math.floor((today - base) / 86400000) + 1;
  }

  function formatDate(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return date.toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric'
    });
  }

  function getDecade(dateStr) {
    const year = parseInt(dateStr.substring(0, 4));
    return Math.floor(year / 10) * 10 + 's';
  }

  function getHintPenalty() {
    return revealedCategories.size * CATEGORY_HINT_COST +
           revealedDecades.size * getDecadeHintCost();
  }

  // --- Mode helpers ---
  function getModeById(id) {
    return MODES.find(m => m.id === id) || MODES[0];
  }

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

  // Ranking items are {name, value}; the engine identifies cards by ev.event,
  // so alias event -> name. Idempotent and safe to call on shared pool objects.
  function normalizeRankingItems(pool) {
    pool.forEach(it => { if (it.event === undefined) it.event = it.name; });
    return pool;
  }

  function getStorageKey() {
    // Delegates to storageKeyFor so the key scheme lives in one place.
    return storageKeyFor(activeIdForLabel());
  }

  function filterEventsByMode() {
    const mode = getModeById(currentMode);
    if (!mode.categories) {
      modeEvents = allEvents;
    } else {
      const cats = new Set(mode.categories);
      modeEvents = allEvents.filter(e => cats.has(e.category));
    }
  }

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

  // --- Local storage ---
  function saveResult(dateStr, result) {
    const key = getStorageKey();
    const data = JSON.parse(localStorage.getItem(key) || '{}');
    data[dateStr] = result;
    localStorage.setItem(key, JSON.stringify(data));
  }

  function loadResult(dateStr) {
    const key = getStorageKey();
    const data = JSON.parse(localStorage.getItem(key) || '{}');
    return data[dateStr] || null;
  }

  // --- Core game logic ---
  function selectDailyEvents(dateStr) {
    const seed = hashString(dateStr + '-' + currentMode);
    const rng = mulberry32(seed);
    const shuffled = seededShuffle(modeEvents, rng);

    if (currentMode === 'all') {
      // Grab bag: prefer category diversity
      const selected = [];
      const usedCategories = {};
      for (const ev of shuffled) {
        if (selected.length >= TOTAL_POOL) break;
        const cat = ev.category || 'misc';
        if (!usedCategories[cat]) usedCategories[cat] = 0;
        if (usedCategories[cat] < 3) {
          selected.push(ev);
          usedCategories[cat]++;
        }
      }
      if (selected.length < TOTAL_POOL) {
        for (const ev of shuffled) {
          if (selected.length >= TOTAL_POOL) break;
          if (!selected.includes(ev)) selected.push(ev);
        }
      }
      return selected.slice(0, TOTAL_POOL);
    } else {
      return shuffled.slice(0, TOTAL_POOL);
    }
  }

  function scoreForDistance(n, distance) {
    if (distance === 0) return n;
    if (distance === 1) return n - 2;
    if (distance === 2) return n - 4;
    // Off by 3+: each extra step costs ⌈n/3⌉ points, so the penalty
    // grows with both how far off you are and how many events you've drawn.
    return -(distance - 2) * Math.ceil(n / 3);
  }

  function calculateScore(userOrder, correctOrder) {
    const n = userOrder.length;
    let totalPoints = 0;
    const perEvent = [];

    for (let i = 0; i < n; i++) {
      const correctIdx = correctOrder.findIndex(
        ce => ce.event === userOrder[i].event && ce.date === userOrder[i].date
      );
      const distance = Math.abs(i - correctIdx);
      const points = scoreForDistance(n, distance);
      totalPoints += points;
      perEvent.push({ points, maxPoints: n, distance, isCorrect: distance === 0 });
    }

    const maxScore = n * n;
    const correct = perEvent.filter(e => e.isCorrect).length;
    const hintPenalty = getHintPenalty();
    const finalScore = Math.max(0, totalPoints - hintPenalty);

    return { correct, attempted: n, score: finalScore, maxScore, hintPenalty, perEvent };
  }

  // --- Mode selector rendering ---
  function currentMenuEntries() {
    if (currentView === 'rankings') {
      return RANK_CATEGORIES.map(c => {
        const topic = window.RankingsCore.pickDailyTopic(allTopics, c.id, getTodayString());
        return { id: c.id, label: c.label, subtitle: topic ? topic.title : '—' };
      });
    }
    return MODES.map(m => ({ id: m.id, label: m.label, subtitle: null }));
  }

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

  function renderModeSelector() {
    const toggle = document.getElementById('mode-dropdown-toggle');
    const label = document.getElementById('mode-current-label');
    const menu = document.getElementById('mode-dropdown-menu');

    const currentLabel = currentView === 'rankings'
      ? (RANK_CATEGORIES.find(c => c.id === currentRankCategory) || RANK_CATEGORIES[0]).label
      : getModeById(currentMode).label;
    const completed = isEntryCompleted(activeIdForLabel());
    label.textContent = (completed ? '✓ ' : '') + currentLabel;
    toggle.classList.toggle('completed', completed);

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

    // Toggle dropdown (assignment, so re-rendering doesn't stack handlers)
    toggle.onclick = () => menu.classList.toggle('hidden');
  }

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

  function updateTagline() {
    const el = document.getElementById('tagline');
    if (!el) return;
    if (currentView === 'rankings') {
      el.innerHTML = 'Arrange items from <strong>least</strong> (top) to <strong>most</strong> (bottom)';
    } else {
      el.innerHTML = 'Arrange events from <strong>earliest</strong> (top) to <strong>latest</strong> (bottom)';
    }
  }

  // Prominent "what am I ordering?" banner shown above the board in Rankings.
  function updateRankPrompt() {
    const el = document.getElementById('rank-prompt');
    if (!el) return;
    if (currentView === 'rankings' && activePuzzle) {
      const ax = activePuzzle.axis;
      el.innerHTML =
        `<span class="rank-prompt-title">${escapeHtml(activePuzzle.title)}</span>` +
        `<span class="rank-prompt-dir">${escapeHtml(ax.lowLabel)}` +
        ` <span class="rank-prompt-arrow">→</span> ${escapeHtml(ax.highLabel)}</span>`;
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
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
    updateTagline();
  }

  function resetGameState() {
    activeEvents = [];
    reserveEvents = [];
    drawnEvents = [];
    revealedCategories = new Set();
    revealedDecades = new Set();
    submitted = false;
    document.getElementById('game').classList.add('hidden');
    document.getElementById('results').classList.add('hidden');
    document.getElementById('loading').classList.remove('hidden');
    document.getElementById('loading').textContent = 'Loading…';
    document.body.classList.remove('results-view');
  }

  // --- Rendering ---
  function renderPuzzleInfo(dateStr) {
    const num = getPuzzleNumber(dateStr);
    const displayDate = formatDate(dateStr);
    let label;
    if (currentView === 'rankings') {
      const cat = RANK_CATEGORIES.find(c => c.id === currentRankCategory);
      label = ` · ${cat ? cat.label : ''}`;
    } else {
      const mode = getModeById(currentMode);
      label = currentMode === 'all' ? '' : ` · ${mode.label}`;
    }
    document.getElementById('puzzle-info').textContent =
      `Puzzle #${num}${label} — ${displayDate}`;
  }

  function updateScorePreview() {
    const n = activeEvents.length;
    const penalty = getHintPenalty();
    const maxRaw = n * n;
    const maxNet = Math.max(0, maxRaw - penalty);

    document.getElementById('current-max').textContent = maxNet;
    if (penalty > 0) {
      document.getElementById('hint-penalty-display').textContent = `(−${penalty} hints)`;
      document.getElementById('hint-penalty-display').classList.remove('hidden');
    } else {
      document.getElementById('hint-penalty-display').classList.add('hidden');
    }

    document.querySelectorAll('.scale-tier').forEach(el => {
      const tierN = parseInt(el.dataset.n);
      el.classList.toggle('active', tierN === n);
    });
  }

  function updateRemainingCount() {
    const count = reserveEvents.length;
    const btn = document.getElementById('add-event-btn');
    const countEl = document.getElementById('remaining-count');
    countEl.textContent = `(${count} remaining)`;
    btn.disabled = count === 0;
    btn.classList.toggle('btn-disabled', count === 0);
  }

  function renderEventList() {
    const list = document.getElementById('event-list');
    list.innerHTML = '';
    const axis = currentAxis();
    const lowEl = document.getElementById('cap-low');
    const highEl = document.getElementById('cap-high');
    if (lowEl) lowEl.textContent = axis.lowLabel;
    if (highEl) highEl.textContent = axis.highLabel;
    updateRankPrompt();
    activeEvents.forEach((ev, idx) => {
      list.appendChild(createEventCard(ev, idx));
    });
    updateScorePreview();
    updateRemainingCount();
  }

  function createEventCard(ev, index) {
    const card = document.createElement('div');
    card.className = 'event-card';
    card.dataset.index = index;
    card.draggable = true;

    const catRevealed = revealedCategories.has(ev.event);
    const decRevealed = revealedDecades.has(ev.event);
    const showHints = currentView === 'time';
    const showCatHint = currentView === 'time' && currentMode === 'all';

    const hintsRowHtml = showHints ? `
        <div class="card-hints-row">
          ${showCatHint ? `
            <button class="hint-btn hint-category-btn ${catRevealed ? 'hidden' : ''}" title="Costs ${CATEGORY_HINT_COST} pt">Category <span class="hint-cost">−${CATEGORY_HINT_COST}</span></button>
            <span class="hint-revealed hint-cat-value ${catRevealed ? '' : 'hidden'}">${escapeHtml(ev.category || '')}</span>
          ` : ''}
          <button class="hint-btn hint-decade-btn ${decRevealed ? 'hidden' : ''}" title="Costs ${getDecadeHintCost()} pts">Decade <span class="hint-cost">−${getDecadeHintCost()}</span></button>
          <span class="hint-revealed hint-dec-value ${decRevealed ? '' : 'hidden'}">${getDecade(ev.date)}</span>
        </div>
    ` : '';

    card.innerHTML = `
      <span class="card-grip">⠿</span>
      <span class="card-number">${index + 1}</span>
      <div class="card-body">
        <span class="card-event-name">${escapeHtml(ev.event)}</span>
        ${hintsRowHtml}
      </div>
    `;

    const catBtn = card.querySelector('.hint-category-btn');
    if (catBtn) {
      catBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (revealedCategories.has(ev.event)) return;
        if (!confirm(`Reveal category? This costs ${CATEGORY_HINT_COST} point.`)) return;
        revealedCategories.add(ev.event);
        catBtn.classList.add('hidden');
        card.querySelector('.hint-cat-value').classList.remove('hidden');
        updateScorePreview();
      });
    }

    if (showHints) {
      card.querySelector('.hint-decade-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        if (revealedDecades.has(ev.event)) return;
        if (!confirm(`Reveal decade? This costs ${getDecadeHintCost()} points.`)) return;
        revealedDecades.add(ev.event);
        card.querySelector('.hint-decade-btn').classList.add('hidden');
        card.querySelector('.hint-dec-value').classList.remove('hidden');
        updateScorePreview();
      });
    }

    card.addEventListener('dragstart', onDragStart);
    card.addEventListener('dragend', onDragEnd);
    card.addEventListener('dragover', onDragOver);
    card.addEventListener('dragleave', onDragLeave);
    card.addEventListener('drop', onDrop);
    card.addEventListener('touchstart', onTouchStart, { passive: false });

    return card;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // --- Desktop Drag & Drop ---
  let dragSrcIndex = null;
  let dropIndicatorEl = null;

  function getDropIndicator() {
    if (!dropIndicatorEl) {
      dropIndicatorEl = document.createElement('div');
      dropIndicatorEl.className = 'drop-indicator';
      // The indicator is a valid drop target too — if the user releases
      // directly on it we still want the drop to register.
      dropIndicatorEl.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      });
      dropIndicatorEl.addEventListener('drop', onDropOnIndicator);
    }
    return dropIndicatorEl;
  }

  function showDropIndicator(card, position) {
    const list = card.parentElement;
    if (!list) return;
    const indicator = getDropIndicator();
    const reference = position === 'above' ? card : card.nextSibling;
    // Avoid no-op re-insertion (which would restart the CSS animation).
    if (indicator.parentElement === list && indicator.nextSibling === reference) return;
    list.insertBefore(indicator, reference);
  }

  // Resolves the target index in `activeEvents` based on where the indicator
  // currently sits in the DOM (between two `.event-card` siblings).
  function indicatorTargetIndex() {
    if (!dropIndicatorEl || !dropIndicatorEl.parentElement) return null;
    let next = dropIndicatorEl.nextElementSibling;
    while (next && !next.classList.contains('event-card')) {
      next = next.nextElementSibling;
    }
    return next ? parseInt(next.dataset.index) : activeEvents.length;
  }

  function highlightMovedCard(targetIndex) {
    requestAnimationFrame(() => {
      const list = document.getElementById('event-list');
      const card = list && list.querySelector(`.event-card[data-index="${targetIndex}"]`);
      if (!card) return;
      card.classList.add('just-moved');
      card.addEventListener('animationend', () => card.classList.remove('just-moved'), { once: true });
    });
  }

  function performReorder(srcIndex, targetIndex) {
    if (srcIndex === null || targetIndex === null) return false;
    if (targetIndex > srcIndex) targetIndex--;
    if (targetIndex === srcIndex) return false;
    const [moved] = activeEvents.splice(srcIndex, 1);
    activeEvents.splice(targetIndex, 0, moved);
    renderEventList();
    highlightMovedCard(targetIndex);
    return true;
  }

  function onDragStart(e) {
    if (e.target.closest('.hint-btn')) { e.preventDefault(); return; }
    const card = e.target.closest('.event-card');
    if (!card) return;
    dragSrcIndex = parseInt(card.dataset.index);
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragSrcIndex);
  }

  function onDragEnd(e) {
    const card = e.target.closest('.event-card');
    if (card) card.classList.remove('dragging');
    clearDragIndicators();
    dragSrcIndex = null;
  }

  function onDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const card = e.target.closest('.event-card');
    if (!card || parseInt(card.dataset.index) === dragSrcIndex) return;
    const rect = card.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    showDropIndicator(card, e.clientY < midY ? 'above' : 'below');
  }

  function onDragLeave() {
    // Indicator is managed by onDragOver/onDragEnd; no per-card cleanup needed.
  }

  function onDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    const card = e.target.closest('.event-card');
    if (!card) return;
    const dropIndex = parseInt(card.dataset.index);
    if (dragSrcIndex === null || dragSrcIndex === dropIndex) return;
    const rect = card.getBoundingClientRect();
    const targetIndex = e.clientY < rect.top + rect.height / 2 ? dropIndex : dropIndex + 1;
    performReorder(dragSrcIndex, targetIndex);
  }

  function onDropOnIndicator(e) {
    e.preventDefault();
    e.stopPropagation();
    const targetIndex = indicatorTargetIndex();
    performReorder(dragSrcIndex, targetIndex);
  }

  // Fallback handlers on the list itself: catch fast drops that land in the
  // 8px flex-gap between cards (not on a card and not on the 4px indicator).
  // Bound once during init.
  function attachListDropFallback() {
    const listEl = document.getElementById('event-list');
    if (!listEl || listEl._dropFallbackBound) return;
    listEl._dropFallbackBound = true;
    listEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });
    listEl.addEventListener('drop', (e) => {
      // Card / indicator drop handlers stopPropagation, so we only get
      // here when the drop landed in empty list space.
      e.preventDefault();
      const targetIndex = indicatorTargetIndex();
      if (targetIndex !== null) performReorder(dragSrcIndex, targetIndex);
    });
  }

  function clearDragIndicators() {
    if (dropIndicatorEl && dropIndicatorEl.parentElement) {
      dropIndicatorEl.parentElement.removeChild(dropIndicatorEl);
    }
  }

  // --- Touch Drag & Drop ---
  let touchDragIndex = null;
  let touchGhost = null;
  let touchCurrentCard = null;

  function onTouchStart(e) {
    if (submitted) return;
    if (e.target.closest('.hint-btn')) return;
    const card = e.target.closest('.event-card');
    if (!card) return;
    touchDragIndex = parseInt(card.dataset.index);
    card._touchTimer = setTimeout(() => {
      e.preventDefault();
      createTouchGhost(card, e.touches[0]);
      card.classList.add('dragging');
      document.addEventListener('touchmove', onTouchMove, { passive: false });
      document.addEventListener('touchend', onTouchEnd);
    }, 150);
    card.addEventListener('touchend', function cancel() {
      clearTimeout(card._touchTimer);
      card.removeEventListener('touchend', cancel);
    }, { once: true });
  }

  function createTouchGhost(card, touch) {
    touchGhost = card.cloneNode(true);
    touchGhost.classList.add('drag-ghost');
    const rect = card.getBoundingClientRect();
    touchGhost.style.width = rect.width + 'px';
    touchGhost.style.left = rect.left + 'px';
    touchGhost.style.top = touch.clientY - rect.height / 2 + 'px';
    document.body.appendChild(touchGhost);
  }

  function onTouchMove(e) {
    e.preventDefault();
    const touch = e.touches[0];
    if (touchGhost) touchGhost.style.top = touch.clientY - touchGhost.offsetHeight / 2 + 'px';

    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    const card = el ? el.closest('.event-card') : null;
    touchCurrentCard = card;
    if (card && parseInt(card.dataset.index) !== touchDragIndex) {
      const rect = card.getBoundingClientRect();
      showDropIndicator(card, touch.clientY < rect.top + rect.height / 2 ? 'above' : 'below');
    } else if (el !== dropIndicatorEl) {
      // Keep the indicator visible when the finger hovers over it; only
      // clear when the finger leaves both cards and the indicator.
      clearDragIndicators();
    }
  }

  function onTouchEnd(e) {
    document.removeEventListener('touchmove', onTouchMove);
    document.removeEventListener('touchend', onTouchEnd);
    if (touchGhost) { touchGhost.remove(); touchGhost = null; }

    const touch = e.changedTouches[0];

    // Compute the target BEFORE clearing the indicator (we may need its DOM position).
    let targetIndex = null;
    if (touchDragIndex !== null) {
      if (touchCurrentCard) {
        const dropIndex = parseInt(touchCurrentCard.dataset.index);
        if (dropIndex !== touchDragIndex) {
          const rect = touchCurrentCard.getBoundingClientRect();
          targetIndex = touch.clientY < rect.top + rect.height / 2 ? dropIndex : dropIndex + 1;
        }
      } else {
        // Finger released over the indicator (or empty space) — fall back
        // to the indicator's current DOM position.
        targetIndex = indicatorTargetIndex();
      }
    }

    clearDragIndicators();
    document.querySelectorAll('.event-card.dragging').forEach(c =>
      c.classList.remove('dragging'));

    if (targetIndex !== null) {
      performReorder(touchDragIndex, targetIndex);
    }
    touchDragIndex = null;
    touchCurrentCard = null;
  }

  // --- Add / Remove events (stack-based) ---
  function addEvent() {
    if (reserveEvents.length === 0 || submitted) return;
    const ev = reserveEvents.shift();
    activeEvents.push(ev);
    drawnEvents.push(ev);
    renderEventList();
    const list = document.getElementById('event-list');
    const lastCard = list.lastElementChild;
    if (lastCard) {
      lastCard.classList.add('just-added');
      lastCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      setTimeout(() => lastCard.classList.remove('just-added'), 600);
    }
  }

  // --- Submit ---
  function submit() {
    if (submitted || activeEvents.length < MIN_EVENTS) return;
    submitted = true;

    const correctOrder = sortByActiveKey(activeEvents);
    const result = calculateScore(activeEvents, correctOrder);

    const dateStr = getTodayString();
    saveResult(dateStr, {
      score: result.score,
      maxScore: result.maxScore,
      correct: result.correct,
      attempted: result.attempted,
      hintPenalty: result.hintPenalty,
      perEvent: result.perEvent,
      events: activeEvents.map(e => e.event),
      correctEvents: correctOrder.map(e => e.event)
    });

    showResults(result, correctOrder, dateStr);
  }

  function showResults(result, correctOrder, dateStr) {
    document.getElementById('game').classList.add('hidden');
    document.getElementById('results').classList.remove('hidden');
    document.body.classList.add('results-view');

    const pct = result.maxScore > 0 ? result.score / result.maxScore : 0;
    let title = 'Nice try!';
    if (pct === 1) title = 'Perfect! 🎯';
    else if (pct >= 0.8) title = 'Excellent!';
    else if (pct >= 0.6) title = 'Well done!';
    else if (pct >= 0.4) title = 'Not bad!';
    document.getElementById('results-title').textContent = title;

    document.getElementById('results-score').textContent =
      `${result.score} / ${result.maxScore}`;

    let breakdown = `${result.correct} perfect out of ${result.attempted} events`;
    if (result.hintPenalty > 0) breakdown += ` (−${result.hintPenalty} hint penalty)`;
    document.getElementById('results-breakdown').textContent = breakdown;

    const emojiStr = result.perEvent.map(e => {
      if (e.distance === 0) return '🟩';
      if (e.distance === 1) return '🟨';
      if (e.distance === 2) return '🟧';
      return '🟥';
    }).join('');
    document.getElementById('results-emoji').textContent = emojiStr;

    const userList = document.getElementById('user-order-list');
    const correctList = document.getElementById('correct-order-list');
    userList.innerHTML = '';
    correctList.innerHTML = '';

    // Map "event|date" → correct index, so we can look up where each
    // user-placed card actually belongs without an O(n) findIndex per row.
    const correctIndexFor = new Map();
    correctOrder.forEach((ev, i) => correctIndexFor.set(ev.event + '|' + ev.date, i));

    function rowHTML(ev, displayPos, distance) {
      const cls = distance === 0 ? 'correct' : distance === 1 ? 'close' : 'incorrect';
      const distLabel = distance === 0 ? '✓' : `±${distance}`;
      const title = escapeHtml(ev.event); // hover tooltip in case the row clamps to 2 lines
      return {
        cls,
        html: `
          <span class="row-position">${displayPos}</span>
          <div class="row-body">
            <div class="row-event" title="${title}">${escapeHtml(ev.event)}</div>
            <div class="row-meta">
              <span class="row-date">${escapeHtml(itemDisplayString(ev))}</span>
              <span class="row-distance">${distLabel}</span>
            </div>
          </div>
        `,
      };
    }

    // User's submitted order (left column)
    const n = activeEvents.length;
    activeEvents.forEach((ev, userIdx) => {
      const correctIdx = correctIndexFor.get(ev.event + '|' + ev.date);
      const distance = Math.abs(userIdx - correctIdx);
      const points = scoreForDistance(n, distance);
      const { cls, html } = rowHTML(ev, userIdx + 1, distance);
      const li = document.createElement('li');
      li.className = `result-row ${cls}`;
      li.dataset.matchKey = String(correctIdx);
      const pointsLabel = points >= 0 ? '+' + points : String(points);
      li.innerHTML = `<span class="row-score" aria-label="${points} points">${pointsLabel}</span>${html}`;
      userList.appendChild(li);
    });

    // Correct chronological order (right column)
    correctOrder.forEach((ev, i) => {
      const userIdx = activeEvents.findIndex(
        ae => ae.event === ev.event && ae.date === ev.date
      );
      const distance = Math.abs(userIdx - i);
      const { cls, html } = rowHTML(ev, i + 1, distance);
      const li = document.createElement('li');
      li.className = `result-row ${cls}`;
      li.dataset.matchKey = String(i);
      li.innerHTML = html;
      correctList.appendChild(li);
    });

    setupResultsMatchHighlight();

    document.getElementById('share-btn').onclick = () => shareResults(result, dateStr);
  }

  // Highlight the matching row in the other column on hover/tap so the
  // user can quickly trace where each event ended up vs. where it should be.
  // Also draws a curved SVG connector between the two matched rows.
  let resultsMatchBound = false;
  let activeMatchKey = null;
  function setupResultsMatchHighlight() {
    const comparison = document.getElementById('results-comparison');
    if (!comparison) return;

    const svg = document.getElementById('result-connector');
    const path = svg && svg.querySelector('path');

    const drawConnector = (key) => {
      if (!svg || !path) return;
      if (key == null) {
        svg.classList.remove('active');
        return;
      }
      const userRow = comparison.querySelector(`#user-order-list .result-row[data-match-key="${key}"]`);
      const correctRow = comparison.querySelector(`#correct-order-list .result-row[data-match-key="${key}"]`);
      if (!userRow || !correctRow) {
        svg.classList.remove('active');
        return;
      }
      const cb = comparison.getBoundingClientRect();
      const ub = userRow.getBoundingClientRect();
      const rb = correctRow.getBoundingClientRect();
      // Anchor on the inner edges of each row, vertically centered.
      const x1 = ub.right - cb.left;
      const y1 = ub.top - cb.top + ub.height / 2;
      const x2 = rb.left - cb.left;
      const y2 = rb.top - cb.top + rb.height / 2;
      // Cubic bezier with horizontal handles → smooth S-curve when the
      // two rows are at different vertical positions.
      const dx = Math.max(20, Math.abs(x2 - x1) * 0.5);
      const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
      path.setAttribute('d', d);
      svg.classList.add('active');
    };

    const highlight = (key) => {
      activeMatchKey = key;
      comparison.querySelectorAll('.result-row.match-highlight')
        .forEach(r => r.classList.remove('match-highlight'));
      if (key != null) {
        comparison.querySelectorAll(`.result-row[data-match-key="${key}"]`)
          .forEach(r => r.classList.add('match-highlight'));
      }
      drawConnector(key);
    };

    if (resultsMatchBound) return;
    resultsMatchBound = true;

    comparison.addEventListener('mouseover', (e) => {
      const row = e.target.closest('.result-row');
      if (!row) return;
      highlight(row.dataset.matchKey);
    });
    comparison.addEventListener('mouseleave', () => highlight(null));
    // Tap support: toggling on click works for both touch and mouse.
    comparison.addEventListener('click', (e) => {
      const row = e.target.closest('.result-row');
      if (!row) { highlight(null); return; }
      const already = row.classList.contains('match-highlight');
      highlight(already ? null : row.dataset.matchKey);
    });

    // Keep the curve aligned if the viewport changes size while a match
    // is pinned (e.g. mobile rotation, devtools open).
    window.addEventListener('resize', () => {
      if (activeMatchKey != null) drawConnector(activeMatchKey);
    });
  }

  function shareResults(result, dateStr) {
    const num = getPuzzleNumber(dateStr);
    const emoji = result.perEvent.map(e => {
      if (e.distance === 0) return '🟩';
      if (e.distance === 1) return '🟨';
      if (e.distance === 2) return '🟧';
      return '🟥';
    }).join('');
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

    navigator.clipboard.writeText(text).then(() => {
      const msg = document.getElementById('copied-msg');
      msg.classList.remove('hidden');
      setTimeout(() => msg.classList.add('hidden'), 2000);
    }).catch(() => {
      prompt('Copy your results:', text);
    });
  }

  // --- Restore previous result ---
  function restorePreviousResult(dateStr) {
    const saved = loadResult(dateStr);
    if (!saved) return false;

    renderPuzzleInfo(dateStr);
    document.getElementById('loading').classList.add('hidden');
    document.getElementById('results').classList.remove('hidden');
    submitted = true;

    const result = {
      score: saved.score,
      maxScore: saved.maxScore,
      correct: saved.correct,
      attempted: saved.attempted,
      hintPenalty: saved.hintPenalty || 0,
      perEvent: saved.perEvent || []
    };

    let pool;
    if (currentView === 'rankings') {
      const topic = window.RankingsCore.pickDailyTopic(allTopics, currentRankCategory, getTodayString());
      pool = topic ? window.RankingsCore.pickDailyItems(topic, dateStr, TOTAL_POOL) : [];
      normalizeRankingItems(pool);
    } else {
      pool = selectDailyEvents(dateStr);
    }
    const correctOrder = saved.correctEvents
      ? saved.correctEvents.map(name => pool.find(e => e.event === name) || { event: name, date: '?' })
      : sortByActiveKey(pool.slice(0, saved.attempted));

    activeEvents = saved.events
      ? saved.events.map(name => pool.find(e => e.event === name) || { event: name, date: '?' })
      : [];

    showResults(result, correctOrder, dateStr);
    return true;
  }

  // --- Start puzzle for current mode ---
  function startPuzzle() {
    if (modeEvents.length < TOTAL_POOL) {
      document.getElementById('loading').textContent =
        `Not enough events for this mode (need ${TOTAL_POOL}, have ${modeEvents.length}).`;
      return;
    }

    const dateStr = getTodayString();
    renderPuzzleInfo(dateStr);

    if (restorePreviousResult(dateStr)) return;

    const pool = selectDailyEvents(dateStr);
    const rng = mulberry32(hashString(dateStr + '-' + currentMode + '-display'));
    const shuffledPool = seededShuffle(pool, rng);
    activeEvents = shuffledPool.slice(0, INITIAL_EVENTS);
    reserveEvents = shuffledPool.slice(INITIAL_EVENTS, TOTAL_POOL);

    document.getElementById('loading').classList.add('hidden');
    document.getElementById('game').classList.remove('hidden');
    renderEventList();
  }

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

    const pool = normalizeRankingItems(core.pickDailyItems(topic, dateStr, TOTAL_POOL));
    const rng = core.mulberry32(core.hashString(dateStr + '-rank-' + currentRankCategory + '-display'));
    const shuffled = core.seededShuffle(pool, rng);
    activeEvents = shuffled.slice(0, INITIAL_EVENTS);
    reserveEvents = shuffled.slice(INITIAL_EVENTS, TOTAL_POOL);

    document.getElementById('loading').classList.add('hidden');
    document.getElementById('game').classList.remove('hidden');
    renderEventList();
  }

  function startActivePuzzle() {
    if (currentView === 'rankings') startRankingPuzzle();
    else startPuzzle();
  }

  // --- Init ---
  async function init() {
    try {
      const resp = await fetch('events.json');
      if (!resp.ok) throw new Error('Failed to load events');
      allEvents = await resp.json();
    } catch (err) {
      document.getElementById('loading').textContent =
        'Failed to load events. Make sure to serve this via a web server (e.g. npx serve).';
      return;
    }

    try {
      const rResp = await fetch('rankings.json');
      if (rResp.ok) allTopics = await rResp.json();
    } catch (e) {
      allTopics = [];
    }

    // Open "How to Play" on first visit, collapsed for returning players
    const howToPlay = document.getElementById('how-to-play');
    if (!localStorage.getItem('orderly-seen')) {
      howToPlay.open = true;
      localStorage.setItem('orderly-seen', '1');
    }

    const parsed = parseHash();
    currentView = parsed.view;
    currentMode = parsed.mode;
    currentRankCategory = parsed.rankCategory;
    document.getElementById('view-time').classList.toggle('active', currentView === 'time');
    document.getElementById('view-rankings').classList.toggle('active', currentView === 'rankings');
    document.body.classList.toggle('rankings-view', currentView === 'rankings');
    updateTagline();
    filterEventsByMode();
    renderModeSelector();
    startActivePuzzle();
    attachListDropFallback();

    document.getElementById('view-time').addEventListener('click', () => switchView('time'));
    document.getElementById('view-rankings').addEventListener('click', () => switchView('rankings'));

    // Close the mode dropdown on outside click (bound once, not per render).
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#mode-dropdown')) {
        const menu = document.getElementById('mode-dropdown-menu');
        if (menu) menu.classList.add('hidden');
      }
    });

    document.getElementById('add-event-btn').addEventListener('click', addEvent);

    document.getElementById('submit-btn').addEventListener('click', () => {
      if (activeEvents.length < MIN_EVENTS) return;
      submit();
    });

    window.addEventListener('hashchange', () => {
      const p = parseHash();
      if (p.view !== currentView) { switchView(p.view); return; }
      const targetId = p.view === 'rankings' ? p.rankCategory : p.mode;
      const activeId = p.view === 'rankings' ? currentRankCategory : currentMode;
      if (targetId !== activeId) selectEntry(targetId);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
