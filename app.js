'use strict';

// Personal combinations and cached official results are stored in IndexedDB.
// Official results sync from the New York State Gaming Commission public dataset. No personal sets are uploaded.
// There is no artificial record count limit; actual capacity depends on the device's storage quota.
const DB_NAME = 'number-bank-private-v1';
const STORE_NAME = 'sets';
const DRAWS_STORE = 'official_draws';
const STUDIES_STORE = 'draw_studies';
const SETTINGS_KEY = 'number-bank-allow-red-match-v4';
const PAGE_SIZE = 20;
let db;
let lastGenerated = null;
let pageAnchors = [null];
let pageIndex = 0;
let searchTerm = '';
let renderVersion = 0;
let toastTimer;
let searchTimer;

const $ = id => document.getElementById(id);
const fmt = n => String(n).padStart(2, '0');
const keyFor = (main, special) => `${main.join('-')}|${special}`;
const timeLabel = timestamp => {
  try { return new Date(timestamp).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); }
  catch { return String(timestamp); }
};
const textSet = record => `${record.main.map(fmt).join(' · ')}  |  ${fmt(record.special)}`;

function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2900);
}
function showError(message) { toast(message); console.error(message); }
function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error('This browser does not support local database storage.'));
    const req = indexedDB.open(DB_NAME, 3);
    req.onupgradeneeded = () => {
      const database = req.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        store.createIndex('by_key', 'key', { unique: true });
      }
      if (!database.objectStoreNames.contains(DRAWS_STORE))
        database.createObjectStore(DRAWS_STORE, { keyPath: 'date' });
      if (!database.objectStoreNames.contains(STUDIES_STORE))
        database.createObjectStore(STUDIES_STORE, { keyPath: 'date' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Close other tabs of this app and try again.'));
  });
}
function countRecords() {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function findByKey(key) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).index('by_key').get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function addRecord(record) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const req = tx.objectStore(STORE_NAME).add(record);
    let id;
    req.onsuccess = () => { id = req.result; };
    tx.oncomplete = () => resolve(id);
    tx.onerror = () => reject(tx.error || req.error);
    tx.onabort = () => reject(tx.error || req.error);
  });
}
function removeRecord(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
function removeAll() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

// Cryptographically secure, unbiased whole-number selection.
function secureRandomIndex(length) {
  const upper = 4294967296;
  const threshold = Math.floor(upper / length) * length;
  const buffer = new Uint32Array(1);
  let candidate;
  do { crypto.getRandomValues(buffer); candidate = buffer[0]; } while (candidate >= threshold);
  return candidate % length;
}
function redCanMatch() { return $('allow-red-match')?.checked !== false; }
function makeSet() {
  const allow = redCanMatch();
  const historyChoice = $('strategy-select')?.value === 'historical'
    ? window.HistoryLab?.makeWeightedSet?.(allow) : null;
  if (historyChoice) return makeRecord(historyChoice.main, historyChoice.special, 'generated',
    'History-informed (experimental)');
  // Draw the red ball independently, and draw five white balls without replacement.
  // When red matching is disabled, exclude that one number from white candidates.
  const special = 1 + secureRandomIndex(26);
  const choices = [];
  for (let n = 1; n <= 69; n++) if (allow || n !== special) choices.push(n);
  const main = [];
  for (let i = 0; i < 5; i++) {
    const index = secureRandomIndex(choices.length);
    main.push(choices[index]);
    choices[index] = choices[choices.length - 1];
    choices.pop();
  }
  main.sort((a,b) => a-b);
  return makeRecord(main, special, 'generated');
}
function makeRecord(mainNumbers, specialNumber, source = 'manual', note = '', createdAt = Date.now()) {
  const main = mainNumbers.map(Number).sort((a, b) => a - b);
  const special = Number(specialNumber);
  if (main.length !== 5 || main.some(n => !Number.isInteger(n) || n < 1 || n > 69)) {
    throw new Error('Enter exactly five whole-number main values from 1 to 69.');
  }
  if (!Number.isInteger(special) || special < 1 || special > 26) {
    throw new Error('The special number must be a whole number from 1 to 26.');
  }
  if (new Set(main).size !== 5) {
    throw new Error('The five main numbers must all be different.');
  }
  if (source === 'generated' && !redCanMatch() && main.includes(special)) {
    throw new Error('Strict mode requires all six generated numbers to differ.');
  }
  return {
    main, special, key: keyFor(main, special),
    source: ['manual', 'generated', 'imported', 'observed'].includes(source) ? source : 'imported',
    note: String(note || '').slice(0, 160),
    createdAt: Number.isFinite(new Date(createdAt).getTime()) ? new Date(createdAt).getTime() : Date.now()
  };
}
function displaySet(record) {
  $('main-balls').replaceChildren(...record.main.map(n => {
    const el = document.createElement('span'); el.className = 'ball'; el.textContent = fmt(n); return el;
  }));
  const specialEl = document.createElement('span');
  specialEl.className = 'ball ball-gold';
  specialEl.textContent = fmt(record.special);
  $('special-ball').replaceChildren(specialEl);
}
async function generateAndSave() {
  const button = $('generate-btn');
  button.disabled = true;
  try {
    // Very unlikely to need more than one draw, but the bank's unique key enforces it.
    for (let tries = 0; tries < 500; tries++) {
      const candidate = makeSet();
      if (await findByKey(candidate.key)) continue;
      try {
        await addRecord(candidate);
        lastGenerated = candidate;
        displaySet(candidate);
        $('copy-btn').disabled = false;
        const mode = candidate.note ? 'Historical weighting · experimental' : 'Fair random';
        $('latest-message').textContent = mode + ' · Saved ' + timeLabel(candidate.createdAt);
        await refreshBank();
        toast('New unique set saved!');
        return;
      } catch (err) {
        if (err?.name === 'ConstraintError') continue;
        throw err;
      }
    }
    throw new Error('Unable to find an unused set after many attempts.');
  } catch (err) { showError('Could not save: ' + err.message); }
  finally { button.disabled = false; }
}
async function copyText(value) {
  try {
    if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(value);
    else {
      const area = document.createElement('textarea');
      area.value = value; area.style.position = 'fixed'; area.style.opacity = '0';
      document.body.append(area); area.select();
      if (!document.execCommand('copy')) throw new Error('Copy unavailable');
      area.remove();
    }
    toast('Numbers copied');
  } catch { toast('Copy unavailable — please select the numbers manually'); }
}
function parseManual() {
  const inputs = [...document.querySelectorAll('.manual-main-inputs .number-input')];
  const values = inputs.map(el => el.value.trim() === '' ? NaN : Number(el.value));
  const specialInput = $('manual-special').value.trim();
  return makeRecord(values, specialInput === '' ? NaN : Number(specialInput), 'manual', $('set-note').value);
}
async function addManual(event) {
  event.preventDefault();
  $('manual-error').textContent = '';
  try {
    const record = parseManual();
    if (await findByKey(record.key)) throw new Error('This exact combination is already saved in your bank.');
    await addRecord(record);
    $('manual-form').reset();
    await refreshBank();
    toast('Previous combination added');
  } catch (err) {
    $('manual-error').textContent = err.message;
    toast('Check the number entry');
  }
}
// Paste "12 14 27 33 55 8" into any main-number field to fill the entire set.
function autoFillPaste(event) {
  const text = event.clipboardData?.getData('text') || '';
  const tokens = text.match(/\d+/g);
  if (!tokens || tokens.length !== 6) return;
  event.preventDefault();
  const inputs = [...document.querySelectorAll('.manual-main-inputs .number-input')];
  inputs.forEach((el, i) => { el.value = tokens[i]; });
  $('manual-special').value = tokens[5];
  toast('Pasted six numbers');
}
function matchesSearch(record, search) {
  if (!search) return true;
  const terms = search.match(/\d+/g);
  if (!terms) return false;
  const nums = [...record.main, record.special];
  return terms.every(term => nums.includes(Number(term)));
}
function queryPage(anchor, term) {
  return new Promise((resolve, reject) => {
    const results = [];
    let more = false;
    const range = anchor == null ? undefined : IDBKeyRange.upperBound(anchor, true);
    const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).openCursor(range, 'prev');
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) { resolve({ results, more }); return; }
      if (matchesSearch(cursor.value, term)) {
        if (results.length === PAGE_SIZE) { more = true; resolve({ results, more }); return; }
        results.push(cursor.value);
      }
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
}
function rowBall(value, isSpecial) {
  const el = document.createElement('span');
  el.className = 'mini-ball' + (isSpecial ? ' mini-special' : '');
  el.textContent = fmt(value);
  return el;
}
function renderRow(record) {
  const box = document.createElement('article'); box.className = 'history-entry';
  const top = document.createElement('div'); top.className = 'entry-top';
  const meta = document.createElement('div'); meta.className = 'entry-meta';
  const tag = document.createElement('span'); tag.className = 'source-chip ' + record.source;
  tag.textContent = record.source === 'generated' ? 'GENERATED' : record.source === 'manual' ? 'MANUAL' : record.source === 'observed' ? 'VIDEO' : 'IMPORTED';
  const date = document.createElement('span'); date.textContent = timeLabel(record.createdAt);
  meta.append(tag, date);
  const controls = document.createElement('div'); controls.className = 'entry-controls';
  const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = '⧉'; copy.title = 'Copy this set'; copy.setAttribute('aria-label', 'Copy ' + textSet(record));
  copy.addEventListener('click', () => copyText(textSet(record)));
  const del = document.createElement('button'); del.type = 'button'; del.textContent = '×'; del.className = 'delete-row'; del.title = 'Delete this set'; del.setAttribute('aria-label', 'Delete ' + textSet(record));
  del.addEventListener('click', async () => {
    if (!confirm('Delete this saved combination? This cannot be undone without a backup.')) return;
    try { await removeRecord(record.id); await refreshBank(); toast('Set removed'); }
    catch (err) { showError('Unable to delete: ' + err.message); }
  });
  controls.append(copy, del); top.append(meta, controls);
  const balls = document.createElement('div'); balls.className = 'entry-balls';
  record.main.forEach(n => balls.append(rowBall(n, false)));
  balls.append(rowBall(record.special, true));
  box.append(top, balls);
  if (record.note) {
    const note = document.createElement('div'); note.className = 'entry-note'; note.textContent = record.note; box.append(note);
  }
  return box;
}
async function renderHistory() {
  const currentRender = ++renderVersion;
  const anchor = pageAnchors[pageIndex];
  const { results, more } = await queryPage(anchor, searchTerm);
  if (currentRender !== renderVersion) return;
  const list = $('history-list'); list.replaceChildren();
  if (!results.length) {
    const empty = document.createElement('div'); empty.className = 'empty-state';
    empty.textContent = searchTerm ? 'No combinations found for those numbers.' : 'No saved numbers yet. Generate a set or add one above.';
    list.append(empty);
  } else results.forEach(record => list.append(renderRow(record)));
  $('page-controls').hidden = pageIndex === 0 && !more;
  $('prev-page').disabled = pageIndex === 0;
  $('next-page').disabled = !more;
  $('page-label').textContent = `Page ${pageIndex + 1}`;
  $('next-page').onclick = async () => {
    if (!more || !results.length) return;
    pageIndex++;
    pageAnchors[pageIndex] = results[results.length - 1].id;
    await renderHistory();
  };
  $('prev-page').onclick = async () => {
    if (!pageIndex) return;
    pageIndex--;
    await renderHistory();
  };
}
async function refreshBank() {
  const count = await countRecords();
  $('total-count').textContent = count.toLocaleString();
  $('archive-count').textContent = count.toLocaleString();
  pageIndex = 0;
  pageAnchors = [null];
  await renderHistory();
}
function parseCsvRow(line) {
  const parts = []; let value = ''; let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (c === ',' && !quoted) { parts.push(value); value = ''; }
    else value += c;
  }
  parts.push(value);
  return parts;
}
function parseImported(text, filename) {
  const normalized = text.trim();
  if (!normalized) throw new Error('The file is empty.');
  if (filename.toLowerCase().endsWith('.json') || normalized.startsWith('{') || normalized.startsWith('[')) {
    const parsed = JSON.parse(normalized);
    const array = Array.isArray(parsed) ? parsed : parsed.sets;
    if (!Array.isArray(array)) throw new Error('JSON must contain a list of saved sets.');
    return array.map(item => Array.isArray(item)
      ? makeRecord(item.slice(0, 5), item[5], 'imported')
      : makeRecord(item.main, item.special, 'imported', item.note, item.createdAt));
  }
  const lines = normalized.split(/\r?\n/);
  const rows = [];
  lines.forEach((line, i) => {
    if (!line.trim()) return;
    const cells = parseCsvRow(line.replace(/^\uFEFF/, ''));
    if (i === 0 && /^\s*(main|number|ball)/i.test(cells[0])) return;
    if (cells.length < 6) throw new Error(`CSV line ${i + 1} needs six numbers.`);
    try { rows.push(makeRecord(cells.slice(0, 5), cells[5], 'imported', cells[8] || '', cells[7] || Date.now())); }
    catch (error) { throw new Error(`CSV line ${i + 1}: ${error.message}`); }
  });
  return rows;
}
function addBatch(records) {
  return new Promise((resolve, reject) => {
    let added = 0; let skipped = 0;
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    records.forEach(record => {
      const req = store.add(record);
      req.onsuccess = () => { added++; };
      req.onerror = evt => {
        if (req.error?.name === 'ConstraintError') {
          skipped++;
          evt.preventDefault();
          evt.stopPropagation();
        }
      };
    });
    tx.oncomplete = () => resolve({ added, skipped });
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
async function importFile(event) {
  const file = event.target.files?.[0]; if (!file) return;
  const result = $('import-result'); result.textContent = 'Importing…';
  try {
    const content = await file.text();
    const records = parseImported(content, file.name);
    let added = 0; let skipped = 0;
    for (let i = 0; i < records.length; i += 200) {
      const stats = await addBatch(records.slice(i, i + 200));
      added += stats.added; skipped += stats.skipped;
      result.textContent = `Importing… ${Math.min(i + 200, records.length).toLocaleString()} / ${records.length.toLocaleString()}`;
    }
    let studiesResult = '';
    if (content.trimStart().startsWith('{') && window.ResearchLab) {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed.drawStudies)) {
        const info = await window.ResearchLab.importStudies(parsed.drawStudies);
        studiesResult = ` · ${info.added} drawing studies imported`;
      }
    }
    await refreshBank();
    result.textContent = `Import complete: ${added.toLocaleString()} added, ${skipped.toLocaleString()} already saved${studiesResult}.`;
    toast(`${added.toLocaleString()} sets imported`);
  } catch (err) { result.textContent = `Import failed: ${err.message}`; showError('Import failed: ' + err.message); }
  finally { event.target.value = ''; }
}
function collectAllRecords() {
  return new Promise((resolve, reject) => {
    const results = [];
    const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) { resolve(results); return; }
      const { main, special, source, createdAt, note } = cursor.value;
      results.push({ main, special, source, createdAt, note });
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
}
function downloadBlob(data, filename, mime) {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function csvEscape(value) {
  const s = String(value ?? '');
  return /[\",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
async function exportBank(format) {
  const button = $(format === 'csv' ? 'export-csv' : 'export-json');
  button.disabled = true;
  try {
    const records = await collectAllRecords();
    const stamp = new Date().toISOString().slice(0, 10);
    if (format === 'json') {
      const drawStudies = window.ResearchLab ? await window.ResearchLab.exportStudies() : [];
      downloadBlob(JSON.stringify({ format: 'number-bank-v4', exportedAt: new Date().toISOString(), sets: records, drawStudies }, null, 2),
        `number-bank-backup-${stamp}.json`, 'application/json');
    } else {
      const lines = ['main1,main2,main3,main4,main5,special,source,createdAt,note'];
      records.forEach(r => lines.push([...r.main, r.special, r.source, new Date(r.createdAt).toISOString(), r.note].map(csvEscape).join(',')));
      downloadBlob(lines.join('\r\n'), `number-bank-${stamp}.csv`, 'text/csv');
    }
    toast(`${records.length.toLocaleString()} sets exported`);
  } catch (err) { showError('Export failed: ' + err.message); }
  finally { button.disabled = false; }
}
async function clearBank() {
  if (!confirm('Erase ALL saved combinations from this device? Make a JSON backup first.')) return;
  if (prompt('To confirm permanent deletion, type DELETE (all caps):') !== 'DELETE') {
    toast('Deletion canceled'); return;
  }
  try {
    await removeAll();
    lastGenerated = null;
    $('copy-btn').disabled = true;
    const emptyMain = Array.from({ length: 5 }, () => {
      const span = document.createElement('span'); span.className = 'ball ball-empty'; span.textContent = '–'; return span;
    });
    $('main-balls').replaceChildren(...emptyMain);
    const special = document.createElement('span'); special.className = 'ball ball-gold ball-empty'; special.textContent = '–';
    $('special-ball').replaceChildren(special);
    $('latest-message').textContent = 'Ready to generate a new combination.';
    await refreshBank(); toast('Bank erased');
  } catch (err) { showError('Unable to clear the bank: ' + err.message); }
}
async function init() {
  try {
    db = await openDatabase();
    const toggle = $('allow-red-match');
    try { const previous = localStorage.getItem(SETTINGS_KEY); if (previous !== null) toggle.checked = previous === 'true'; } catch {}
    toggle.addEventListener('change', () => {
      try { localStorage.setItem(SETTINGS_KEY, String(toggle.checked)); } catch {}
      $('matching-mode').textContent = toggle.checked ? 'Red match allowed (Powerball rules)' : 'Strict: all six different';
    });
    $('matching-mode').textContent = toggle.checked ? 'Red match allowed (Powerball rules)' : 'Strict: all six different';
    $('generate-btn').addEventListener('click', generateAndSave);
    $('copy-btn').addEventListener('click', () => lastGenerated && copyText(textSet(lastGenerated)));
    $('manual-form').addEventListener('submit', addManual);
    document.querySelectorAll('.manual-main-inputs .number-input').forEach(el => el.addEventListener('paste', autoFillPaste));
    $('search-input').addEventListener('input', event => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(async () => {
        searchTerm = event.target.value.trim(); pageIndex = 0; pageAnchors = [null];
        try { await renderHistory(); } catch (error) { showError(error.message); }
      }, 200);
    });
    $('import-file').addEventListener('change', importFile);
    $('export-json').addEventListener('click', () => exportBank('json'));
    $('export-csv').addEventListener('click', () => exportBank('csv'));
    $('clear-bank').addEventListener('click', clearBank);
    await refreshBank();
    document.dispatchEvent(new Event('number-bank-ready'));
    // Auto-sync once on launch and on reconnection; no automatic background work while closed.
    if (window.HistoryLab) window.HistoryLab.start().catch(error => console.warn('History sync:', error));
    if ('serviceWorker' in navigator && window.isSecureContext) {
      navigator.serviceWorker.register('./service-worker.js').catch(() => {});
    }
  } catch (err) {
    $('latest-message').textContent = 'Storage unavailable. Please open the app in Safari via HTTPS (such as GitHub Pages).';
    $('generate-btn').disabled = true;
    showError('Could not open private storage: ' + err.message);
  }
}
init();
