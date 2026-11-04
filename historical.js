'use strict';
// Real Powerball winning results: NY State Gaming Commission public Socrata dataset.
// Only public draw records are fetched; no personal combinations are sent anywhere.
// Archive updates only while the app is open and online (not in the background).
(() => {
  const DATA_URL = 'https://data.ny.gov/resource/d6yy-54nr.json';
  const FIRST_FORMAT_DATE = '2015-10-07';
  const STORE = 'official_draws';
  const CLOCK_KEY = 'number-bank-official-sync-v3';
  const REFRESH_PERIOD = 12 * 60 * 60 * 1000;
  const PAGE_SIZE = 12;
  let draws = [];
  let shown = PAGE_SIZE;
  let syncing = false;
  let stats = null;
  let lastSuccess = 0;
  const el = id => document.getElementById(id);
  const fmt = value => String(value).padStart(2, '0');
  const dateText = date => {
    try { return new Date(date + 'T12:00:00').toLocaleDateString(undefined, {year:'numeric',month:'short',day:'numeric'}); }
    catch { return date; }
  };
  const status = message => { if (el('history-sync-status')) el('history-sync-status').textContent = message; };
  function safeClock() {
    try { return Number(localStorage.getItem(CLOCK_KEY)) || 0; }
    catch { return 0; }
  }
  function setClock(timestamp) {
    lastSuccess = timestamp;
    try { localStorage.setItem(CLOCK_KEY, String(timestamp)); } catch {}
  }
  function parseDraw(row) {
    if (!row || typeof row.draw_date !== 'string' || typeof row.winning_numbers !== 'string') return null;
    const date = row.draw_date.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < FIRST_FORMAT_DATE) return null;
    const parts = row.winning_numbers.trim().split(/\s+/).map(Number);
    if (parts.length !== 6 || parts.some(n => !Number.isInteger(n))) return null;
    const main = parts.slice(0, 5).sort((a,b) => a-b), special = parts[5];
    if (main.some(n => n < 1 || n > 69) || new Set(main).size !== 5 || special < 1 || special > 26) return null;
    return {date, main, special};
  }
  function loadSaved() {
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result.sort((a,b) => b.date.localeCompare(a.date)));
      req.onerror = () => reject(req.error);
    });
  }
  function saveRows(rows) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE,'readwrite');
      const store = tx.objectStore(STORE);
      for (const row of rows) store.put(row);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
  async function refresh(force = false) {
    if (syncing) return;
    if (!navigator.onLine) { status('Offline. Showing previously stored results, if any.'); return; }
    if (!force && lastSuccess && Date.now() - lastSuccess < REFRESH_PERIOD) {
      status(`Using cached official results · Last checked ${new Date(lastSuccess).toLocaleString()}`);
      return;
    }
    syncing = true;
    el('sync-history').disabled = true;
    status('Downloading official winning results from New York State Open Data…');
    try {
      const url = new URL(DATA_URL);
      url.searchParams.set('$select', 'draw_date,winning_numbers');
      url.searchParams.set('$where', `draw_date >= '${FIRST_FORMAT_DATE}T00:00:00'`);
      url.searchParams.set('$order', 'draw_date DESC');
      url.searchParams.set('$limit', '5000');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);
      let response;
      try { response = await fetch(url.toString(), {signal: controller.signal, cache:'no-store'}); }
      finally { clearTimeout(timer); }
      if (!response.ok) throw new Error('Data service returned HTTP ' + response.status);
      const raw = await response.json();
      if (!Array.isArray(raw)) throw new Error('Unexpected response from the public data service.');
      const results = raw.map(parseDraw).filter(Boolean);
      if (!results.length) throw new Error('The service returned no compatible drawing results.');
      await saveRows(results);
      draws = await loadSaved();
      computeStats();
      setClock(Date.now());
      renderArchive();
      showInsights();
      window.ResearchLab?.onHistorySync();
      status(`Updated ${draws.length.toLocaleString()} official drawings · Last checked ${new Date(lastSuccess).toLocaleString()}`);
    } catch (error) {
      console.warn('Unable to refresh official draw history:', error);
      status(`Could not refresh official results (${error.name === 'AbortError' ? 'connection timed out' : error.message}). ${draws.length ? 'Showing saved offline records.' : 'Connect to the internet and tap Refresh official results.'}`);
    } finally {
      syncing = false;
      el('sync-history').disabled = false;
    }
  }
  function addBall(value, special = false) {
    const tag = document.createElement('span');
    tag.className = 'mini-ball' + (special ? ' mini-special' : '');
    tag.textContent = fmt(value);
    return tag;
  }
  function renderArchive() {
    el('official-count').textContent = draws.length.toLocaleString();
    el('official-latest').textContent = draws.length ? dateText(draws[0].date) : '—';
    const list = el('official-draw-list');
    list.replaceChildren();
    if (!draws.length) {
      const empty = document.createElement('div'); empty.className = 'empty-state';
      empty.textContent = 'No official records stored yet. Tap Refresh official results when online.';
      list.append(empty);
    }
    for (const draw of draws.slice(0, shown)) {
      const item = document.createElement('article'); item.className = 'official-draw-row';
      const link = document.createElement('a');
      link.href = `https://www.powerball.com/draw-result?date=${encodeURIComponent(draw.date)}&gc=powerball`;
      link.target = '_blank'; link.rel = 'noopener noreferrer';
      link.textContent = dateText(draw.date) + ' · View details / video ↗';
      link.className = 'official-draw-link';
      const balls = document.createElement('div'); balls.className = 'entry-balls';
      draw.main.forEach(n => balls.append(addBall(n)));
      balls.append(addBall(draw.special, true));
      item.append(link, balls);
      const study = document.createElement('button');
      study.type='button'; study.className='page-btn study-link'; study.textContent='Open linked drawing study →';
      study.addEventListener('click', () => window.ResearchLab?.openDate(draw.date));
      item.append(study); list.append(item);
    }
    el('more-official').hidden = shown >= draws.length;
  }
  function computeStats() {
    const mainCounts = Array(70).fill(0), redCounts = Array(27).fill(0);
    const recentWhite = Array(70).fill(0), recentRed = Array(27).fill(0);
    const pairs = new Map();
    const recentN = Math.min(draws.length, 120);
    draws.forEach((row, idx) => {
      for (const n of row.main) { mainCounts[n]++; if (idx < recentN) recentWhite[n]++; }
      redCounts[row.special]++;
      if (idx < recentN) recentRed[row.special]++;
      if (idx < 120) for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) {
        const key = fmt(row.main[i]) + '–' + fmt(row.main[j]);
        pairs.set(key, (pairs.get(key) || 0) + 1);
      }
    });
    stats = {mainCounts, redCounts, recentWhite, recentRed, recentN,
      pairs: [...pairs.entries()].sort((a,b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0,7)};
    const explainer = el('strategy-explainer');
    if (explainer) explainer.textContent = draws.length
      ? `Using ${draws.length.toLocaleString()} historical results, giving modest extra weight to numbers more frequent in the last ${recentN} draws. This is experimental, not a statistically proven prediction advantage.`
      : 'When official results are unavailable, history-informed mode falls back to pure randomness. Past draws cannot reliably predict fair future draws.';
  }
  // CSPRNG-based weighted selection, without replacement. No Math.random dependency.
  function weightedChoice(candidates, count, expected) {
    const max = Math.max(...count.slice(1));
    if (!max) return candidates[secureRandomIndex(candidates.length)];
    const weights = candidates.map(n => {
      const relative = count[n] / Math.max(0.001, expected);
      return Math.max(0.70, Math.min(1.35, 0.85 + 0.15 * relative));
    });
    const total = weights.reduce((sum, v) => sum + v, 0);
    const buf = new Uint32Array(1); crypto.getRandomValues(buf);
    let position = (buf[0] / 4294967296) * total;
    for (let i = 0; i < weights.length; i++) {
      position -= weights[i];
      if (position < 0) return candidates[i];
    }
    return candidates[candidates.length - 1];
  }
  function makeWeightedSet(allowRedMatch = true) {
    if (!stats || draws.length < 20) return null;
    const redCandidates = Array.from({length:26}, (_, i) => i+1);
    const special = weightedChoice(redCandidates,stats.recentRed,stats.recentN / 26);
    const available = Array.from({length:69}, (_,i)=>i+1).filter(n=>allowRedMatch || n!==special);
    const main = [];
    for (let i = 0; i < 5; i++) {
      const value = weightedChoice(available, stats.recentWhite, stats.recentN * 5 / 69);
      main.push(value);
      available.splice(available.indexOf(value),1);
    }
    return {main:main.sort((a,b)=>a-b),special};
  }
  function topNumbers(counts, limit = 8, ascending = false) {
    return counts.map((count, number) => ({number,count})).slice(1)
      .sort((a,b) => (ascending ? a.count-b.count : b.count-a.count) || a.number-b.number).slice(0,limit);
  }
  function createFrequencyList(title, values, maxValue, gold = false) {
    const section = document.createElement('div');
    const heading = document.createElement('h3'); heading.textContent = title; section.append(heading);
    const group = document.createElement('div'); group.className = 'freq-list';
    for (const item of values) {
      const row = document.createElement('div'); row.className='freq-row';
      const label = document.createElement('span');label.className='freq-id';label.textContent=fmt(item.number);
      const meter = document.createElement('div');meter.className='freq-meter'+(gold?' gold':'');
      const fill = document.createElement('span');fill.style.width = `${Math.max(0,item.count / Math.max(1,maxValue) * 100)}%`;meter.append(fill);
      const counter = document.createElement('span');counter.className='freq-count';counter.textContent=String(item.count);
      row.append(label,meter,counter);group.append(row);
    }
    section.append(group);return section;
  }
  function showInsights() {
    const area = el('history-analysis');
    if (!area) return;
    area.replaceChildren();
    if (!draws.length || !stats) {
      area.textContent = 'Official records not available yet. Go to Past Powerball drawings and select Refresh official results.';
      return;
    }
    const header = document.createElement('div');header.className='insight-top';
    for (const [key, val] of [
      ['OFFICIAL DRAWS', draws.length.toLocaleString()],
      ['RECENT WINDOW', stats.recentN + ' draws'],
      ['EXPECTED WHITE', (stats.recentN*5/69).toFixed(1)]
    ]) {
      const unit=document.createElement('div');unit.className='insight-metric';
      const label=document.createElement('small');label.textContent=key;
      const value=document.createElement('strong');value.textContent=val;
      unit.append(label,value);header.append(unit);
    }
    area.append(header);
    const grid=document.createElement('div');grid.className='insight-grid';
    const lists=[
      ['Most frequent white (recent)',topNumbers(stats.recentWhite),stats.recentN*5/69,false],
      ['Least frequent white (recent)',topNumbers(stats.recentWhite,8,true),stats.recentN*5/69,false],
      ['Most frequent special (recent)',topNumbers(stats.recentRed),stats.recentN/26,true],
      ['Most frequent white (all time)',topNumbers(stats.mainCounts),draws.length*5/69,false]
    ];
    for (const [title,values,expected,gold] of lists) grid.append(createFrequencyList(title,values,Math.max(expected,...values.map(v=>v.count)),gold));
    area.append(grid);
    const line=document.createElement('p');line.className='history-insight-pairs';
    line.textContent = 'Common white-ball pairs in the last 120 draws: ' +
      (stats.pairs.map(([pair,n])=> `${pair} (${n}×)`).join(' · ') || 'None');
    area.append(line);
    const caveat=document.createElement('p');caveat.className='insight-disclaimer';
    caveat.textContent=`Expected frequencies are based on independent, uniform draws (recent white ≈ ${(stats.recentN*5/69).toFixed(1)}, recent special ≈ ${(stats.recentN/26).toFixed(1)}). Random data naturally contains streaks. Frequency weighting has not demonstrated improved odds. Results are from public records, not footage analysis.`;
    area.append(caveat);
  }
  async function start() {
    lastSuccess = safeClock();
    draws = await loadSaved();
    computeStats();renderArchive();showInsights();
    if (draws.length) status(`Loaded ${draws.length.toLocaleString()} saved official draws. Checking for updates…`);
    await refresh(false);
  }
  document.addEventListener('DOMContentLoaded',()=>{
    el('sync-history').addEventListener('click',()=>refresh(true));
    el('more-official').addEventListener('click',()=>{shown+=PAGE_SIZE;renderArchive();});
    window.addEventListener('online',()=>{ if (db) refresh(); });
    document.addEventListener('visibilitychange',()=>{ if (!document.hidden && db) refresh(); });
    // Check periodically while the app remains open; iOS may suspend this timer in the background.
    setInterval(() => { if (!document.hidden && db) refresh(); }, 30 * 60 * 1000);
    el('strategy-select').addEventListener('change',()=>{
      if(el('strategy-select').value === 'historical' && !draws.length)
        status('Historical weighting is selected, but official results have not loaded; using fair random instead.');
    });
  });
  window.HistoryLab = {start,showInsights,makeWeightedSet,parseDraw, getDraw:(date)=>draws.find(d=>d.date===date)||null, getDraws:()=>draws.slice()};
})();
